-- Publishing is governed globally by the platform administrator.  A missing
-- setting deliberately means no manual confirmation is required.
INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('publishing.confirmation', '{"requireManualConfirmation": false}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Legacy per-site policy columns are retained for production-data safety, but
-- application code no longer reads, writes or exposes them.  Removal can be a
-- later retention migration after archived values have been verified.
