-- Turn a shopping trip into a charge.
--
-- Who a thing is for is decided when it is *requested*, not when it is paid
-- for: you know who needs the razors when you add them to the list. So an item
-- carries `for_users`, and by the time it is bought the split is already
-- settled -- the only thing missing is the price. That keeps the buyer's job to
-- one number per line, and it is what the receipt-photo iteration will fill in
-- automatically later.

-- --------------------------------------------------------------- who it's for
alter table shopping_items add column for_users uuid[];

-- Existing rows were implicitly for whoever asked.
update shopping_items set for_users = array[requested_by];

alter table shopping_items
  alter column for_users set not null,
  add constraint shopping_items_for_users_not_empty
    check (cardinality(for_users) >= 1);

-- ------------------------------------------------------------ price + linkage
-- price_cents and expense_id are written only by charge_shopping_items(); the
-- column grants at the bottom of this file are what enforce that. An item is
-- waiting to be charged exactly when `bought and expense_id is null`, which is
-- what makes charging idempotent -- there is no way to bill the same thing
-- twice. Deleting the expense sets expense_id back to null and returns the
-- items to the queue, price remembered.
alter table shopping_items
  add column price_cents bigint check (price_cents is null or price_cents > 0),
  add column expense_id  uuid references expenses (id) on delete set null;

create index shopping_items_uncharged_idx
  on shopping_items (room_id, bought_by)
  where bought and expense_id is null;

-- Every beneficiary has to be in the room. SECURITY DEFINER for the same reason
-- as the other membership helpers: it is called from a policy.
create function are_all_members(p_room_id uuid, p_user_ids uuid[]) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(cardinality(p_user_ids), 0) > 0
     and not exists (
       select 1
       from unnest(p_user_ids) as u(user_id)
       where not exists (
         select 1 from room_members m
         where m.room_id = p_room_id and m.user_id = u.user_id
       )
     );
$$;

drop policy shopping_items_insert on shopping_items;
create policy shopping_items_insert on shopping_items for insert to authenticated
  with check (
    is_room_member(room_id)
    and requested_by = auth.uid()
    and (assigned_to is null or is_member(room_id, assigned_to))
    and are_all_members(room_id, for_users)
  );

drop policy shopping_items_update on shopping_items;
create policy shopping_items_update on shopping_items for update to authenticated
  using (is_room_member(room_id))
  with check (
    is_room_member(room_id)
    and (assigned_to is null or is_member(room_id, assigned_to))
    and are_all_members(room_id, for_users)
  );

-- ------------------------------------------------------------------- trigger
create or replace function shopping_items_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  -- An item that has produced a charge is frozen. Its price and beneficiaries
  -- are baked into that expense's splits, and `bought` is the reason the charge
  -- exists at all, so letting any of the three drift would silently put the
  -- expense out of step with the thing it came from.
  if old.expense_id is not null and new.expense_id is not null then
    if new.price_cents is distinct from old.price_cents
    or new.for_users   is distinct from old.for_users
    or new.bought      is distinct from old.bought then
      raise exception
        'That item is already on a charge. Delete the expense first to change it.'
        using errcode = '42501';
    end if;
  end if;

  -- What the item *is* -- including who it is for -- belongs to the requester.
  -- Buying it and claiming it are open to the room.
  if auth.uid() is distinct from old.requested_by then
    if new.name         is distinct from old.name
    or new.quantity     is distinct from old.quantity
    or new.notes        is distinct from old.notes
    or new.for_users    is distinct from old.for_users
    or new.requested_by is distinct from old.requested_by then
      raise exception 'Only the person who asked for this can change what it is.'
        using errcode = '42501';
    end if;

    if new.assigned_to is distinct from old.assigned_to
       and new.assigned_to is distinct from auth.uid()
       and old.assigned_to is distinct from auth.uid() then
      raise exception 'Only the person who asked for this can assign it to someone else.'
        using errcode = '42501';
    end if;
  end if;

  if new.bought is distinct from old.bought then
    if new.bought then
      new.bought_at := now();
      new.bought_by := auth.uid();
    else
      new.bought_at := null;
      new.bought_by := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- =========================================================== charge the trip
-- One transaction: price the lines, create the expense, and link the items to
-- it. Doing this as two calls from the browser would leave a window where the
-- expense exists but the items still look uncharged, and the next trip would
-- bill them again.
--
-- The split needs no rounding logic of its own. Each line's price is divided
-- between its beneficiaries in integer cents, remainder pennies going to the
-- leading entries -- the same rule as splitEqual() in src/lib/money.ts, so the
-- preview in the browser matches this to the penny. Summing those per person
-- therefore adds up to the trip total exactly, which is what create_expense()
-- insists on.
create function charge_shopping_items(
  p_room_id     uuid,
  p_description text,
  p_spent_at    date,
  p_lines       jsonb   -- [{"item_id": uuid, "price_cents": bigint}, ...]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_rows     int;
  v_distinct int;
  v_total    bigint;
  v_names    text;
  v_splits   jsonb;
  v_type     split_type;
  v_expense  uuid;
begin
  if not is_room_member(p_room_id) then
    raise exception 'not a member of this room' using errcode = '42501';
  end if;

  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'Pick at least one thing to charge.';
  end if;

  select count(*),
         count(distinct (l ->> 'item_id')),
         coalesce(sum((l ->> 'price_cents')::bigint), 0)
    into v_rows, v_distinct, v_total
    from jsonb_array_elements(p_lines) l;

  if v_rows <> v_distinct then
    raise exception 'The same item appears twice.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where (l ->> 'price_cents')::bigint <= 0
  ) then
    raise exception 'Every item being charged needs a price above $0.';
  end if;

  -- You charge what you bought. Anything else is either not yours to bill, not
  -- actually bought yet, or already on a charge.
  if exists (
    select 1
    from jsonb_array_elements(p_lines) l
    left join shopping_items i on i.id = (l ->> 'item_id')::uuid
    where i.id is null
       or i.room_id <> p_room_id
       or not i.bought
       or i.expense_id is not null
       or i.bought_by is distinct from v_uid
  ) then
    raise exception
      'Every line has to be something you ticked off in this room and have not charged yet.'
      using errcode = '42501';
  end if;

  select string_agg(i.name, ', ' order by i.name)
    into v_names
    from jsonb_array_elements(p_lines) l
    join shopping_items i on i.id = (l ->> 'item_id')::uuid;

  select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'owed_cents', s.owed))
    into v_splits
    from (
      select b.user_id,
             sum(
               (l.price_cents / cardinality(i.for_users))
               + case
                   when b.ord <= (l.price_cents % cardinality(i.for_users)) then 1
                   else 0
                 end
             )::bigint as owed
      from (
        select (x ->> 'item_id')::uuid       as item_id,
               (x ->> 'price_cents')::bigint as price_cents
        from jsonb_array_elements(p_lines) x
      ) l
      join shopping_items i on i.id = l.item_id
      cross join lateral unnest(i.for_users) with ordinality as b(user_id, ord)
      group by b.user_id
    ) s;

  -- A trip that turns out to be entirely your own -- one beneficiary, and it is
  -- you -- is a personal expense, not a split one. It moves nobody's balance,
  -- and calling it 'exact' would have the expense list describe money you spent
  -- on yourself as a one-way split, which reads like lending to yourself.
  v_type := case
              when jsonb_array_length(v_splits) = 1
                   and (v_splits -> 0 ->> 'user_id')::uuid = v_uid
              then 'personal'::split_type
              else 'exact'::split_type
            end;

  -- Through create_expense() like everything else, so the splits-sum-to-total
  -- invariant is checked in exactly one place.
  v_expense := create_expense(
    p_room_id,
    coalesce(nullif(trim(coalesce(p_description, '')), ''), 'Shopping list'),
    v_total,
    v_uid,
    coalesce(p_spent_at, current_date),
    v_type,
    v_names,
    v_splits
  );

  update shopping_items i
     set expense_id  = v_expense,
         price_cents = l.price_cents
    from (
      select (x ->> 'item_id')::uuid       as item_id,
             (x ->> 'price_cents')::bigint as price_cents
      from jsonb_array_elements(p_lines) x
    ) l
   where i.id = l.item_id;

  return v_expense;
end;
$$;

-- --------------------------------------------------------------------- grants
-- price_cents and expense_id are deliberately absent from these column grants.
-- A client that could write expense_id could unlink a charged item and bill it
-- a second time, and one that could write price_cents could move a price out
-- from under an expense already built on it. Both belong to
-- charge_shopping_items(), which is SECURITY DEFINER and so writes them as the
-- owner. Column privileges are checked against the columns an UPDATE names, not
-- what a trigger assigns, so bought_at/bought_by are still stamped normally.
revoke insert, update on shopping_items from authenticated;
grant insert (room_id, name, quantity, notes, requested_by, assigned_to,
              for_users, bought, position)
  on shopping_items to authenticated;
grant update (name, quantity, notes, assigned_to, for_users, bought, position)
  on shopping_items to authenticated;

revoke execute on function are_all_members(uuid, uuid[]) from public, anon;
grant execute on function are_all_members(uuid, uuid[]) to authenticated;
revoke execute on function charge_shopping_items(uuid, text, date, jsonb) from public, anon;
grant execute on function charge_shopping_items(uuid, text, date, jsonb) to authenticated;
