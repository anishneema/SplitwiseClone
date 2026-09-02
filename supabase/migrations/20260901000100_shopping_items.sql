-- Shopping list: things you need someone else to pick up for you.
--
-- The chores table is a to-do list the room shares. This is not that: every
-- row has an owner -- the person who wants the thing -- and other people act on
-- it. So the columns describing *what* is wanted belong to the requester, while
-- claiming an item and ticking it off are open to anyone in the room.
--
-- A later iteration turns a receipt photo into rows here and assigns each line
-- to a person. Nothing in this table forecloses that; it just isn't built yet.

create table shopping_items (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  -- Free text, not a number: "2 boxes", "a big one", "whatever's cheapest".
  -- Quantities on a shopping list are notes to a human, not arithmetic.
  quantity     text,
  notes        text,
  -- Who wants it. Plays the same role `created_by` does elsewhere -- it is the
  -- authorship column the policies below key on -- but named for what it means
  -- on a shopping list.
  requested_by uuid not null references profiles (id),
  -- Who has agreed to buy it. Null means anyone can.
  assigned_to  uuid references profiles (id) on delete set null,
  bought       boolean not null default false,
  bought_at    timestamptz,
  bought_by    uuid references profiles (id),
  position     double precision not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index shopping_items_room_idx on shopping_items (room_id, bought, position);

-- Clients flip `bought`; the database records who bought it and when, the same
-- way chores_sync_done() attributes a ticked chore. It also enforces the
-- column-level split of authority, which RLS alone cannot express: a policy
-- decides whether you may update a row, not which of its columns you may touch.
create function shopping_items_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is distinct from old.requested_by then
    if new.name         is distinct from old.name
    or new.quantity     is distinct from old.quantity
    or new.notes        is distinct from old.notes
    or new.requested_by is distinct from old.requested_by then
      raise exception 'Only the person who asked for this can change what it is.'
        using errcode = '42501';
    end if;

    -- You may pick an item up yourself, or put one you had claimed back down
    -- (or hand it on). Assigning it to a third party is the requester's call.
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

create trigger shopping_items_before_update
  before update on shopping_items
  for each row execute function shopping_items_before_update();

-- ------------------------------------------------------------------ row-level
alter table shopping_items enable row level security;

create policy shopping_items_select on shopping_items for select to authenticated
  using (is_room_member(room_id));

create policy shopping_items_insert on shopping_items for insert to authenticated
  with check (
    is_room_member(room_id)
    and requested_by = auth.uid()
    and (assigned_to is null or is_member(room_id, assigned_to))
  );

-- Any member may update a row -- the trigger above narrows that to `bought` and
-- claiming for everyone except the requester.
create policy shopping_items_update on shopping_items for update to authenticated
  using (is_room_member(room_id))
  with check (
    is_room_member(room_id)
    and (assigned_to is null or is_member(room_id, assigned_to))
  );

-- Same rule as expenses: your row is yours to remove, and nobody else's.
create policy shopping_items_delete on shopping_items for delete to authenticated
  using (is_room_member(room_id) and requested_by = auth.uid());

-- ------------------------------------------------------------------- realtime
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the whole old row, which
-- Realtime needs in order to apply RLS before forwarding them.
alter table shopping_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end;
$$;

-- --------------------------------------------------------------------- grants
-- The blanket grants in the init migration applied to the tables that existed
-- when it ran; they do not reach forward to this one. Supabase's default
-- privileges hand new public tables to `anon`, and this app has no anonymous
-- surface, so revoke that explicitly rather than relying on RLS alone.
revoke all on shopping_items from anon;
grant select, insert, update, delete on shopping_items to authenticated;
revoke execute on function shopping_items_before_update() from public, anon;
