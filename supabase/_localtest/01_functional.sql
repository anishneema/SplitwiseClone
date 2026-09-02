-- Functional checks for 20260830000000_init.sql, run against a plain Postgres seeded with
-- the stubs in 00_supabase_stubs.sql. Any failed assertion aborts the script.

-- ---------------------------------------------------------------- seed users
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'anish@example.com',
     '{"full_name":"Anish","avatar_url":"https://example.com/a.png"}'),
  ('22222222-2222-2222-2222-222222222222', 'nav@example.com',   '{"full_name":"Nav"}'),
  ('33333333-3333-3333-3333-333333333333', 'sam@example.com',   '{"name":"Sam"}'),
  ('44444444-4444-4444-4444-444444444444', 'nosy@example.com',  '{}');

do $$
begin
  assert (select count(*) from profiles) = 4,
    'the auth.users trigger should have created 4 profiles';
  assert (select display_name from profiles where email = 'anish@example.com') = 'Anish',
    'display_name should come from Google full_name';
  assert (select display_name from profiles where email = 'sam@example.com') = 'Sam',
    'display_name should fall back to Google name';
  assert (select display_name from profiles where email = 'nosy@example.com') = 'nosy',
    'display_name should fall back to the email local-part';
  raise notice 'ok: profile trigger populates display names from Google metadata';
end $$;

create table _t (k text primary key, v text);
grant all on _t to authenticated;

-- ------------------------------------------------------ create + join a room
set role authenticated;
set test.uid = '11111111-1111-1111-1111-111111111111';

insert into _t values ('room', (select (create_room('Apartment 4B', 'room', 'link',
  array['nav@example.com'])).id::text));

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  assert (select count(*) from room_members where room_id = v_room) = 1,
    'creator should be the only member';
  assert (select role from room_members where room_id = v_room and user_id = auth.uid())
    = 'owner', 'creator should be owner';
  assert (select count(*) from room_invites where room_id = v_room) = 1,
    'the invite email should have been recorded';
  raise notice 'ok: create_room seeds the owner membership and invites atomically';
end $$;

-- Nav and Sam join through the link.
insert into _t values ('code', (select invite_code from rooms
  where id = (select v::uuid from _t where k = 'room')));

set test.uid = '22222222-2222-2222-2222-222222222222';
select join_room_with_code((select v from _t where k = 'code'));
select join_room_with_code((select v from _t where k = 'code'));  -- idempotent

set test.uid = '33333333-3333-3333-3333-333333333333';
select join_room_with_code((select v from _t where k = 'code'));

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  assert (select count(*) from room_members where room_id = v_room) = 3,
    'all three roommates should be members, with no duplicate from the repeat join';
  raise notice 'ok: join_room_with_code is idempotent';
end $$;

-- --------------------------------------------------------------- expenses
set test.uid = '11111111-1111-1111-1111-111111111111';

-- $30.00 paid by Anish, split equally three ways -> 1000 each.
select create_expense(
  (select v::uuid from _t where k = 'room'),
  'Costco run', 3000, '11111111-1111-1111-1111-111111111111',
  current_date, 'equal', null,
  '[{"user_id":"11111111-1111-1111-1111-111111111111","owed_cents":1000},
    {"user_id":"22222222-2222-2222-2222-222222222222","owed_cents":1000},
    {"user_id":"33333333-3333-3333-3333-333333333333","owed_cents":1000}]'::jsonb);

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  assert (select net_cents from room_balances(v_room)
          where user_id = '11111111-1111-1111-1111-111111111111') = 2000,
    'Anish paid 3000 and owes 1000, so he should be up 2000';
  assert (select net_cents from room_balances(v_room)
          where user_id = '22222222-2222-2222-2222-222222222222') = -1000,
    'Nav should owe 1000';
  assert (select sum(net_cents) from room_balances(v_room)) = 0,
    'balances must always net to zero';
  raise notice 'ok: equal split produces the expected balances';
end $$;

-- $45.00 paid by Nav, exact amounts 20/15/10.
set test.uid = '22222222-2222-2222-2222-222222222222';
select create_expense(
  (select v::uuid from _t where k = 'room'),
  'Internet bill', 4500, '22222222-2222-2222-2222-222222222222',
  current_date, 'exact', 'split by room size',
  '[{"user_id":"11111111-1111-1111-1111-111111111111","owed_cents":2000},
    {"user_id":"22222222-2222-2222-2222-222222222222","owed_cents":1500},
    {"user_id":"33333333-3333-3333-3333-333333333333","owed_cents":1000}]'::jsonb);

-- A personal expense: Sam buys his own lunch. Logged, but moves no balances.
set test.uid = '33333333-3333-3333-3333-333333333333';
select create_expense(
  (select v::uuid from _t where k = 'room'),
  'Sam lunch', 750, '33333333-3333-3333-3333-333333333333',
  current_date, 'personal', null,
  '[{"user_id":"33333333-3333-3333-3333-333333333333","owed_cents":750}]'::jsonb);

do $$
declare
  v_room uuid := (select v::uuid from _t where k = 'room');
  v_sam  bigint;
begin
  assert (select net_cents from room_balances(v_room)
          where user_id = '11111111-1111-1111-1111-111111111111') = 0,
    'Anish: paid 3000, owes 3000 -> square';
  assert (select net_cents from room_balances(v_room)
          where user_id = '22222222-2222-2222-2222-222222222222') = 2000,
    'Nav: paid 4500, owes 2500 -> up 2000';
  select net_cents into v_sam from room_balances(v_room)
    where user_id = '33333333-3333-3333-3333-333333333333';
  assert v_sam = -2000,
    format('Sam should owe 2000 (personal expense must not move it), got %s', v_sam);
  assert (select sum(net_cents) from room_balances(v_room)) = 0,
    'balances must always net to zero';
  raise notice 'ok: exact split and personal expense behave as intended';
end $$;

-- Sam settles up with Nav; everyone should land on zero.
insert into settlements (room_id, from_user, to_user, amount_cents, created_by)
values ((select v::uuid from _t where k = 'room'),
        '33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222',
        2000, '33333333-3333-3333-3333-333333333333');

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  assert (select count(*) from room_balances(v_room) where net_cents <> 0) = 0,
    'after settling up, every balance should be exactly zero';
  raise notice 'ok: settling up returns all balances to zero';
end $$;

-- ------------------------------------------------------- invariant guards
do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  perform create_expense(v_room, 'Bad math', 3000,
    '33333333-3333-3333-3333-333333333333', current_date, 'exact', null,
    '[{"user_id":"33333333-3333-3333-3333-333333333333","owed_cents":2999}]'::jsonb);
  raise exception 'TEST FAILED: splits that do not sum to the total were accepted';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: rejected mismatched splits (%)', sqlerrm;
end $$;

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  perform create_expense(v_room, 'Outsider split', 1000,
    '33333333-3333-3333-3333-333333333333', current_date, 'equal', null,
    '[{"user_id":"44444444-4444-4444-4444-444444444444","owed_cents":1000}]'::jsonb);
  raise exception 'TEST FAILED: a non-member was accepted into a split';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: rejected a non-member participant (%)', sqlerrm;
end $$;

do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  perform create_expense(v_room, 'Nobody', 1000,
    '33333333-3333-3333-3333-333333333333', current_date, 'equal', null, '[]'::jsonb);
  raise exception 'TEST FAILED: an expense with no participants was accepted';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: rejected an expense with no participants (%)', sqlerrm;
end $$;

-- expense_splits has no write policy, so nothing but the RPCs may touch it.
do $$
begin
  insert into expense_splits (expense_id, room_id, user_id, owed_cents)
  values ((select id from expenses limit 1),
          (select v::uuid from _t where k = 'room'),
          '33333333-3333-3333-3333-333333333333', 1);
  raise exception 'TEST FAILED: a client was able to write expense_splits directly';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: expense_splits is not directly writable (%)', sqlerrm;
end $$;

do $$
begin
  insert into rooms (name, created_by)
  values ('Sneaky room', '33333333-3333-3333-3333-333333333333');
  raise exception 'TEST FAILED: rooms were insertable outside create_room()';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: rooms must be created through create_room() (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------- chores + RLS
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into chores (room_id, title, assigned_to, due_date, created_by)
values ((select v::uuid from _t where k = 'room'), 'Take out trash',
        '22222222-2222-2222-2222-222222222222', current_date,
        '11111111-1111-1111-1111-111111111111');

set test.uid = '22222222-2222-2222-2222-222222222222';
update chores set done = true where title = 'Take out trash';

do $$
begin
  assert (select done_by from chores where title = 'Take out trash')
    = '22222222-2222-2222-2222-222222222222',
    'the database should record who ticked the chore, not the client';
  assert (select done_at from chores where title = 'Take out trash') is not null,
    'done_at should be stamped on completion';
  raise notice 'ok: chore completion is attributed server-side';
end $$;

update chores set done = false where title = 'Take out trash';
do $$
begin
  assert (select done_by from chores where title = 'Take out trash') is null
     and (select done_at from chores where title = 'Take out trash') is null,
    'un-ticking a chore should clear its completion stamps';
  raise notice 'ok: un-ticking a chore clears its completion stamps';
end $$;

-- The outsider is signed in, but belongs to no room.
set test.uid = '44444444-4444-4444-4444-444444444444';
do $$
declare v_room uuid := (select v::uuid from _t where k = 'room');
begin
  assert (select count(*) from rooms) = 0,          'outsider must not see the room';
  assert (select count(*) from expenses) = 0,       'outsider must not see expenses';
  assert (select count(*) from expense_splits) = 0, 'outsider must not see splits';
  assert (select count(*) from chores) = 0,         'outsider must not see chores';
  assert (select count(*) from settlements) = 0,    'outsider must not see settlements';
  assert (select count(*) from room_members) = 0,   'outsider must not see the roster';
  assert (select count(*) from room_balances(v_room)) = 0,
    'room_balances must be empty for a non-member';
  assert (select count(*) from profiles) = 1,
    'outsider should only see their own profile';
  raise notice 'ok: RLS hides every room table from a non-member';
end $$;

do $$
begin
  perform join_room_with_code('not-a-real-code');
  raise exception 'TEST FAILED: a bogus invite code was accepted';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: rejected a bogus invite code (%)', sqlerrm;
end $$;

-- ---------------------------------------------------- allowlist invite mode
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into _t values ('trip', (select (create_room('Miami trip', 'trip', 'allowlist',
  array['nav@example.com'])).id::text));
insert into _t values ('tripcode', (select invite_code from rooms
  where id = (select v::uuid from _t where k = 'trip')));

set test.uid = '44444444-4444-4444-4444-444444444444';
do $$
begin
  perform join_room_with_code((select v from _t where k = 'tripcode'));
  raise exception 'TEST FAILED: allowlist mode admitted an uninvited email';
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  raise notice 'ok: allowlist mode refused an uninvited email (%)', sqlerrm;
end $$;

set test.uid = '22222222-2222-2222-2222-222222222222';
select join_room_with_code((select v from _t where k = 'tripcode'));
do $$
declare v_trip uuid := (select v::uuid from _t where k = 'trip');
begin
  assert is_member(v_trip, '22222222-2222-2222-2222-222222222222'),
    'an allowlisted email should be able to join';
  raise notice 'ok: allowlist mode admits an invited email';
end $$;

set test.uid = '11111111-1111-1111-1111-111111111111';
do $$
declare v_trip uuid := (select v::uuid from _t where k = 'trip');
begin
  assert (select accepted_at from room_invites
          where room_id = v_trip and email = 'nav@example.com') is not null,
    'accepting an allowlist invite should stamp accepted_at';
  raise notice 'ok: accepted invites are stamped';
end $$;

reset role;
\echo '=== ALL FUNCTIONAL CHECKS PASSED ==='
