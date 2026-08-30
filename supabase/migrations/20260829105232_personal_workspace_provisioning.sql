-- A customer account is a tenant. Organizations remain an internal relational
-- boundary for billing, sites and future team membership, but are never a
-- first-run setup task exposed to the customer.
ALTER TABLE public.organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION private.provision_personal_workspace(
  target_profile uuid,
  target_email text,
  target_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing_organization uuid;
  new_organization uuid;
  workspace_name text;
BEGIN
  -- Serialize provisioning per account. Retries, concurrent first requests and
  -- Auth trigger retries therefore produce exactly one personal workspace.
  PERFORM pg_advisory_xact_lock(hashtextextended(target_profile::text, 0));

  SELECT organization_id INTO existing_organization
  FROM public.organization_members
  WHERE profile_id = target_profile
  ORDER BY created_at ASC
  LIMIT 1;
  IF existing_organization IS NOT NULL THEN
    RETURN existing_organization;
  END IF;

  workspace_name := left(
    coalesce(nullif(trim(target_display_name), ''), nullif(split_part(target_email, '@', 1), ''), 'AISEO'),
    100
  ) || ' 的工作区';

  INSERT INTO public.organizations (id, name, credit_balance_micros, created_at, updated_at)
  VALUES (gen_random_uuid(), workspace_name, 0, now(), now())
  RETURNING id INTO new_organization;
  INSERT INTO public.organization_members (organization_id, profile_id, role)
  VALUES (new_organization, target_profile, 'OWNER');
  INSERT INTO public.audit_events (id, organization_id, actor_id, action, target_type, target_id, metadata)
  VALUES (
    gen_random_uuid(), new_organization, target_profile,
    'PERSONAL_WORKSPACE_PROVISIONED', 'organization', new_organization::text,
    jsonb_build_object('source', 'auth-lifecycle')
  );
  RETURN new_organization;
END;
$$;
ALTER FUNCTION private.provision_personal_workspace(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.provision_personal_workspace(uuid, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.ensure_personal_workspace()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_profile uuid := private.current_profile_id();
  profile_email text;
  profile_display_name text;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'profile context is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users auth_user
    WHERE auth_user.id = current_profile AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'verified email is required' USING ERRCODE = '42501';
  END IF;
  SELECT email, display_name INTO profile_email, profile_display_name
  FROM public.profiles WHERE id = current_profile;
  IF profile_email IS NULL THEN
    RAISE EXCEPTION 'profile is missing' USING ERRCODE = '23503';
  END IF;
  RETURN private.provision_personal_workspace(current_profile, profile_email, profile_display_name);
END;
$$;
ALTER FUNCTION private.ensure_personal_workspace() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.ensure_personal_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.ensure_personal_workspace() TO app_backend;

CREATE OR REPLACE FUNCTION private.handle_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, created_at, updated_at)
  VALUES (
    NEW.id,
    lower(NEW.email),
    nullif(NEW.raw_user_meta_data ->> 'display_name', ''),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM private.provision_personal_workspace(
      NEW.id,
      lower(NEW.email),
      nullif(NEW.raw_user_meta_data ->> 'display_name', '')
    );
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.handle_auth_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.handle_auth_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS auth_user_profile_sync ON auth.users;
CREATE TRIGGER auth_user_profile_sync
AFTER INSERT OR UPDATE OF email, raw_user_meta_data, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_auth_user();
