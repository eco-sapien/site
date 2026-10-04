-- Copy this outside the public website, replace both placeholders, and run
-- once in the project's SQL editor AFTER applying the migrations.
-- The email must not be committed to the public repository.
do $$
declare
  workspace_uuid uuid := '__WORKSPACE_UUID__';
  owner_email text := lower('__OWNER_EMAIL__');
begin
  if position('__' in owner_email)>0 or owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Replace the private owner email placeholder first.';
  end if;
  if exists(select 1 from public.eco_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=workspace_uuid and m.role='owner' and lower(u.email)<>owner_email) then
    raise exception 'This workspace already has a different owner.';
  end if;
  insert into public.eco_workspaces(id,name) values(workspace_uuid,'EcoSapien Applications')
    on conflict(id) do nothing;
  if not exists(select 1 from public.eco_members where workspace_id=workspace_uuid and role='owner') then
    insert into public.eco_invitations(workspace_id,email,role,actor_kind,display_name)
      values(workspace_uuid,owner_email,'owner','person','Workspace owner')
      on conflict(workspace_id,email) do update
        set role='owner',actor_kind='person',display_name='Workspace owner',expires_at=now()+interval '30 days';
  end if;
end $$;
