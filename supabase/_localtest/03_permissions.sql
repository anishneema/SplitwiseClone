-- Authorship checks for 20260901000000_expense_author_only.sql and the shopping
-- list in 20260901000100_shopping_items.sql.
--
-- Runs after 01_functional.sql against the same database, reusing the room and
-- the roommates it left behind: 1111 = Anish (owner), 2222 = Nav, 3333 = Sam,
-- 4444 = an outsider in no room at all. 'Costco run' was entered by Anish and
-- 'Internet bill' by Nav, which is what makes authorship testable here.

set role authenticated;

-- =================================================== a charge belongs to its author
set test.uid = '22222222-2222-2222-2222-222222222222';

-- A failing USING clause on DELETE is not an error -- it just matches no rows.
-- Asserting on the error would pass against a policy that never ran.
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from expenses where description = 'Costco run';
  delete from expenses where description = 'Costco run';
  select count(*) into v_after from expenses where description = 'Costco run';
  assert v_before = 1, 'Costco run should still be here from 01_functional.sql';
  assert v_after = 1, 'a non-author deleted someone else''s charge';
  raise notice 'ok: deleting someone else''s charge matches no rows';
end $$;

do $$
declare v_id uuid := (select id from expenses where description = 'Costco run');
begin
  perform update_expense(v_id, 'Hijacked', 3000,
    '22222222-2222-2222-2222-222222222222', current_date, 'equal', null,
    '[{"user_id":"11111111-1111-1111-1111-111111111111","owed_cents":1000},
      {"user_id":"22222222-2222-2222-2222-222222222222","owed_cents":1000},
      {"user_id":"33333333-3333-3333-3333-333333333333","owed_cents":1000}]'::jsonb);
  raise exception 'TEST FAILED: a non-author edited someone else''s charge';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  assert (select description from expenses where id = v_id) = 'Costco run',
    'the description should not have moved';
  raise notice 'ok: update_expense refuses a non-author (%)', sqlerrm;
end $$;

-- The author keeps full control of the charge they entered.
set test.uid = '11111111-1111-1111-1111-111111111111';

do $$
declare v_id uuid := (select id from expenses where description = 'Costco run');
begin
  perform update_expense(v_id, 'Costco run (corrected)', 3600,
    '11111111-1111-1111-1111-111111111111', current_date, 'equal', null,
    '[{"user_id":"11111111-1111-1111-1111-111111111111","owed_cents":1200},
      {"user_id":"22222222-2222-2222-2222-222222222222","owed_cents":1200},
      {"user_id":"33333333-3333-3333-3333-333333333333","owed_cents":1200}]'::jsonb);
  assert (select amount_cents from expenses where id = v_id) = 3600,
    'the author''s own edit should have landed';
  assert (select count(*) from expense_splits where expense_id = v_id) = 3,
    'the splits should have been rewritten';
  raise notice 'ok: the author can still edit their own charge';
end $$;

-- Delete, on a charge nobody else's assertions depend on.
select create_expense((select v::uuid from _t where k = 'room'),
  'Authorship scratch', 500, '11111111-1111-1111-1111-111111111111',
  current_date, 'personal', null,
  '[{"user_id":"11111111-1111-1111-1111-111111111111","owed_cents":500}]'::jsonb);

do $$
declare v_id uuid := (select id from expenses where description = 'Authorship scratch');
begin
  delete from expenses where id = v_id;
  assert (select count(*) from expenses where id = v_id) = 0,
    'the author should be able to delete their own charge';
  assert (select count(*) from expense_splits where expense_id = v_id) = 0,
    'the splits should have cascaded away with it';
  raise notice 'ok: the author can delete their own charge, splits and all';
end $$;

-- =============================================================== shopping list
insert into shopping_items (room_id, name, quantity, requested_by, for_users)
values ((select v::uuid from _t where k = 'room'), 'Oat milk', '2 cartons',
        '11111111-1111-1111-1111-111111111111',
        array['11111111-1111-1111-1111-111111111111']::uuid[]);

do $$
begin
  assert (select requested_by from shopping_items where name = 'Oat milk')
    = '11111111-1111-1111-1111-111111111111', 'the requester should be recorded';
  assert (select bought from shopping_items where name = 'Oat milk') = false,
    'a new item should not be bought';
  assert (select assigned_to from shopping_items where name = 'Oat milk') is null,
    'a new item should be unclaimed';
  raise notice 'ok: an item records who asked for it';
end $$;

set test.uid = '22222222-2222-2222-2222-222222222222';

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  insert into shopping_items (room_id, name, requested_by, for_users)
  values (v_room, 'Not mine to ask for', '11111111-1111-1111-1111-111111111111',
          array['11111111-1111-1111-1111-111111111111']::uuid[]);
  raise exception 'TEST FAILED: an item was added in someone else''s name';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: you can only add items in your own name (%)', sqlerrm;
end $$;

do $$
begin
  update shopping_items set name = 'Almond milk' where name = 'Oat milk';
  raise exception 'TEST FAILED: a non-requester renamed someone else''s item';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: only the requester can change what an item is (%)', sqlerrm;
end $$;

do $$
begin
  update shopping_items set quantity = '40 cartons' where name = 'Oat milk';
  raise exception 'TEST FAILED: a non-requester changed the quantity';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: quantity is the requester''s to set (%)', sqlerrm;
end $$;

do $$
declare v_before int;
begin
  select count(*) into v_before from shopping_items where name = 'Oat milk';
  delete from shopping_items where name = 'Oat milk';
  assert v_before = 1 and (select count(*) from shopping_items where name = 'Oat milk') = 1,
    'a non-requester deleted someone else''s item';
  raise notice 'ok: deleting someone else''s item matches no rows';
end $$;

-- What a non-requester *may* do: pick the item up, and tick it off.
update shopping_items set assigned_to = '22222222-2222-2222-2222-222222222222'
  where name = 'Oat milk';
do $$
begin
  assert (select assigned_to from shopping_items where name = 'Oat milk')
    = '22222222-2222-2222-2222-222222222222', 'claiming an item for yourself should work';
  raise notice 'ok: anyone in the room can claim an item';
end $$;

update shopping_items set assigned_to = null where name = 'Oat milk';
do $$
begin
  assert (select assigned_to from shopping_items where name = 'Oat milk') is null,
    'putting a claimed item back down should work';
  raise notice 'ok: and can put it back down';
end $$;

do $$
begin
  update shopping_items set assigned_to = '33333333-3333-3333-3333-333333333333'
    where name = 'Oat milk';
  raise exception 'TEST FAILED: a non-requester assigned an item to a third person';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: handing an item to someone else is the requester''s call (%)', sqlerrm;
end $$;

update shopping_items set bought = true where name = 'Oat milk';
do $$
declare r record;
begin
  select * into r from shopping_items where name = 'Oat milk';
  assert r.bought, 'anyone should be able to tick an item off';
  assert r.bought_by = '22222222-2222-2222-2222-222222222222',
    'the database should record who bought it, not the client';
  assert r.bought_at is not null, 'bought_at should be stamped';
  raise notice 'ok: buying an item is attributed server-side';
end $$;

update shopping_items set bought = false where name = 'Oat milk';
do $$
begin
  assert (select bought_by from shopping_items where name = 'Oat milk') is null
     and (select bought_at from shopping_items where name = 'Oat milk') is null,
    'un-ticking an item should clear its purchase stamps';
  raise notice 'ok: un-ticking an item clears its purchase stamps';
end $$;

-- A client cannot forge the attribution. Since 20260901000200 it cannot even
-- name the column: bought_by is outside the UPDATE column grant, so the
-- statement is refused before the trigger would have overwritten it.
do $$
begin
  update shopping_items
     set bought = true, bought_by = '33333333-3333-3333-3333-333333333333'
   where name = 'Oat milk';
  raise exception 'TEST FAILED: a client wrote bought_by directly';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: bought_by cannot be written by a client at all (%)', sqlerrm;
end $$;

-- The requester can do the lot.
set test.uid = '11111111-1111-1111-1111-111111111111';
update shopping_items
   set name = 'Oat milk (barista)', quantity = '1 carton',
       assigned_to = '33333333-3333-3333-3333-333333333333'
 where name = 'Oat milk';
do $$
begin
  assert (select name from shopping_items where quantity = '1 carton') = 'Oat milk (barista)',
    'the requester should be able to rename their own item';
  assert (select assigned_to from shopping_items where quantity = '1 carton')
    = '33333333-3333-3333-3333-333333333333',
    'the requester should be able to ask a specific person';
  raise notice 'ok: the requester can rename, re-size and re-assign their item';
end $$;

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  insert into shopping_items (room_id, name, requested_by, assigned_to, for_users)
  values (v_room, 'Outsider errand', '11111111-1111-1111-1111-111111111111',
          '44444444-4444-4444-4444-444444444444',
          array['11111111-1111-1111-1111-111111111111']::uuid[]);
  raise exception 'TEST FAILED: an item was assigned to a non-member';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: an item cannot be assigned to a non-member (%)', sqlerrm;
end $$;

do $$
begin
  delete from shopping_items where name = 'Oat milk (barista)';
  assert (select count(*) from shopping_items where name = 'Oat milk (barista)') = 0,
    'the requester should be able to delete their own item';
  raise notice 'ok: the requester can delete their own item';
end $$;

-- ------------------------------------------------------------ RLS + privileges
insert into shopping_items (room_id, name, requested_by, for_users)
values ((select v::uuid from _t where k = 'room'), 'Bin bags',
        '11111111-1111-1111-1111-111111111111',
        array['11111111-1111-1111-1111-111111111111']::uuid[]);

set test.uid = '44444444-4444-4444-4444-444444444444';
do $$
begin
  assert (select count(*) from shopping_items) = 0,
    'an outsider must not see the shopping list';
  raise notice 'ok: RLS hides the shopping list from a non-member';
end $$;

do $$
begin
  insert into shopping_items (room_id, name, requested_by, for_users)
  values ((select id from rooms limit 1), 'Trespass',
          '44444444-4444-4444-4444-444444444444',
          array['44444444-4444-4444-4444-444444444444']::uuid[]);
  raise exception 'TEST FAILED: an outsider added to a room''s shopping list';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: an outsider cannot add to the list (%)', sqlerrm;
end $$;

-- This app has no anonymous surface. The init migration revoked `anon` from the
-- tables that existed then; the shopping migration has to do its own.
reset role;
set role anon;
do $$
begin
  perform 1 from shopping_items;
  raise exception 'TEST FAILED: anon can read shopping_items';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: anon has no privileges on shopping_items (%)', sqlerrm;
end $$;

reset role;
\echo '=== ALL PERMISSION CHECKS PASSED ==='
