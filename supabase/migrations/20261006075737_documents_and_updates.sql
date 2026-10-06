begin;

create or replace function eco_private.valid_record(r text)
returns boolean language sql immutable set search_path=''
as $$ select r='library' or (char_length(r)<=100 and r ~ '^[a-z0-9]+(-[a-z0-9]+)+$') $$;

create or replace function eco_private.validate_field(w uuid,r text,k text,v jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare text_value text; slot_name text; doc public.eco_files; parts text[];
begin
  if not coalesce(eco_private.valid_record(r),false) or k is null or v is null then raise exception 'Invalid application change.'; end if;
  if k in ('saved','deadline_confirmed') and r<>'library' then
    if jsonb_typeof(v) is distinct from 'boolean' then raise exception 'Expected a checkbox value.'; end if;
    return;
  end if;
  if jsonb_typeof(v) is distinct from 'string' then raise exception 'Expected a text value.'; end if;
  text_value:=v#>>'{}';
  if char_length(text_value)>4000 then raise exception 'An application field is too long.'; end if;
  if r<>'library' and k='stage' then
    if text_value not in ('Not started','Check eligibility','Preparing','Submitted','Offer received','Unsuccessful','Not pursuing') then raise exception 'Invalid application stage.'; end if;
    return;
  elsif r<>'library' and k in ('notes','deadline_note') then return;
  elsif r<>'library' and k='deadline' then
    if text_value<>'' and (text_value !~ '^\d{4}-\d{2}-\d{2}$' or text_value::date not between date '2000-01-01' and date '2100-12-31') then raise exception 'Use a valid deadline date.'; end if;
    return;
  end if;
  if k='folder' then
    if char_length(text_value)>2048 or (text_value<>'' and text_value !~ '^https://(drive|docs)\.google\.com(/[^[:space:][:cntrl:]]*)?$') then raise exception 'Use a valid existing Drive folder link.'; end if;
    return;
  end if;
  parts:=string_to_array(k,'.');
  if array_length(parts,1)<>3 or parts[1]<>'documents' or parts[2] not in ('cv','statement','portfolio','degree','transcript','language','aps','reference','employment') then raise exception 'Unknown document field.'; end if;
  slot_name:=parts[2];
  if parts[3]='status' and r<>'library' then
    if text_value not in ('Needed','Draft','Ready','Submitted','Not required') then raise exception 'Invalid document status.'; end if;
  elsif parts[3]='url' then
    if char_length(text_value)>2048 or (text_value<>'' and text_value !~ '^https://(drive|docs)\.google\.com(/[^[:space:][:cntrl:]]*)?$') then raise exception 'Use a valid existing Drive document link.'; end if;
  elsif parts[3]='file_id' then
    if text_value<>'' then
      select * into doc from public.eco_files where id=text_value::uuid and workspace_id=w and record_id=r and slot=slot_name and status='ready';
      if doc.id is null then raise exception 'This file does not belong to this application document.' using errcode='42501'; end if;
    end if;
  else raise exception 'Unknown document field.';
  end if;
end $$;

create or replace function eco_private.put_field(w uuid,r text,k text,v jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare previous jsonb;
begin
  select value into previous from public.eco_fields where workspace_id=w and record_id=r and field=k;
  if previous is not distinct from v then return null; end if;
  insert into public.eco_fields(workspace_id,record_id,field,value,updated_by)
    values(w,r,k,v,auth.uid()) on conflict(workspace_id,record_id,field)
    do update set value=excluded.value,updated_at=clock_timestamp(),updated_by=auth.uid();
  return jsonb_build_object('record_id',r,'field',k,'before',previous,'after',v);
end $$;

create or replace function public.eco_save(p_workspace uuid,p_request uuid,p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare member public.eco_members; prior eco_private.requests; item jsonb; difference jsonb; differences jsonb:='[]'; payload jsonb; result jsonb;
begin
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  member:=eco_private.actor(p_workspace,true);
  if p_request is null or jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 6000 or octet_length(p_changes::text)>6291456 then raise exception 'Invalid application save.'; end if;
  payload:=jsonb_build_object('action','fields','changes',p_changes);
  select * into prior from eco_private.requests where workspace_id=p_workspace and request_id=p_request;
  if prior.request_id is not null then
    if prior.actor_id<>auth.uid() or prior.payload<>payload then raise exception 'This save identifier belongs to a different request.'; end if;
    return prior.result;
  end if;
  if (select count(distinct (c->>'record_id',c->>'field')) from jsonb_array_elements(p_changes) c)<>jsonb_array_length(p_changes) then raise exception 'Duplicate fields in a save.'; end if;
  for item in select * from jsonb_array_elements(p_changes) loop
    perform eco_private.validate_field(p_workspace,item->>'record_id',item->>'field',item->'value');
  end loop;
  for item in select * from jsonb_array_elements(p_changes) loop
    difference:=eco_private.put_field(p_workspace,item->>'record_id',item->>'field',item->'value');
    if difference is not null then differences:=differences||jsonb_build_array(difference); end if;
  end loop;
  result:=jsonb_build_object('applied',jsonb_array_length(differences));
  if jsonb_array_length(differences)>0 then
    insert into public.eco_activity(workspace_id,actor_id,actor_name,actor_kind,action,record_id,details)
      values(p_workspace,auth.uid(),member.display_name,member.actor_kind,'progress_updated',case when (select count(distinct c->>'record_id') from jsonb_array_elements(differences)c)=1 then differences->0->>'record_id' else null end,jsonb_build_object('changes',differences));
  end if;
  insert into eco_private.requests(workspace_id,request_id,actor_id,payload,result) values(p_workspace,p_request,auth.uid(),payload,result);
  return result;
end $$;

-- Private files: unique paths and INSERT-only object access preserve versions.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('application-documents','application-documents',false,52428800,array[
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text','application/rtf','text/rtf','text/plain',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation','image/jpeg','image/png','image/webp',
  'application/zip','application/x-zip-compressed','application/octet-stream'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function eco_private.can_read_object(path text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.eco_files f where f.object_path=path and eco_private.has_access(f.workspace_id) and (f.status='ready' or f.uploaded_by=(select auth.uid()))) $$;
create or replace function eco_private.can_insert_object(path text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.eco_files f where f.object_path=path and f.status='pending' and f.uploaded_by=(select auth.uid()) and eco_private.has_access(f.workspace_id,true)) $$;
drop policy if exists eco_document_read on storage.objects;
create policy eco_document_read on storage.objects for select to authenticated using (bucket_id='application-documents' and eco_private.can_read_object(name));
drop policy if exists eco_document_upload on storage.objects;
create policy eco_document_upload on storage.objects for insert to authenticated with check (bucket_id='application-documents' and eco_private.can_insert_object(name));

create or replace function public.eco_begin_upload(p_workspace uuid,p_file uuid,p_record text,p_slot text,p_name text,p_size bigint,p_mime text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare member public.eco_members; previous public.eco_files; created public.eco_files; allowed text[];
begin
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  member:=eco_private.actor(p_workspace,true);
  if p_file is null or not coalesce(eco_private.valid_record(p_record),false) or p_slot not in ('cv','statement','portfolio','degree','transcript','language','aps','reference','employment') or p_slot is null then raise exception 'Unknown application or document type.'; end if;
  if p_size is null or p_size not between 1 and 52428800 then raise exception 'Choose a non-empty file no larger than 50 MB.'; end if;
  if p_name is null or char_length(p_name) not between 1 and 220 or p_name ~ '[[:cntrl:]/\\]' or p_name !~* '\.(pdf|docx?|odt|rtf|txt|pptx?|odp|jpe?g|png|webp|zip)$' then raise exception 'Use a supported document filename.'; end if;
  select allowed_mime_types into allowed from storage.buckets where id='application-documents' and public=false;
  if allowed is null or not coalesce(p_mime=any(allowed),false) then raise exception 'Unsupported file type or private storage configuration.'; end if;
  select * into previous from public.eco_files where id=p_file;
  if previous.id is not null then
    if previous.workspace_id<>p_workspace or previous.uploaded_by<>auth.uid() or previous.record_id<>p_record or previous.slot<>p_slot or previous.filename<>p_name or previous.size_bytes<>p_size or previous.mime_type<>p_mime then raise exception 'This upload identifier belongs to a different file.' using errcode='42501'; end if;
    return to_jsonb(previous);
  end if;
  insert into public.eco_files(id,workspace_id,record_id,slot,object_path,filename,size_bytes,mime_type,uploaded_by,actor_name,actor_kind)
    values(p_file,p_workspace,p_record,p_slot,p_workspace::text||'/'||p_record||'/'||p_slot||'/'||p_file::text,p_name,p_size,p_mime,auth.uid(),member.display_name,member.actor_kind) returning * into created;
  return to_jsonb(created);
end $$;

create or replace function public.eco_complete_upload(p_workspace uuid,p_file uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare member public.eco_members; doc public.eco_files; actual jsonb; difference jsonb; differences jsonb:='[]'; item jsonb; items jsonb; stage jsonb;
begin
  perform 1 from public.eco_workspaces where id=p_workspace for update;
  member:=eco_private.actor(p_workspace,true);
  select * into doc from public.eco_files where id=p_file and workspace_id=p_workspace for update;
  if doc.id is null or doc.uploaded_by<>auth.uid() then raise exception 'This upload belongs to another account.' using errcode='42501'; end if;
  if doc.status='ready' then return to_jsonb(doc); end if;
  select metadata into actual from storage.objects where bucket_id='application-documents' and name=doc.object_path;
  if actual is null or not exists(select 1 from storage.buckets where id='application-documents' and public=false) then raise exception 'The file upload is not complete or the bucket is not private. Retry after the upload finishes.'; end if;
  if (actual->>'size')::bigint is distinct from doc.size_bytes then raise exception 'Uploaded file size did not match. Upload the file again.'; end if;
  if actual->>'mimetype' is distinct from doc.mime_type then raise exception 'Uploaded file type did not match. Upload the file again.'; end if;
  update public.eco_files set status='ready',completed_at=clock_timestamp() where id=p_file returning * into doc;
  items:=jsonb_build_array(
    jsonb_build_object('field','documents.'||doc.slot||'.file_id','value',doc.id::text),
    jsonb_build_object('field','documents.'||doc.slot||'.url','value','')
  );
  if doc.record_id<>'library' then
    items:=items||jsonb_build_array(jsonb_build_object('field','documents.'||doc.slot||'.status','value','Ready'),jsonb_build_object('field','saved','value',true));
    select value into stage from public.eco_fields where workspace_id=p_workspace and record_id=doc.record_id and field='stage';
    if stage is null or stage='"Not started"'::jsonb then items:=items||jsonb_build_array(jsonb_build_object('field','stage','value','Preparing')); end if;
  end if;
  for item in select * from jsonb_array_elements(items) loop
    difference:=eco_private.put_field(p_workspace,doc.record_id,item->>'field',item->'value');
    if difference is not null then differences:=differences||jsonb_build_array(difference); end if;
  end loop;
  insert into public.eco_activity(workspace_id,actor_id,actor_name,actor_kind,action,record_id,file_id,details)
    values(p_workspace,auth.uid(),member.display_name,member.actor_kind,'document_uploaded',doc.record_id,doc.id,jsonb_build_object('filename',doc.filename,'slot',doc.slot,'changes',differences));
  return to_jsonb(doc);
end $$;

revoke all on function eco_private.valid_record(text),eco_private.validate_field(uuid,text,text,jsonb),eco_private.put_field(uuid,text,text,jsonb),eco_private.can_read_object(text),eco_private.can_insert_object(text) from public,anon,authenticated;
grant execute on function eco_private.can_read_object(text),eco_private.can_insert_object(text) to authenticated;
revoke all on function public.eco_save(uuid,uuid,jsonb),public.eco_begin_upload(uuid,uuid,text,text,text,bigint,text),public.eco_complete_upload(uuid,uuid) from public,anon;
grant execute on function public.eco_save(uuid,uuid,jsonb),public.eco_begin_upload(uuid,uuid,text,text,text,bigint,text),public.eco_complete_upload(uuid,uuid) to authenticated;
commit;
