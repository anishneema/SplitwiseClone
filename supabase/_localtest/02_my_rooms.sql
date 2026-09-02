-- my_rooms() must agree with room_balances() and stay empty for a non-member.
set role authenticated;

set test.uid = '22222222-2222-2222-2222-222222222222';
do $$
declare r record;
begin
  assert (select count(*) from my_rooms()) = 2,
    'Nav belongs to the apartment and the Miami trip';
  select * into r from my_rooms() where name = 'Apartment 4B';
  assert r.member_count = 3, format('expected 3 members, got %s', r.member_count);
  assert r.my_net_cents = 0, format('Nav settled up, expected 0, got %s', r.my_net_cents);
  assert r.open_chore_count = 1, format('one open chore expected, got %s', r.open_chore_count);
  raise notice 'ok: my_rooms() reports members, balance and open chores';
end $$;

set test.uid = '44444444-4444-4444-4444-444444444444';
do $$
begin
  assert (select count(*) from my_rooms()) = 0,
    'a non-member must see no rooms';
  raise notice 'ok: my_rooms() is empty for a non-member';
end $$;

reset role;
\echo '=== my_rooms CHECKS PASSED ==='
