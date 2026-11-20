-- CareCircle schema
-- Model: a "care circle" is one person being cared for (Dad) plus the family
-- members who coordinate. Every row of care data belongs to exactly one circle,
-- and Row Level Security only lets members of that circle see it.
--
-- Google Calendar owns confirmed appointments. This database owns:
--   * the queue of things that still need scheduling (care_items)
--   * scanned paperwork and what was extracted from it (documents)
--   * medications and standing instructions
--   * who is in the circle and what they can do

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_role as enum ('admin', 'editor', 'viewer');
create type item_kind   as enum ('appointment', 'lab', 'imaging', 'procedure', 'referral', 'other');
create type item_status as enum ('to_schedule', 'scheduled', 'done', 'dismissed');
create type urgency     as enum ('urgent', 'soon', 'routine');
create type doc_status  as enum ('uploaded', 'processing', 'ready', 'failed');

-- ---------------------------------------------------------------------------
-- Circles and membership
-- ---------------------------------------------------------------------------
create table care_circles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 80),
  patient_name  text not null check (char_length(patient_name) between 1 and 80),
  timezone      text not null default 'America/Los_Angeles',
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now()
);

create table circle_members (
  circle_id       uuid not null references care_circles(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            member_role not null default 'editor',
  email           text not null,
  display_name    text,
  -- When true, this person is added as a guest on every calendar event, so the
  -- appointment shows up in their own Google Calendar with normal reminders.
  calendar_invites boolean not null default true,
  joined_at       timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index circle_members_user_idx on circle_members(user_id);

create table circle_invites (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references care_circles(id) on delete cascade,
  email       text not null check (email = lower(email) and email like '%@%'),
  role        member_role not null default 'editor',
  invited_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  unique (circle_id, email)
);

-- ---------------------------------------------------------------------------
-- Care data
-- ---------------------------------------------------------------------------
create table providers (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references care_circles(id) on delete cascade,
  name       text not null,
  specialty  text,
  phone      text,
  address    text,
  created_at timestamptz not null default now(),
  unique (circle_id, name)
);

create table documents (
  id            uuid primary key default gen_random_uuid(),
  circle_id     uuid not null references care_circles(id) on delete cascade,
  -- Paths inside the private 'documents' storage bucket, always prefixed
  -- with the circle id: "<circle_id>/<doc_id>/page-1.jpg"
  storage_paths text[] not null default '{}',
  status        doc_status not null default 'uploaded',
  title         text,
  provider_name text,
  visit_date    date,
  summary       text,
  extraction    jsonb,          -- raw structured output from the model, kept for audit
  error         text,
  confirmed_at  timestamptz,    -- set once the family reviewed and added items
  uploaded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index documents_circle_idx on documents(circle_id, created_at desc);

create table care_items (
  id                uuid primary key default gen_random_uuid(),
  circle_id         uuid not null references care_circles(id) on delete cascade,
  kind              item_kind not null default 'appointment',
  title             text not null check (char_length(title) between 1 and 200),
  status            item_status not null default 'to_schedule',
  urgency           urgency not null default 'routine',
  provider_id       uuid references providers(id) on delete set null,
  due_by            date,          -- hard date when known
  due_hint          text,          -- the paper's own words: "within 3 months"
  details           text,
  prep_instructions text,
  source_quote      text,          -- short excerpt from the paper, for checking
  document_id       uuid references documents(id) on delete set null,
  -- Filled once scheduled. Google Calendar is the source of truth for the
  -- time; these are a cached copy reconciled when the agenda loads.
  scheduled_start   timestamptz,
  scheduled_end     timestamptz,
  location          text,
  gcal_event_id     text,
  completed_at      timestamptz,
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index care_items_queue_idx on care_items(circle_id, status, due_by);

create table medications (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references care_circles(id) on delete cascade,
  name         text not null,
  dose         text,
  frequency    text,
  instructions text,
  change_type  text check (change_type in ('new', 'changed', 'stopped', 'continue')),
  start_date   date,
  end_date     date,
  active       boolean not null default true,
  document_id  uuid references documents(id) on delete set null,
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Standing instructions that aren't appointments or meds:
-- "no driving for 24h", "call if fever over 101", "keep dressing dry".
create table care_notes (
  id          uuid primary key default gen_random_uuid(),
  circle_id   uuid not null references care_circles(id) on delete cascade,
  body        text not null,
  is_warning  boolean not null default false,  -- "call the doctor if..."
  active      boolean not null default true,
  document_id uuid references documents(id) on delete set null,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Who changed what. Written only by triggers, readable by members.
create table activity_log (
  id         bigint generated always as identity primary key,
  circle_id  uuid not null references care_circles(id) on delete cascade,
  actor      uuid references auth.users(id),
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  summary    text,
  at         timestamptz not null default now()
);
create index activity_circle_idx on activity_log(circle_id, at desc);

-- ---------------------------------------------------------------------------
-- Google Calendar connection. One per circle, created by an admin.
-- The refresh token is AES-256-GCM encrypted by the app before it gets here.
-- RLS is enabled with NO policies: only the server (service role) can touch it.
-- ---------------------------------------------------------------------------
create table google_connections (
  circle_id         uuid primary key references care_circles(id) on delete cascade,
  google_email      text not null,
  calendar_id       text,
  refresh_token_enc text not null,
  scope             text not null,
  connected_by      uuid not null references auth.users(id),
  connected_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so policies can call them without
-- recursing into circle_members' own RLS.
-- ---------------------------------------------------------------------------
create or replace function is_member(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from circle_members where circle_id = c and user_id = auth.uid());
$$;

create or replace function can_edit(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_members
    where circle_id = c and user_id = auth.uid() and role in ('admin', 'editor')
  );
$$;

create or replace function is_admin(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from circle_members
    where circle_id = c and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Create a circle and make the caller its admin, atomically.
create or replace function create_circle(p_name text, p_patient_name text, p_timezone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  me_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  me_name  text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', me_email);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into care_circles (name, patient_name, timezone, created_by)
    values (p_name, p_patient_name, coalesce(nullif(p_timezone, ''), 'America/Los_Angeles'), auth.uid())
    returning id into new_id;
  insert into circle_members (circle_id, user_id, role, email, display_name)
    values (new_id, auth.uid(), 'admin', me_email, me_name);
  return new_id;
end;
$$;

-- Accept any open invites addressed to the caller's verified Google email.
create or replace function accept_my_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare
  me_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  me_name  text := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', me_email);
  verified boolean := coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false);
  n integer := 0;
  inv record;
begin
  if auth.uid() is null or me_email = '' or not verified then return 0; end if;
  for inv in
    select * from circle_invites
    where email = me_email and accepted_at is null and expires_at > now()
  loop
    insert into circle_members (circle_id, user_id, role, email, display_name)
      values (inv.circle_id, auth.uid(), inv.role, me_email, me_name)
      on conflict (circle_id, user_id) do nothing;
    update circle_invites set accepted_at = now() where id = inv.id;
    insert into activity_log (circle_id, actor, action, entity, summary)
      values (inv.circle_id, auth.uid(), 'joined', 'circle', me_name || ' joined');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Non-secret facts about the calendar connection, for members only.
create or replace function calendar_status(c uuid)
returns table (google_email text, calendar_id text, connected_at timestamptz)
language sql stable security definer set search_path = public as $$
  select gc.google_email, gc.calendar_id, gc.connected_at
  from google_connections gc
  where gc.circle_id = c and is_member(c);
$$;

-- Let any member opt in/out of calendar invites for themselves only.
create or replace function set_my_calendar_invites(c uuid, on_off boolean)
returns void language sql security definer set search_path = public as $$
  update circle_members set calendar_invites = on_off
  where circle_id = c and user_id = auth.uid();
$$;

-- Add reviewed extraction results to the plan in ONE transaction.
-- SECURITY INVOKER: runs as the caller, so every insert is checked by RLS.
create or replace function confirm_document(p_doc uuid, p_items jsonb, p_meds jsonb, p_notes jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  c uuid;
  v_visit date;
  it jsonb;
  pid uuid;
begin
  update documents set confirmed_at = now()
    where id = p_doc and confirmed_at is null
    returning circle_id, visit_date into c, v_visit;
  if c is null then raise exception 'already_confirmed'; end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pid := null;
    if coalesce(trim(it->>'provider'), '') <> '' then
      select id into pid from providers where circle_id = c and lower(name) = lower(trim(it->>'provider')) limit 1;
      if pid is null then
        insert into providers (circle_id, name) values (c, left(trim(it->>'provider'), 120)) returning id into pid;
      end if;
    end if;
    insert into care_items (circle_id, document_id, kind, title, urgency, provider_id, due_by,
                            due_hint, details, prep_instructions, source_quote)
    values (c, p_doc, (it->>'kind')::item_kind, left(it->>'title', 200), (it->>'urgency')::urgency, pid,
            nullif(it->>'due_by', '')::date, it->>'due_hint', it->>'details', it->>'prep_instructions',
            it->>'source_quote');
  end loop;

  insert into medications (circle_id, document_id, name, dose, frequency, instructions, change_type, start_date, active)
  select c, p_doc, m->>'name', m->>'dose', m->>'frequency', m->>'instructions', m->>'change_type', v_visit,
         coalesce(m->>'change_type', '') <> 'stopped'
  from jsonb_array_elements(coalesce(p_meds, '[]'::jsonb)) m;

  insert into care_notes (circle_id, document_id, body, is_warning)
  select c, p_doc, n->>'body', coalesce((n->>'is_warning')::boolean, false)
  from jsonb_array_elements(coalesce(p_notes, '[]'::jsonb)) n;
end;
$$;

-- An admin can't remove or demote the last admin.
create or replace function guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if (select count(*) from circle_members where circle_id = old.circle_id and role = 'admin') <= 1 then
      raise exception 'A care circle needs at least one admin';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger circle_members_last_admin
  before update or delete on circle_members
  for each row execute function guard_last_admin();

-- care_items has title/status; medications has name and no status. Separate
-- small triggers keep that simple and explicit.
create or replace function stamp_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  end if;
  insert into activity_log (circle_id, actor, action, entity, entity_id, summary)
  values (
    new.circle_id, auth.uid(),
    case when tg_op = 'INSERT' then 'added'
         when old.status is distinct from new.status then new.status::text
         else 'edited' end,
    'care_item', new.id, new.title
  );
  return new;
end;
$$;
create trigger care_items_stamp before insert or update on care_items
  for each row execute function stamp_item();

create or replace function stamp_med()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  insert into activity_log (circle_id, actor, action, entity, entity_id, summary)
  values (new.circle_id, auth.uid(),
          case when tg_op = 'INSERT' then 'added' else 'edited' end,
          'medication', new.id, new.name);
  return new;
end;
$$;
create trigger medications_stamp before insert or update on medications
  for each row execute function stamp_med();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table care_circles       enable row level security;
alter table circle_members     enable row level security;
alter table circle_invites     enable row level security;
alter table providers          enable row level security;
alter table documents          enable row level security;
alter table care_items         enable row level security;
alter table medications        enable row level security;
alter table care_notes         enable row level security;
alter table activity_log       enable row level security;
alter table google_connections enable row level security;   -- no policies on purpose

-- Circles: members read; admins rename. Creation goes through create_circle().
create policy circles_read   on care_circles for select using (is_member(id));
create policy circles_update on care_circles for update using (is_admin(id)) with check (is_admin(id));
create policy circles_delete on care_circles for delete using (is_admin(id));

-- Members: everyone in the circle can see who else is in it.
-- Admins change roles/remove; anyone can leave. Members change their own
-- calendar preference through set_my_calendar_invites() below.
create policy members_read   on circle_members for select using (is_member(circle_id));
create policy members_admin  on circle_members for update using (is_admin(circle_id)) with check (is_admin(circle_id));
create policy members_remove on circle_members for delete using (is_admin(circle_id) or user_id = auth.uid());

-- Invites: admins only.
create policy invites_admin on circle_invites for all using (is_admin(circle_id)) with check (is_admin(circle_id) and invited_by = auth.uid());

-- Care data: members read, editors/admins write.
create policy providers_read  on providers for select using (is_member(circle_id));
create policy providers_write on providers for insert with check (can_edit(circle_id));
create policy providers_upd   on providers for update using (can_edit(circle_id)) with check (can_edit(circle_id));
create policy providers_del   on providers for delete using (can_edit(circle_id));

create policy documents_read  on documents for select using (is_member(circle_id));
create policy documents_write on documents for insert with check (can_edit(circle_id) and uploaded_by = auth.uid());
create policy documents_upd   on documents for update using (can_edit(circle_id)) with check (can_edit(circle_id));
create policy documents_del   on documents for delete using (is_admin(circle_id));

create policy items_read  on care_items for select using (is_member(circle_id));
create policy items_write on care_items for insert with check (can_edit(circle_id));
create policy items_upd   on care_items for update using (can_edit(circle_id)) with check (can_edit(circle_id));
create policy items_del   on care_items for delete using (is_admin(circle_id));

create policy meds_read  on medications for select using (is_member(circle_id));
create policy meds_write on medications for insert with check (can_edit(circle_id));
create policy meds_upd   on medications for update using (can_edit(circle_id)) with check (can_edit(circle_id));
create policy meds_del   on medications for delete using (is_admin(circle_id));

create policy notes_read  on care_notes for select using (is_member(circle_id));
create policy notes_write on care_notes for insert with check (can_edit(circle_id));
create policy notes_upd   on care_notes for update using (can_edit(circle_id)) with check (can_edit(circle_id));
create policy notes_del   on care_notes for delete using (is_admin(circle_id));

create policy activity_read on activity_log for select using (is_member(circle_id));

grant execute on function calendar_status(uuid) to authenticated;
grant execute on function set_my_calendar_invites(uuid, boolean) to authenticated;
grant execute on function create_circle(text, text, text) to authenticated;
grant execute on function accept_my_invites() to authenticated;
grant execute on function confirm_document(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: a PRIVATE bucket. Files are only reachable through short-lived
-- signed URLs, and only by members of the circle in the first path segment.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false;

create policy docs_storage_read on storage.objects for select
  using (bucket_id = 'documents' and is_member(((storage.foldername(name))[1])::uuid));
create policy docs_storage_insert on storage.objects for insert
  with check (bucket_id = 'documents' and can_edit(((storage.foldername(name))[1])::uuid));
create policy docs_storage_delete on storage.objects for delete
  using (bucket_id = 'documents' and is_admin(((storage.foldername(name))[1])::uuid));
