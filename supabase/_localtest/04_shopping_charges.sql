-- Checks for 20260901000200_shopping_charges.sql: who an item is for, and
-- turning a bought trip into one charge.
--
-- Runs after 03_permissions.sql on the same database. 1111 = Anish (owner),
-- 2222 = Nav, 3333 = Sam, 4444 = an outsider. 03 left a 'Bin bags' item
-- requested by Anish.

set role authenticated;
set test.uid = '11111111-1111-1111-1111-111111111111';

-- ------------------------------------------------------------ who it's for
do $$
begin
  assert (select for_users from shopping_items where name = 'Bin bags')
    = array['11111111-1111-1111-1111-111111111111']::uuid[],
    'an item added for nobody in particular should be for its requester';
  raise notice 'ok: an item records who it is for';
end $$;

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  insert into shopping_items (room_id, name, requested_by, for_users)
  values (v_room, 'For nobody', '11111111-1111-1111-1111-111111111111',
          array[]::uuid[]);
  raise exception 'TEST FAILED: an item was accepted with nobody to charge';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: an item must be for at least one person (%)', sqlerrm;
end $$;

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  insert into shopping_items (room_id, name, requested_by, for_users)
  values (v_room, 'For an outsider', '11111111-1111-1111-1111-111111111111',
          array['11111111-1111-1111-1111-111111111111',
                '44444444-4444-4444-4444-444444444444']::uuid[]);
  raise exception 'TEST FAILED: an item was accepted for a non-member';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: every beneficiary must be in the room (%)', sqlerrm;
end $$;

-- price_cents and expense_id are not in the column grants at all, so no client
-- can move a price out from under a charge or unlink a charged item.
do $$
begin
  update shopping_items set price_cents = 999 where name = 'Bin bags';
  raise exception 'TEST FAILED: a client wrote price_cents directly';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: price_cents is not client-writable (%)', sqlerrm;
end $$;

do $$
begin
  update shopping_items set expense_id = null where name = 'Bin bags';
  raise exception 'TEST FAILED: a client wrote expense_id directly';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: expense_id is not client-writable (%)', sqlerrm;
end $$;

-- Two things to buy: one just for Anish, one for the whole house.
insert into shopping_items (room_id, name, requested_by, for_users) values
  ((select v::uuid from _t where k = 'room'), 'Oat milk',
   '11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111']::uuid[]),
  ((select v::uuid from _t where k = 'room'), 'Paper towels',
   '11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111',
         '22222222-2222-2222-2222-222222222222',
         '33333333-3333-3333-3333-333333333333']::uuid[]);

set test.uid = '22222222-2222-2222-2222-222222222222';
do $$
begin
  update shopping_items
     set for_users = array['22222222-2222-2222-2222-222222222222']::uuid[]
   where name = 'Oat milk';
  raise exception 'TEST FAILED: a non-requester changed who an item is for';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: who an item is for belongs to the requester (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------ charging a trip
-- Nav does the shop and ticks both off.
update shopping_items set bought = true where name in ('Oat milk', 'Paper towels');

do $$
declare
  v_room uuid := (select v::uuid from _t where k = 'room');
  v_id   uuid := (select id from shopping_items where name = 'Oat milk');
begin
  perform charge_shopping_items(v_room, 'Weekly shop', current_date,
    jsonb_build_array(jsonb_build_object('item_id', v_id, 'price_cents', 0)));
  raise exception 'TEST FAILED: a free line was accepted';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: every charged line needs a price above zero (%)', sqlerrm;
end $$;

set test.uid = '33333333-3333-3333-3333-333333333333';
do $$
declare
  v_room uuid := (select v::uuid from _t where k = 'room');
  v_id   uuid := (select id from shopping_items where name = 'Oat milk');
begin
  perform charge_shopping_items(v_room, 'Not my shop', current_date,
    jsonb_build_array(jsonb_build_object('item_id', v_id, 'price_cents', 420)));
  raise exception 'TEST FAILED: someone charged a purchase they did not make';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: you can only charge what you bought yourself (%)', sqlerrm;
end $$;

set test.uid = '22222222-2222-2222-2222-222222222222';
do $$
declare
  v_room uuid := (select v::uuid from _t where k = 'room');
  v_id   uuid := (select id from shopping_items where name = 'Bin bags');
begin
  perform charge_shopping_items(v_room, 'Too early', current_date,
    jsonb_build_array(jsonb_build_object('item_id', v_id, 'price_cents', 250)));
  raise exception 'TEST FAILED: an unbought item was charged';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: an item has to be bought before it can be charged (%)', sqlerrm;
end $$;

-- $4.20 of oat milk for Anish, $9.20 of paper towels for the three of them.
-- 920 / 3 = 306 remainder 2, and the two spare pennies go to the leading
-- beneficiaries, matching splitEqual() in src/lib/money.ts: 307/307/306.
insert into _t values ('charge', (select charge_shopping_items(
  (select v::uuid from _t where k = 'room'), 'Weekly shop', current_date,
  jsonb_build_array(
    jsonb_build_object('item_id',
      (select id from shopping_items where name = 'Oat milk'), 'price_cents', 420),
    jsonb_build_object('item_id',
      (select id from shopping_items where name = 'Paper towels'), 'price_cents', 920)
  ))::text));

do $$
declare
  v_expense uuid := (select v::uuid from _t where k = 'charge');
  r record;
begin
  select * into r from expenses where id = v_expense;
  assert r.amount_cents = 1340,
    format('the charge should total the lines, got %s', r.amount_cents);
  assert r.paid_by = '22222222-2222-2222-2222-222222222222',
    'the person who bought the things should be the payer';
  assert r.created_by = '22222222-2222-2222-2222-222222222222',
    'and the author, so it is theirs to correct';
  assert r.split_type = 'exact', 'a priced trip is an exact split';
  assert r.description = 'Weekly shop', 'the description should carry through';
  assert r.notes like '%Oat milk%' and r.notes like '%Paper towels%',
    'the note should list what was bought';
  raise notice 'ok: charging a trip creates one expense paid by the buyer';
end $$;

do $$
declare
  v_expense uuid := (select v::uuid from _t where k = 'charge');
  v_anish bigint; v_nav bigint; v_sam bigint;
begin
  select owed_cents into v_anish from expense_splits
    where expense_id = v_expense and user_id = '11111111-1111-1111-1111-111111111111';
  select owed_cents into v_nav from expense_splits
    where expense_id = v_expense and user_id = '22222222-2222-2222-2222-222222222222';
  select owed_cents into v_sam from expense_splits
    where expense_id = v_expense and user_id = '33333333-3333-3333-3333-333333333333';

  assert v_anish = 727, format('Anish owes 420 + 307, got %s', v_anish);
  assert v_nav = 307, format('Nav owes his third of the towels, got %s', v_nav);
  assert v_sam = 306, format('Sam owes the odd penny out, got %s', v_sam);
  assert (select sum(owed_cents) from expense_splits where expense_id = v_expense) = 1340,
    'the splits must add up to the trip total exactly';
  raise notice 'ok: each line splits between the people it was for, to the penny';
end $$;

do $$
declare v_expense uuid := (select v::uuid from _t where k = 'charge');
begin
  assert (select count(*) from shopping_items
          where name in ('Oat milk', 'Paper towels') and expense_id = v_expense) = 2,
    'both items should now point at the charge';
  assert (select price_cents from shopping_items where name = 'Oat milk') = 420,
    'the price should be recorded on the item';
  assert (select sum(net_cents) from room_balances(
            (select v::uuid from _t where k = 'room'))) = 0,
    'balances must still net to zero';
  raise notice 'ok: charged items are linked to the expense and prices recorded';
end $$;

-- Charging the same trip twice is the failure mode that matters most.
do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  perform charge_shopping_items(v_room, 'Again', current_date,
    jsonb_build_array(jsonb_build_object('item_id',
      (select id from shopping_items where name = 'Oat milk'), 'price_cents', 420)));
  raise exception 'TEST FAILED: an item was charged twice';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: an item already on a charge cannot be charged again (%)', sqlerrm;
end $$;

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
  v_id uuid := (select id from shopping_items where name = 'Oat milk');
begin
  perform charge_shopping_items(v_room, 'Dupes', current_date,
    jsonb_build_array(
      jsonb_build_object('item_id', v_id, 'price_cents', 100),
      jsonb_build_object('item_id', v_id, 'price_cents', 200)));
  raise exception 'TEST FAILED: the same item was accepted twice in one charge';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: the same item cannot appear twice in one charge (%)', sqlerrm;
end $$;

-- A charged item is frozen until the charge goes away.
do $$
begin
  update shopping_items set bought = false where name = 'Oat milk';
  raise exception 'TEST FAILED: a charged item was un-ticked';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: a charged item cannot be un-ticked (%)', sqlerrm;
end $$;

set test.uid = '11111111-1111-1111-1111-111111111111';
do $$
begin
  update shopping_items
     set for_users = array['11111111-1111-1111-1111-111111111111']::uuid[]
   where name = 'Paper towels';
  raise exception 'TEST FAILED: a charged item had its beneficiaries changed';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: not even the requester can re-aim a charged item (%)', sqlerrm;
end $$;

-- Deleting the charge hands the items back, price remembered.
set test.uid = '22222222-2222-2222-2222-222222222222';
delete from expenses where id = (select v::uuid from _t where k = 'charge');
do $$
begin
  assert (select count(*) from shopping_items
          where name in ('Oat milk', 'Paper towels') and expense_id is not null) = 0,
    'deleting the charge should unlink its items';
  assert (select count(*) from shopping_items
          where name in ('Oat milk', 'Paper towels') and bought) = 2,
    'the items are still bought, they are just no longer charged';
  assert (select price_cents from shopping_items where name = 'Oat milk') = 420,
    'the price should be remembered so the sheet can prefill it';
  raise notice 'ok: deleting the charge returns its items to the queue';
end $$;

-- And then they can be charged again, which is the point of unlinking them.
do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
  v_new uuid;
begin
  v_new := charge_shopping_items(v_room, 'Re-charged', current_date,
    jsonb_build_array(jsonb_build_object('item_id',
      (select id from shopping_items where name = 'Oat milk'), 'price_cents', 420)));
  assert (select amount_cents from expenses where id = v_new) = 420,
    'the returned item should be chargeable again';
  raise notice 'ok: a returned item can be charged again';
end $$;

-- ============================== buying for yourself is not lending to yourself
-- The complaint this guards against: a trip that includes your own share must
-- not charge you for it. Your share cancels against what you paid, so the only
-- thing that moves is what the others owe you.
set test.uid = '22222222-2222-2222-2222-222222222222';

insert into _t values ('nav_before', (select net_cents::text from room_balances(
  (select v::uuid from _t where k = 'room'))
  where user_id = '22222222-2222-2222-2222-222222222222'));
insert into _t values ('anish_before', (select net_cents::text from room_balances(
  (select v::uuid from _t where k = 'room'))
  where user_id = '11111111-1111-1111-1111-111111111111'));

insert into shopping_items (room_id, name, requested_by, for_users)
values ((select v::uuid from _t where k = 'room'), 'Shared razors',
        '22222222-2222-2222-2222-222222222222',
        array['22222222-2222-2222-2222-222222222222',
              '11111111-1111-1111-1111-111111111111']::uuid[]);
update shopping_items set bought = true where name = 'Shared razors';

select charge_shopping_items(
  (select v::uuid from _t where k = 'room'), 'Shared razors', current_date,
  jsonb_build_array(jsonb_build_object('item_id',
    (select id from shopping_items where name = 'Shared razors'),
    'price_cents', 7000)));

do $$
declare
  v_room  uuid   := (select v::uuid from _t where k = 'room');
  v_nav0  bigint := (select v::bigint from _t where k = 'nav_before');
  v_ani0  bigint := (select v::bigint from _t where k = 'anish_before');
  v_nav   bigint;
  v_ani   bigint;
begin
  select net_cents into v_nav from room_balances(v_room)
    where user_id = '22222222-2222-2222-2222-222222222222';
  select net_cents into v_ani from room_balances(v_room)
    where user_id = '11111111-1111-1111-1111-111111111111';

  -- $70 for the two of them: Nav is owed Anish's $35 and nothing more. He is
  -- not charged his own $35, and he certainly is not owed the whole $70.
  assert v_nav - v_nav0 = 3500,
    format('Nav should be up only the other share, got %s', v_nav - v_nav0);
  assert v_ani0 - v_ani = 3500,
    format('Anish should owe just his own share, got %s', v_ani0 - v_ani);
  raise notice 'ok: buying for yourself and someone else only bills the someone else';
end $$;

-- Entirely your own: logged as a personal expense, moving nobody.
insert into shopping_items (room_id, name, requested_by, for_users)
values ((select v::uuid from _t where k = 'room'), 'Nav own shampoo',
        '22222222-2222-2222-2222-222222222222',
        array['22222222-2222-2222-2222-222222222222']::uuid[]);
update shopping_items set bought = true where name = 'Nav own shampoo';

insert into _t values ('selfcharge', (select charge_shopping_items(
  (select v::uuid from _t where k = 'room'), 'Nav own shampoo', current_date,
  jsonb_build_array(jsonb_build_object('item_id',
    (select id from shopping_items where name = 'Nav own shampoo'),
    'price_cents', 1000)))::text));

do $$
declare
  v_room    uuid   := (select v::uuid from _t where k = 'room');
  v_expense uuid   := (select v::uuid from _t where k = 'selfcharge');
  v_nav     bigint;
  r         record;
begin
  select * into r from expenses where id = v_expense;
  assert r.split_type = 'personal',
    format('a trip only for yourself is a personal expense, got %s', r.split_type);
  assert (select count(*) from expense_splits where expense_id = v_expense) = 1,
    'it has one share';
  assert (select owed_cents from expense_splits where expense_id = v_expense) = 1000,
    'and that share is the whole amount';

  select net_cents into v_nav from room_balances(v_room)
    where user_id = '22222222-2222-2222-2222-222222222222';
  assert v_nav = (select v::bigint from _t where k = 'nav_before') + 3500,
    'spending on yourself must not move your balance at all';
  assert (select sum(net_cents) from room_balances(v_room)) = 0,
    'balances must still net to zero';
  raise notice 'ok: a trip entirely for yourself is personal and moves nobody';
end $$;

reset role;
set role anon;
do $$
begin
  perform charge_shopping_items(gen_random_uuid(), 'anon', current_date, '[]'::jsonb);
  raise exception 'TEST FAILED: anon can call charge_shopping_items';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: anon cannot charge anything (%)', sqlerrm;
end $$;

reset role;
\echo '=== ALL SHOPPING CHARGE CHECKS PASSED ==='
