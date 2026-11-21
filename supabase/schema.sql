-- =====================================================================
-- Claude AI Class — Attendance (Supabase backend v2.0.0)
-- Tables: admins, settings, roster, attendance  ·  RLS on every table
-- Students can only check themselves in (via check_in RPC);
-- signatures are readable only by the student themself and admins.
-- =====================================================================

-- ---------- Admins ----------
create table public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins enable row level security;
-- no policies: only security-definer functions read this table
insert into public.admins (email) values ('kongtipoom.mane@gmail.com');

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- Settings (single row) ----------
create table public.settings (
  id          int primary key default 1 check (id = 1),
  title       text not null default 'Claude AI Class' check (char_length(title) between 1 and 120),
  start_time  time not null default '09:00',
  late_after  int  not null default 15 check (late_after between 0 and 180),
  timezone    text not null default 'Asia/Bangkok',
  updated_at  timestamptz not null default now()
);
insert into public.settings default values;
alter table public.settings enable row level security;
create policy "settings: signed-in users read" on public.settings
  for select to authenticated using (true);
create policy "settings: admins update" on public.settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- Roster ----------
create table public.roster (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  code        text not null default '' check (char_length(code) <= 40),
  grp         text not null default '' check (char_length(grp) <= 120),
  email       text check (email is null or email = lower(email)),
  sort_order  int  not null default 0,
  user_id     uuid unique references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index roster_name_unique on public.roster (lower(regexp_replace(name, '\s', '', 'g')));
create index roster_sort_idx on public.roster (sort_order);
alter table public.roster enable row level security;
-- students never read this table directly (they use class_board / my_profile)
create policy "roster: admins read"   on public.roster for select to authenticated using ((select public.is_admin()));
create policy "roster: admins insert" on public.roster for insert to authenticated with check ((select public.is_admin()));
create policy "roster: admins update" on public.roster for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "roster: admins delete" on public.roster for delete to authenticated using ((select public.is_admin()));

-- ---------- Attendance ----------
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  roster_id   uuid not null references public.roster (id) on delete cascade,
  class_date  date not null,
  checked_at  timestamptz not null default now(),
  status      text not null check (status in ('on', 'late')),
  signature   text check (signature is null or (signature ~ '^data:image/(png|jpeg);base64,' and char_length(signature) < 600000)),
  device      text not null default '' check (char_length(device) <= 40),
  checked_by  uuid,
  unique (roster_id, class_date)
);
create index attendance_date_idx on public.attendance (class_date);
alter table public.attendance enable row level security;
-- (roster is admin-only under RLS, so own-row lookup goes through a security-definer helper)
create or replace function public.my_roster_id()
returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.roster where user_id = auth.uid() $$;

create policy "attendance: own rows or admins read" on public.attendance
  for select to authenticated using (
    (select public.is_admin()) or roster_id = (select public.my_roster_id())
  );
create policy "attendance: admins delete" on public.attendance
  for delete to authenticated using ((select public.is_admin()));
-- no insert/update policies: rows are written only by check_in()

-- ---------- RPC: who am I ----------
create or replace function public.my_profile()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_tz    text;
  r       public.roster;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select timezone into v_tz from public.settings where id = 1;
  select * into r from public.roster where user_id = v_uid;
  -- auto-link when the teacher stored this student's email in the roster
  if not found and v_email <> '' then
    update public.roster set user_id = v_uid
      where id = (select id from public.roster where email = v_email and user_id is null limit 1)
      returning * into r;
  end if;
  return jsonb_build_object(
    'version',  public.backend_version(),
    'now',      (extract(epoch from now()) * 1000)::bigint,
    'today',    (now() at time zone v_tz)::date,
    'email',    v_email,
    'is_admin', public.is_admin(),
    'roster',   case when r.id is null then null
                else jsonb_build_object('id', r.id, 'name', r.name, 'code', r.code, 'grp', r.grp) end
  );
end;
$$;

create or replace function public.backend_version()
returns text language sql immutable set search_path = '' as $$ select '2.0.0'::text $$;

-- ---------- RPC: class board (names + status only, no signatures/emails) ----------
create or replace function public.class_board(p_date date default null)
returns table (id uuid, name text, grp text, sort_order int, claimed boolean, is_me boolean,
               class_date date, checked_at timestamptz, status text)
language sql stable security definer set search_path = ''
as $$
  with d as (
    select coalesce(p_date, (now() at time zone s.timezone)::date) as dt
    from public.settings s where s.id = 1
  )
  select r.id, r.name, r.grp, r.sort_order,
         r.user_id is not null,
         coalesce(r.user_id = auth.uid(), false),
         d.dt, a.checked_at, a.status
  from public.roster r
  cross join d
  left join public.attendance a on a.roster_id = r.id and a.class_date = d.dt
  where auth.uid() is not null
  order by r.sort_order, r.name;
$$;

-- ---------- RPC: claim my name (once) ----------
create or replace function public.claim_roster(p_roster_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare r public.roster;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.roster where user_id = auth.uid()) then raise exception 'already_linked'; end if;
  update public.roster set user_id = auth.uid()
    where id = p_roster_id and user_id is null
    returning * into r;
  if r.id is null then raise exception 'taken'; end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'code', r.code, 'grp', r.grp);
end;
$$;

-- ---------- RPC: check in (server time, own name only unless admin) ----------
create or replace function public.check_in(p_roster_id uuid, p_signature text, p_device text default '')
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  s        public.settings;
  r        public.roster;
  v_now    timestamptz := now();
  v_local  timestamp;
  v_status text;
  a        public.attendance;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into r from public.roster where id = p_roster_id;
  if r.id is null then raise exception 'not_found'; end if;
  if r.user_id is distinct from auth.uid() and not public.is_admin() then raise exception 'not_your_name'; end if;
  if p_signature is null or p_signature !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' or char_length(p_signature) >= 600000 then
    raise exception 'bad_signature';
  end if;
  select * into s from public.settings where id = 1;
  v_local  := v_now at time zone s.timezone;
  v_status := case when date_trunc('minute', v_local)::time > s.start_time + make_interval(mins => s.late_after)
                   then 'late' else 'on' end;
  insert into public.attendance (roster_id, class_date, checked_at, status, signature, device, checked_by)
    values (r.id, v_local::date, v_now, v_status, p_signature, left(coalesce(p_device, ''), 40), auth.uid())
    on conflict (roster_id, class_date) do nothing
    returning * into a;
  if a.id is null then raise exception 'already_checked_in'; end if;
  return jsonb_build_object('roster_id', a.roster_id, 'class_date', a.class_date, 'checked_at', a.checked_at,
                            'status', a.status, 'device', a.device);
end;
$$;

-- ---------- Function privileges ----------
revoke execute on function public.is_admin(), public.my_roster_id(), public.my_profile(), public.class_board(date),
  public.claim_roster(uuid), public.check_in(uuid, text, text) from public, anon;
grant execute on function public.is_admin(), public.my_roster_id(), public.my_profile(), public.class_board(date),
  public.claim_roster(uuid), public.check_in(uuid, text, text), public.backend_version() to authenticated;

-- ---------- Table privileges (RLS above still decides which rows) ----------
grant usage on schema public to authenticated;
grant select, update on public.settings to authenticated;
grant select, insert, update, delete on public.roster to authenticated;
grant select, delete on public.attendance to authenticated;
revoke all on public.admins from anon, authenticated;
revoke all on public.settings, public.roster, public.attendance from anon;
