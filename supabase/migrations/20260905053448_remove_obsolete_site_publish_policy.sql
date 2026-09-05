ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_auto_publish_gate,
  DROP CONSTRAINT IF EXISTS sites_manual_publish_successes_nonnegative,
  DROP COLUMN IF EXISTS publish_policy,
  DROP COLUMN IF EXISTS manual_publish_successes,
  DROP COLUMN IF EXISTS auto_publish_terms_accepted_at,
  DROP COLUMN IF EXISTS auto_publish_enabled_at;

DROP TYPE IF EXISTS public."PublishPolicy";
