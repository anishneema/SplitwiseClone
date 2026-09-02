-- Roommate expenses + chores: initial schema.
--
-- Design notes:
--   * All money is integer cents (bigint). Never floats.
--   * Every expense resolves to explicit expense_splits rows summing exactly to
--     the expense total. Writes go through create_expense/update_expense so the
--     invariant cannot be violated from the browser.
--   * RLS membership checks go through SECURITY DEFINER helpers. A policy on
--     room_members that queries room_members directly recurses infinitely.

-- ---------------------------------------------------------------- enum types
create type room_kind   as enum ('room', 'trip');
create type invite_mode as enum ('link', 'allowlist');
create type split_type  as enum ('equal', 'exact', 'percent', 'personal');
create type member_role as enum ('owner', 'member');

-- ------------------------------------------------------------------ profiles
-- Deliberately NOT a foreign key onto auth.users. Expenses, splits and
-- settlements all reference profiles, and a person's share of a bill has to
-- survive them losing access -- otherwise deleting one auth user either fails
-- on a foreign key or silently rewrites everyone else's balances.
--
-- So profiles is the durable identity record, keyed by the auth user id and
-- kept in sync by the trigger below. Deleting the auth user just means they can
-- no longer sign in; their history stays put.
create table profiles (
  id           uuid primary key,
  email        text not null,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Mirror a new Google sign-in into profiles. Runs as definer so it can read
-- auth.users metadata.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, 'roommate'), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email      = excluded.email,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Keep email/avatar fresh when Google data changes, without clobbering a
-- display_name the user edited themselves.
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function handle_new_user();

-- --------------------------------------------------------------------- rooms
create table rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  kind        room_kind not null default 'room',
  -- Short random slug used in the /join/<code> invite URL.
  invite_code text not null unique
                default substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16),
  invite_mode invite_mode not null default 'link',
  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now()
);

create table room_members (
  room_id   uuid not null references rooms (id) on delete cascade,
  user_id   uuid not null references profiles (id) on delete cascade,
  role      member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on room_members (user_id);

create table room_invites (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms (id) on delete cascade,
  email       text not null,
  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (room_id, email)
);

-- Emails are compared, so normalize on the way in rather than trusting callers.
create function normalize_invite_email() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if new.email = '' or new.email not like '%_@_%' then
    raise exception 'invalid email address';
  end if;
  return new;
end;
$$;

create trigger room_invites_normalize_email
  before insert or update on room_invites
  for each row execute function normalize_invite_email();

-- ------------------------------------------------------------------ expenses
create table expenses (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  description  text not null check (length(trim(description)) > 0),
  amount_cents bigint not null check (amount_cents > 0),
  paid_by      uuid not null references profiles (id),
  spent_at     date not null default current_date,
  -- Remembered only so the edit dialog can reopen in the mode it was created
  -- in; balance math reads expense_splits regardless.
  split_type   split_type not null,
  notes        text,
  created_by   uuid not null references profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index expenses_room_date_idx on expenses (room_id, spent_at desc, created_at desc);

create table expense_splits (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses (id) on delete cascade,
  -- Denormalized from expenses so RLS is a single is_room_member() call and
  -- Realtime can filter on room_id. Only ever set by the expense RPCs.
  room_id    uuid not null references rooms (id) on delete cascade,
  user_id    uuid not null references profiles (id),
  owed_cents bigint not null check (owed_cents >= 0),
  unique (expense_id, user_id)
);
create index expense_splits_room_user_idx on expense_splits (room_id, user_id);

create table settlements (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  from_user    uuid not null references profiles (id),
  to_user      uuid not null references profiles (id),
  amount_cents bigint not null check (amount_cents > 0),
  settled_at   date not null default current_date,
  note         text,
  created_by   uuid not null references profiles (id),
  created_at   timestamptz not null default now(),
  check (from_user <> to_user)
);
create index settlements_room_idx on settlements (room_id, settled_at desc);

-- -------------------------------------------------------------------- chores
create table chores (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms (id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  notes       text,
  assigned_to uuid references profiles (id) on delete set null,
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references profiles (id),
  position    double precision not null default 0,
  created_by  uuid not null references profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index chores_room_idx on chores (room_id, done, position);

-- Clients toggle `done`; the database records who ticked it and when.
create function chores_sync_done() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.done is distinct from old.done then
    if new.done then
      new.done_at := now();
      new.done_by := auth.uid();
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger chores_before_update
  before update on chores
  for each row execute function chores_sync_done();

create function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger expenses_touch_updated_at
  before update on expenses
  for each row execute function touch_updated_at();

-- ------------------------------------------------------- membership helpers
-- SECURITY DEFINER so RLS policies on room_members can call them without
-- recursing into room_members' own policy.
create function is_member(p_room_id uuid, p_user_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from room_members
    where room_id = p_room_id and user_id = p_user_id
  );
$$;

create function is_room_member(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create function is_room_owner(p_room_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from room_members
    where room_id = p_room_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- You can see someone's profile if you share at least one room with them.
create function shares_room_with(p_user_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from room_members mine
    join room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;

-- ------------------------------------------------------------------- row-level
alter table profiles       enable row level security;
alter table rooms          enable row level security;
alter table room_members   enable row level security;
alter table room_invites   enable row level security;
alter table expenses       enable row level security;
alter table expense_splits enable row level security;
alter table settlements    enable row level security;
alter table chores         enable row level security;

create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or shares_room_with(id));
create policy profiles_update_self on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Rooms are created through create_room() so the owner membership row lands in
-- the same transaction; there is deliberately no insert policy.
create policy rooms_select on rooms for select to authenticated
  using (is_room_member(id));
create policy rooms_update_owner on rooms for update to authenticated
  using (is_room_owner(id)) with check (is_room_owner(id));
create policy rooms_delete_owner on rooms for delete to authenticated
  using (is_room_owner(id));

-- Joining happens through join_room_with_code(); no insert policy here either.
create policy room_members_select on room_members for select to authenticated
  using (is_room_member(room_id));
create policy room_members_delete on room_members for delete to authenticated
  using (user_id = auth.uid() or is_room_owner(room_id));

create policy room_invites_select on room_invites for select to authenticated
  using (is_room_member(room_id));
create policy room_invites_insert on room_invites for insert to authenticated
  with check (is_room_member(room_id) and created_by = auth.uid());
create policy room_invites_delete on room_invites for delete to authenticated
  using (is_room_member(room_id));

-- Expenses are inserted/updated only by create_expense()/update_expense(), which
-- validate that the splits sum to the total. Deleting is safe directly because
-- the split rows cascade away with it.
create policy expenses_select on expenses for select to authenticated
  using (is_room_member(room_id));
create policy expenses_delete on expenses for delete to authenticated
  using (is_room_member(room_id));

-- Read-only to clients. No write policy at all: the sum-equals-total invariant
-- lives in the RPCs, so nothing else may touch these rows.
create policy expense_splits_select on expense_splits for select to authenticated
  using (is_room_member(room_id));

create policy settlements_select on settlements for select to authenticated
  using (is_room_member(room_id));
create policy settlements_insert on settlements for insert to authenticated
  with check (
    is_room_member(room_id)
    and created_by = auth.uid()
    and is_member(room_id, from_user)
    and is_member(room_id, to_user)
  );
create policy settlements_delete on settlements for delete to authenticated
  using (is_room_member(room_id));

create policy chores_select on chores for select to authenticated
  using (is_room_member(room_id));
create policy chores_insert on chores for insert to authenticated
  with check (
    is_room_member(room_id)
    and created_by = auth.uid()
    and (assigned_to is null or is_member(room_id, assigned_to))
  );
create policy chores_update on chores for update to authenticated
  using (is_room_member(room_id))
  with check (
    is_room_member(room_id)
    and (assigned_to is null or is_member(room_id, assigned_to))
  );
create policy chores_delete on chores for delete to authenticated
  using (is_room_member(room_id));

-- =============================================================== room RPCs
-- Creating a room and its owner-membership row must be atomic, otherwise a
-- failure between the two leaves a room nobody can see.
create function create_room(
  p_name          text,
  p_kind          room_kind   default 'room',
  p_invite_mode   invite_mode default 'link',
  p_invite_emails text[]      default '{}'
) returns rooms
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_room  rooms;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into rooms (name, kind, invite_mode, created_by)
  values (trim(p_name), p_kind, p_invite_mode, v_uid)
  returning * into v_room;

  insert into room_members (room_id, user_id, role)
  values (v_room.id, v_uid, 'owner');

  foreach v_email in array coalesce(p_invite_emails, '{}'::text[]) loop
    if length(trim(v_email)) > 0 then
      insert into room_invites (room_id, email, created_by)
      values (v_room.id, v_email, v_uid)
      on conflict (room_id, email) do nothing;
    end if;
  end loop;

  return v_room;
end;
$$;

-- Lets the /join/<code> page name the room before you commit to joining.
-- A non-member cannot select from rooms, hence the definer.
create function peek_room_by_code(p_code text)
returns table (name text, kind room_kind, invite_mode invite_mode, member_count bigint)
language sql security definer stable set search_path = public as $$
  select r.name,
         r.kind,
         r.invite_mode,
         (select count(*) from room_members m where m.room_id = r.id)
  from rooms r
  where r.invite_code = p_code;
$$;

create function join_room_with_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_room  rooms;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_room from rooms where invite_code = p_code;
  if v_room.id is null then
    raise exception 'That invite link is not valid.' using errcode = 'P0002';
  end if;

  -- Idempotent: re-opening the link when you are already in is a no-op.
  if is_member(v_room.id, v_uid) then
    return v_room.id;
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;

  if v_room.invite_mode = 'allowlist' then
    if not exists (
      select 1 from room_invites
      where room_id = v_room.id and email = v_email
    ) then
      raise exception
        'This room only accepts invited email addresses, and % is not on the list.', v_email
        using errcode = '42501';
    end if;
    update room_invites
      set accepted_at = now()
      where room_id = v_room.id and email = v_email and accepted_at is null;
  end if;

  insert into room_members (room_id, user_id) values (v_room.id, v_uid);
  return v_room.id;
end;
$$;

-- ============================================================ expense RPCs
-- Shared gate for create/update: the splits must cover the total exactly and
-- name only room members.
create function validate_splits(
  p_room_id      uuid,
  p_amount_cents bigint,
  p_paid_by      uuid,
  p_splits       jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sum      bigint;
  v_rows     int;
  v_distinct int;
begin
  if p_splits is null
     or jsonb_typeof(p_splits) <> 'array'
     or jsonb_array_length(p_splits) = 0 then
    raise exception 'An expense needs at least one participant.';
  end if;

  if not is_member(p_room_id, p_paid_by) then
    raise exception 'The payer is not a member of this room.';
  end if;

  select coalesce(sum((s ->> 'owed_cents')::bigint), 0),
         count(*),
         count(distinct (s ->> 'user_id'))
    into v_sum, v_rows, v_distinct
    from jsonb_array_elements(p_splits) s;

  if v_rows <> v_distinct then
    raise exception 'The same person appears twice in the split.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_splits) s
    where (s ->> 'owed_cents')::bigint < 0
  ) then
    raise exception 'Split amounts cannot be negative.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_splits) s
    where not is_member(p_room_id, (s ->> 'user_id')::uuid)
  ) then
    raise exception 'Everyone in the split must be a member of this room.';
  end if;

  if v_sum <> p_amount_cents then
    raise exception 'The split adds up to %.% but the expense is %.%',
      v_sum / 100, lpad((abs(v_sum) % 100)::text, 2, '0'),
      p_amount_cents / 100, lpad((abs(p_amount_cents) % 100)::text, 2, '0');
  end if;
end;
$$;

create function create_expense(
  p_room_id      uuid,
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
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not is_room_member(p_room_id) then
    raise exception 'not a member of this room' using errcode = '42501';
  end if;

  perform validate_splits(p_room_id, p_amount_cents, p_paid_by, p_splits);

  insert into expenses (room_id, description, amount_cents, paid_by, spent_at,
                        split_type, notes, created_by)
  values (p_room_id, trim(p_description), p_amount_cents, p_paid_by,
          coalesce(p_spent_at, current_date), p_split_type,
          nullif(trim(coalesce(p_notes, '')), ''), v_uid)
  returning id into v_id;

  insert into expense_splits (expense_id, room_id, user_id, owed_cents)
  select v_id, p_room_id, (s ->> 'user_id')::uuid, (s ->> 'owed_cents')::bigint
  from jsonb_array_elements(p_splits) s;

  return v_id;
end;
$$;

create function update_expense(
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
  v_room_id uuid;
begin
  select room_id into v_room_id from expenses where id = p_expense_id;
  if v_room_id is null then
    raise exception 'That expense no longer exists.' using errcode = 'P0002';
  end if;
  if not is_room_member(v_room_id) then
    raise exception 'not a member of this room' using errcode = '42501';
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

-- ================================================================ balances
-- net_cents > 0 means the room owes this person; < 0 means they owe the room.
-- Sanity check: A owes B $10 -> net_A = -1000, net_B = +1000. After A settles
-- $10 to B both return to 0. sum(net_cents) over a room is always 0.
--
-- Deliberately SECURITY INVOKER: RLS then does the access control for us, so a
-- non-member simply gets an empty result set.
create function room_balances(p_room_id uuid)
returns table (
  user_id    uuid,
  paid_cents bigint,
  owed_cents bigint,
  net_cents  bigint
)
language sql stable set search_path = public as $$
  with members as (
    select m.user_id from room_members m where m.room_id = p_room_id
  ),
  paid as (
    select e.paid_by as user_id, sum(e.amount_cents) as cents
    from expenses e where e.room_id = p_room_id group by 1
  ),
  owed as (
    select s.user_id, sum(s.owed_cents) as cents
    from expense_splits s where s.room_id = p_room_id group by 1
  ),
  sent as (
    select t.from_user as user_id, sum(t.amount_cents) as cents
    from settlements t where t.room_id = p_room_id group by 1
  ),
  received as (
    select t.to_user as user_id, sum(t.amount_cents) as cents
    from settlements t where t.room_id = p_room_id group by 1
  )
  select m.user_id,
         coalesce(p.cents, 0)::bigint,
         coalesce(o.cents, 0)::bigint,
         (coalesce(p.cents, 0) + coalesce(s.cents, 0)
          - coalesce(o.cents, 0) - coalesce(r.cents, 0))::bigint
  from members m
  left join paid     p on p.user_id = m.user_id
  left join owed     o on o.user_id = m.user_id
  left join sent     s on s.user_id = m.user_id
  left join received r on r.user_id = m.user_id;
$$;

-- One query for the home screen: every room you belong to, with its member
-- count, your net balance in it, and when it was last touched. Avoids an
-- N+1 balance query per room card.
create function my_rooms()
returns table (
  id               uuid,
  name             text,
  kind             room_kind,
  invite_code      text,
  invite_mode      invite_mode,
  created_by       uuid,
  created_at       timestamptz,
  member_count     bigint,
  my_net_cents     bigint,
  open_chore_count bigint,
  last_activity_at timestamptz
)
language sql stable set search_path = public as $$
  select r.id,
         r.name,
         r.kind,
         r.invite_code,
         r.invite_mode,
         r.created_by,
         r.created_at,
         (select count(*) from room_members m where m.room_id = r.id) as member_count,
         coalesce((select b.net_cents from room_balances(r.id) b
                   where b.user_id = auth.uid()), 0) as my_net_cents,
         (select count(*) from chores c
          where c.room_id = r.id and not c.done) as open_chore_count,
         greatest(
           r.created_at,
           coalesce((select max(e.created_at) from expenses e where e.room_id = r.id),
                    r.created_at),
           coalesce((select max(c.updated_at) from chores c where c.room_id = r.id),
                    r.created_at)
         ) as last_activity_at
  from rooms r
  where is_room_member(r.id)
  order by last_activity_at desc;
$$;

-- ================================================================ realtime
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the whole old row, which
-- Realtime needs to apply RLS before forwarding them.
alter table expenses       replica identity full;
alter table expense_splits replica identity full;
alter table settlements    replica identity full;
alter table chores         replica identity full;
alter table room_members   replica identity full;

do $$
declare t text;
begin
  foreach t in array array['expenses', 'expense_splits', 'settlements', 'chores', 'room_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ================================================================== grants
-- This app has no anonymous surface; everything requires a signed-in user.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
