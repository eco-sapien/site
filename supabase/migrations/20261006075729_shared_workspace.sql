-- Shared application data. No personal details or account credentials belong here.
begin;

-- The optional dashboard auto-RLS helper is an administrative event trigger,
-- not an application RPC. Preserve the trigger while removing client access.
do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rls_auto_enable'
      and p.pronargs=0 and p.prorettype='event_trigger'::regtype) then
    revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
  end if;
end $$;

create schema if not exists eco_private;
revoke all on schema eco_private from public, anon;
grant usage on schema eco_private to authenticated;

create table if not exists public.eco_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create table if not exists public.eco_members (
  workspace_id uuid not null references public.eco_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  actor_kind text not null default 'person' check (actor_kind in ('person','agent')),
  display_name text not null check (char_length(display_name) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create table if not exists public.eco_invitations (
  workspace_id uuid not null references public.eco_workspaces(id) on delete cascade,
  email text not null check (email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and char_length(email)<=254),
  role text not null check (role in ('owner','editor','viewer')),
  actor_kind text not null default 'person' check (actor_kind in ('person','agent')),
  display_name text not null check (char_length(display_name) between 1 and 100),
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default (now()+interval '30 days'),
  primary key (workspace_id,email)
);
create table if not exists public.eco_fields (
  workspace_id uuid not null references public.eco_workspaces(id) on delete cascade,
  record_id text not null,
  field text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (workspace_id,record_id,field)
);
create table if not exists public.eco_files (
  id uuid primary key,
  workspace_id uuid not null references public.eco_workspaces(id) on delete cascade,
  record_id text not null,
  slot text not null check (slot in ('cv','statement','portfolio','degree','transcript','language','aps','reference','employment')),
  object_path text not null unique,
  filename text not null check (char_length(filename) between 1 and 220 and filename !~ '[[:cntrl:]/\\]'),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  mime_type text not null,
  status text not null default 'pending' check (status in ('pending','ready')),
  uploaded_by uuid not null references auth.users(id),
  actor_name text not null,
  actor_kind text not null check (actor_kind in ('person','agent')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists eco_files_target on public.eco_files(workspace_id,record_id,slot,completed_at desc);
create table if not exists public.eco_activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.eco_workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id),
  actor_name text not null,
  actor_kind text not null check (actor_kind in ('person','agent')),
  action text not null,
  record_id text,
  file_id uuid references public.eco_files(id),
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists eco_activity_workspace on public.eco_activity(workspace_id,id desc);
create table if not exists eco_private.requests (
  workspace_id uuid not null references public.eco_workspaces(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  primary key (workspace_id,request_id)
);

alter table public.eco_workspaces enable row level security;
alter table public.eco_members enable row level security;
alter table public.eco_invitations enable row level security;
alter table public.eco_fields enable row level security;
alter table public.eco_files enable row level security;
alter table public.eco_activity enable row level security;
alter table eco_private.requests enable row level security;

create or replace function eco_private.has_access(w uuid, writing boolean default false)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.eco_members m where m.workspace_id=w and m.user_id=(select auth.uid()) and (not writing or m.role in ('owner','editor'))) $$;
create or replace function eco_private.is_owner(w uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.eco_members m where m.workspace_id=w and m.user_id=(select auth.uid()) and m.role='owner') $$;
create or replace function eco_private.actor(w uuid, writing boolean default false)
returns public.eco_members language plpgsql stable security definer set search_path=''
as $$
declare m public.eco_members;
begin
  select * into m from public.eco_members where workspace_id=w and user_id=(select auth.uid());
  if m.user_id is null or (writing and m.role not in ('owner','editor')) then
    raise exception 'You do not have permission for this workspace.' using errcode='42501';
  end if;
  return m;
end $$;
revoke all on function eco_private.has_access(uuid,boolean), eco_private.is_owner(uuid), eco_private.actor(uuid,boolean) from public,anon,authenticated;
grant execute on function eco_private.has_access(uuid,boolean), eco_private.is_owner(uuid) to authenticated;

drop policy if exists eco_workspace_read on public.eco_workspaces;
create policy eco_workspace_read on public.eco_workspaces for select to authenticated using (eco_private.has_access(id));
drop policy if exists eco_members_read on public.eco_members;
create policy eco_members_read on public.eco_members for select to authenticated using (eco_private.has_access(workspace_id));
drop policy if exists eco_invites_read on public.eco_invitations;
create policy eco_invites_read on public.eco_invitations for select to authenticated using (eco_private.is_owner(workspace_id));
drop policy if exists eco_fields_read on public.eco_fields;
create policy eco_fields_read on public.eco_fields for select to authenticated using (eco_private.has_access(workspace_id));
drop policy if exists eco_files_read on public.eco_files;
create policy eco_files_read on public.eco_files for select to authenticated using (eco_private.has_access(workspace_id) and (status='ready' or uploaded_by=(select auth.uid())));
drop policy if exists eco_activity_read on public.eco_activity;
create policy eco_activity_read on public.eco_activity for select to authenticated using (eco_private.has_access(workspace_id));

-- All writes go through authenticated, validated functions. The browser cannot
-- modify membership, attribution or activity history with direct table writes.
revoke all on public.eco_workspaces,public.eco_members,public.eco_invitations,public.eco_fields,public.eco_files,public.eco_activity from public,anon,authenticated;
grant select on public.eco_workspaces,public.eco_members,public.eco_invitations,public.eco_fields,public.eco_files,public.eco_activity to authenticated;
revoke all on eco_private.requests from public,anon,authenticated;

create or replace function public.eco_join_workspace(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare invitation public.eco_invitations; address text; member public.eco_members;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  select * into member from public.eco_members where workspace_id=p_workspace and user_id=auth.uid();
  if member.user_id is not null then return to_jsonb(member); end if;
  select lower(email) into address from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if address is null then raise exception 'Confirm your email before joining the workspace.' using errcode='42501'; end if;
  select * into invitation from public.eco_invitations where workspace_id=p_workspace and email=address and expires_at>now() for update;
  if invitation.email is null then raise exception 'This account has not been invited to the workspace.' using errcode='42501'; end if;
  insert into public.eco_members(workspace_id,user_id,role,actor_kind,display_name)
    values(p_workspace,auth.uid(),invitation.role,invitation.actor_kind,invitation.display_name) returning * into member;
  delete from public.eco_invitations where workspace_id=p_workspace and email=address;
  insert into public.eco_activity(workspace_id,actor_id,actor_name,actor_kind,action)
    values(p_workspace,auth.uid(),member.display_name,member.actor_kind,'member_joined');
  return to_jsonb(member);
end $$;

create or replace function public.eco_invite_member(p_workspace uuid,p_email text,p_name text,p_role text default 'editor',p_kind text default 'person')
returns void language plpgsql security definer set search_path=''
as $$
declare member public.eco_members;
begin
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  member:=eco_private.actor(p_workspace,true);
  if member.role<>'owner' then raise exception 'Only the workspace owner can invite members.' using errcode='42501'; end if;
  if p_role is null or p_kind is null or p_role not in ('editor','viewer') or p_kind not in ('person','agent') then raise exception 'Unsupported member role.'; end if;
  if lower(btrim(p_email))=(select lower(email) from auth.users where id=auth.uid()) then raise exception 'You already own this workspace.'; end if;
  if exists(select 1 from public.eco_members m join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace and lower(u.email)=lower(btrim(p_email))) then raise exception 'This account is already a member. Change its access in the members list.'; end if;
  insert into public.eco_invitations(workspace_id,email,display_name,role,actor_kind,invited_by)
    values(p_workspace,lower(btrim(p_email)),btrim(p_name),p_role,p_kind,auth.uid())
    on conflict(workspace_id,email) do update set display_name=excluded.display_name,role=excluded.role,actor_kind=excluded.actor_kind,invited_by=auth.uid(),expires_at=now()+interval '30 days';
  insert into public.eco_activity(workspace_id,actor_id,actor_name,actor_kind,action,details)
    values(p_workspace,auth.uid(),member.display_name,member.actor_kind,'member_invited',jsonb_build_object('name',btrim(p_name),'role',p_role,'kind',p_kind));
end $$;

create or replace function public.eco_revoke_invitation(p_workspace uuid,p_email text)
returns void language plpgsql security definer set search_path=''
as $$
declare member public.eco_members;
begin
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  member:=eco_private.actor(p_workspace,true);
  if member.role<>'owner' then raise exception 'Only the workspace owner can remove invitations.' using errcode='42501'; end if;
  delete from public.eco_invitations where workspace_id=p_workspace and email=lower(btrim(p_email));
  if found then
    insert into public.eco_activity(workspace_id,actor_id,actor_name,actor_kind,action)
      values(p_workspace,auth.uid(),member.display_name,member.actor_kind,'invitation_revoked');
  end if;
end $$;

create or replace function public.eco_set_member(p_workspace uuid,p_user uuid,p_role text)
returns void language plpgsql security definer set search_path=''
as $$
declare member public.eco_members; target public.eco_members;
begin
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  member:=eco_private.actor(p_workspace,true);
  if member.role<>'owner' then raise exception 'Only the workspace owner can change access.' using errcode='42501'; end if;
  select * into target from public.eco_members where workspace_id=p_workspace and user_id=p_user for update;
  if target.user_id is null or target.role='owner' then raise exception 'The owner account cannot be changed here.'; end if;
  if p_role='removed' then
    delete from public.eco_members where workspace_id=p_workspace and user_id=p_user;
    delete from public.eco_invitations where workspace_id=p_workspace and email=(select lower(email) from auth.users where id=p_user);
  elsif p_role in ('viewer','editor') then
    update public.eco_members set role=p_role where workspace_id=p_workspace and user_id=p_user;
  else raise exception 'Unsupported member role.';
  end if;
  insert into public.eco_activity(workspace_id,actor_id,actor_name,actor_kind,action,details)
    values(p_workspace,auth.uid(),member.display_name,member.actor_kind,'member_access_changed',jsonb_build_object('name',target.display_name,'role',p_role));
end $$;

create or replace function public.eco_snapshot(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare member public.eco_members;
begin
  member:=eco_private.actor(p_workspace);
  return jsonb_build_object(
    'version',4,
    'workspace',(select to_jsonb(w) from public.eco_workspaces w where id=p_workspace),
    'member',to_jsonb(member),
    'fields',coalesce((select jsonb_agg(to_jsonb(f)) from public.eco_fields f where workspace_id=p_workspace),'[]'::jsonb),
    'files',coalesce((select jsonb_agg(to_jsonb(f) order by completed_at desc) from public.eco_files f where workspace_id=p_workspace and status='ready'),'[]'::jsonb),
    'pending_uploads',coalesce((select jsonb_agg(to_jsonb(f) order by created_at desc) from public.eco_files f where workspace_id=p_workspace and status='pending' and uploaded_by=auth.uid()),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(to_jsonb(a) order by id desc) from (select * from public.eco_activity where workspace_id=p_workspace order by id desc limit 50) a),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by created_at) from public.eco_members m where workspace_id=p_workspace),'[]'::jsonb),
    'invitations',case when member.role='owner' then coalesce((select jsonb_agg(to_jsonb(i) order by expires_at) from public.eco_invitations i where workspace_id=p_workspace),'[]'::jsonb) else '[]'::jsonb end
  );
end $$;

revoke all on function public.eco_join_workspace(uuid),public.eco_invite_member(uuid,text,text,text,text),public.eco_revoke_invitation(uuid,text),public.eco_set_member(uuid,uuid,text),public.eco_snapshot(uuid) from public,anon;
grant execute on function public.eco_join_workspace(uuid),public.eco_invite_member(uuid,text,text,text,text),public.eco_revoke_invitation(uuid,text),public.eco_set_member(uuid,uuid,text),public.eco_snapshot(uuid) to authenticated;

-- Realtime delivers only rows readable under the subscriber's current RLS.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='eco_activity') then
    alter publication supabase_realtime add table public.eco_activity;
  end if;
end $$;
commit;
