-- Only the person who entered a charge may change or remove it.
--
-- Before this, any room member could delete or edit any expense. Balances are
-- derived from expenses, so that meant one roommate could silently rewrite
-- everyone else's position. Authorship is the boundary: `created_by` is who
-- typed it in, which is not necessarily `paid_by` -- you can log a charge on
-- someone else's behalf, and you remain the one who can correct it.

-- ------------------------------------------------------------------- delete
-- Membership stays in the predicate alongside authorship. Without it, someone
-- who has left the room could still reach back and delete an old charge of
-- theirs, which would move the balances of a room they can no longer see.
drop policy expenses_delete on expenses;
create policy expenses_delete on expenses for delete to authenticated
  using (is_room_member(room_id) and created_by = auth.uid());

-- ------------------------------------------------------------------- update
-- There is deliberately no update policy on `expenses` to hang this off: all
-- edits go through update_expense(), which is SECURITY DEFINER and therefore
-- bypasses RLS entirely. The authorship check has to live inside the function.
create or replace function update_expense(
  p_expense_id   uuid,
  p_description  text,
  p_amount_cents bigint,
  p_paid_by      uuid,
  p_spent_at     date,
  p_split_type   split_type,
  p_notes        text,
  p_splits       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_room_id    uuid;
  v_created_by uuid;
begin
  select room_id, created_by into v_room_id, v_created_by
    from expenses where id = p_expense_id;
  if v_room_id is null then
    raise exception 'That expense no longer exists.' using errcode = 'P0002';
  end if;
  if not is_room_member(v_room_id) then
    raise exception 'not a member of this room' using errcode = '42501';
  end if;
  if v_created_by <> auth.uid() then
    raise exception 'Only the person who added this charge can change it.'
      using errcode = '42501';
  end if;

  perform validate_splits(v_room_id, p_amount_cents, p_paid_by, p_splits);

  update expenses
     set description  = trim(p_description),
         amount_cents = p_amount_cents,
         paid_by      = p_paid_by,
         spent_at     = coalesce(p_spent_at, current_date),
         split_type   = p_split_type,
         notes        = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_expense_id;

  delete from expense_splits where expense_id = p_expense_id;
  insert into expense_splits (expense_id, room_id, user_id, owed_cents)
  select p_expense_id, v_room_id, (s ->> 'user_id')::uuid, (s ->> 'owed_cents')::bigint
  from jsonb_array_elements(p_splits) s;

  return p_expense_id;
end;
$$;

revoke execute on function update_expense(uuid, text, bigint, uuid, date, split_type, text, jsonb)
  from public, anon;
grant execute on function update_expense(uuid, text, bigint, uuid, date, split_type, text, jsonb)
  to authenticated;
