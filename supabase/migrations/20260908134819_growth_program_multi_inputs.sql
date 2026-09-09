-- A growth program accepts a set of independently validated signals. The
-- execution engine can combine keywords, reference articles and competitor
-- sites without encoding structured data into a single text column.

CREATE TABLE public.growth_program_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.growth_programs(id) ON DELETE CASCADE,
  type public."GrowthInputType" NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  value_fingerprint text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_program_inputs_value_required
    CHECK (length(trim(value)) BETWEEN 2 AND 2000),
  CONSTRAINT growth_program_inputs_normalized_required
    CHECK (length(trim(normalized_value)) BETWEEN 2 AND 2000),
  CONSTRAINT growth_program_inputs_fingerprint_valid
    CHECK (value_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT growth_program_inputs_position_valid CHECK (position >= 0),
  CONSTRAINT growth_program_inputs_program_fingerprint_key
    UNIQUE (program_id, value_fingerprint),
  CONSTRAINT growth_program_inputs_program_position_key
    UNIQUE (program_id, position)
);
CREATE INDEX growth_program_inputs_org_program_position_idx
  ON public.growth_program_inputs(organization_id, program_id, position);
CREATE INDEX growth_program_inputs_site_type_idx
  ON public.growth_program_inputs(site_id, type);

-- Preserve any program created during the narrow single-input release window,
-- then remove the obsolete representation so there is only one runtime model.
INSERT INTO public.growth_program_inputs (
  organization_id, site_id, program_id, type, value, normalized_value,
  value_fingerprint, position
)
SELECT
  organization_id,
  site_id,
  id,
  input_type,
  trim(input_value),
  CASE
    WHEN input_type = 'KEYWORD' THEN lower(regexp_replace(trim(input_value), '\s+', ' ', 'g'))
    ELSE lower(trim(trailing '/' FROM split_part(trim(input_value), '#', 1)))
  END,
  encode(digest(
    input_type::text || E'\n' || CASE
      WHEN input_type = 'KEYWORD' THEN lower(regexp_replace(trim(input_value), '\s+', ' ', 'g'))
      ELSE lower(trim(trailing '/' FROM split_part(trim(input_value), '#', 1)))
    END,
    'sha256'
  ), 'hex'),
  0
FROM public.growth_programs;

CREATE OR REPLACE FUNCTION private.enforce_growth_program_input_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  program_record record;
  type_count integer;
  type_limit integer;
BEGIN
  SELECT organization_id, site_id
  INTO program_record
  FROM public.growth_programs
  WHERE id = NEW.program_id;

  IF NOT FOUND
     OR program_record.organization_id <> NEW.organization_id
     OR program_record.site_id <> NEW.site_id THEN
    RAISE EXCEPTION 'growth program input tenant or site does not match program'
      USING ERRCODE = '23514';
  END IF;

  type_limit := CASE NEW.type
    WHEN 'KEYWORD' THEN 20
    WHEN 'REFERENCE_URL' THEN 5
    WHEN 'COMPETITOR_SITE' THEN 5
  END;
  SELECT count(*) INTO type_count
  FROM public.growth_program_inputs
  WHERE program_id = NEW.program_id AND type = NEW.type;
  IF type_count >= type_limit THEN
    RAISE EXCEPTION 'growth program input limit exceeded for %', NEW.type
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_growth_program_input_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_growth_program_input_integrity()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE TRIGGER growth_program_inputs_integrity
  BEFORE INSERT ON public.growth_program_inputs
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_program_input_integrity();

CREATE TRIGGER growth_program_inputs_immutable
  BEFORE UPDATE OR DELETE ON public.growth_program_inputs
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();

CREATE OR REPLACE FUNCTION private.enforce_growth_program_has_inputs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.growth_program_inputs WHERE program_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'growth program requires at least one input'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION private.enforce_growth_program_has_inputs() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_growth_program_has_inputs()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE CONSTRAINT TRIGGER growth_programs_require_inputs
  AFTER INSERT OR UPDATE ON public.growth_programs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_program_has_inputs();

ALTER TABLE public.growth_program_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_program_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_select ON public.growth_program_inputs FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_program_inputs FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));

REVOKE ALL ON TABLE public.growth_program_inputs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.growth_program_inputs TO app_backend, app_worker;

ALTER TABLE public.growth_programs
  DROP CONSTRAINT growth_programs_input_required,
  DROP COLUMN input_type,
  DROP COLUMN input_value;

COMMENT ON TABLE public.growth_program_inputs IS
  'Immutable, typed user growth signals combined by one evidence-driven program.';
