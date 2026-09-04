-- Supabase owns the auth schema and may evolve it independently. Keep the
-- application model in public without a cross-schema foreign key so Prisma can
-- validate the public schema without introspecting Supabase-managed tables.
-- Identity equality and cleanup remain enforced by the Auth lifecycle triggers.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_auth_user_fkey;

CREATE OR REPLACE FUNCTION private.handle_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$;
ALTER FUNCTION private.handle_auth_user_delete() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.handle_auth_user_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS auth_user_profile_delete_sync ON auth.users;
CREATE TRIGGER auth_user_profile_delete_sync
AFTER DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_auth_user_delete();
