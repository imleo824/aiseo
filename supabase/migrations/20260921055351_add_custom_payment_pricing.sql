-- Custom recharge amounts are priced by an audited database setting.  They do
-- not masquerade as a package: package_id is null and pricing_source records
-- which contract produced the immutable payment amount and credit award.
ALTER TABLE public.payment_intents
  ALTER COLUMN package_id DROP NOT NULL,
  ADD COLUMN pricing_source text NOT NULL DEFAULT 'PACKAGE',
  ADD COLUMN pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.payment_intents intent
SET pricing_snapshot = jsonb_build_object(
  'packageId', package_id,
  'baseAmountMicros', base_amount_micros::text,
  'creditMicros', credit_micros::text
)
WHERE pricing_source = 'PACKAGE' AND pricing_snapshot = '{}'::jsonb;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT payment_intents_positive_amounts,
  ADD CONSTRAINT payment_intents_positive_amounts CHECK (
    base_amount_micros > 0
    AND base_amount_micros % 1000000 = 0
    AND expected_amount_micros > base_amount_micros
    AND expected_amount_micros < base_amount_micros + 1000000
    AND credit_micros > 0
  ),
  ADD CONSTRAINT payment_intents_pricing_source_valid CHECK (
    (pricing_source = 'PACKAGE' AND package_id IS NOT NULL)
    OR (pricing_source = 'CUSTOM' AND package_id IS NULL)
  );

INSERT INTO public.system_settings (key, value, updated_at)
VALUES (
  'payment.custom_pricing',
  '{"active":true,"minAmountMicros":"10000000","maxAmountMicros":"10000000000","creditsPerUsdtMicros":"100000000"}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_custom_payment_shape CHECK (
    key <> 'payment.custom_pricing'
    OR (
      value ?& array['active', 'minAmountMicros', 'maxAmountMicros', 'creditsPerUsdtMicros']
      AND jsonb_typeof(value -> 'active') = 'boolean'
      AND (value ->> 'minAmountMicros') ~ '^[1-9][0-9]{0,18}$'
      AND (value ->> 'maxAmountMicros') ~ '^[1-9][0-9]{0,18}$'
      AND (value ->> 'creditsPerUsdtMicros') ~ '^[1-9][0-9]{0,18}$'
      AND (value ->> 'minAmountMicros')::numeric % 1000000 = 0
      AND (value ->> 'maxAmountMicros')::numeric % 1000000 = 0
      AND (value ->> 'minAmountMicros')::numeric <= (value ->> 'maxAmountMicros')::numeric
      AND (value ->> 'maxAmountMicros')::numeric <= 9223372036853775808
      AND (value ->> 'creditsPerUsdtMicros')::numeric <= 9223372036854775807
    )
  );

CREATE POLICY system_settings_payment_pricing_read
ON public.system_settings FOR SELECT
USING (
  key = 'payment.custom_pricing'
  AND private.current_profile_id() IS NOT NULL
);

-- RLS still limits these writes to a platform administrator.  The Web role
-- needs the SQL privilege so the existing audited admin pricing endpoint can
-- update the setting; ordinary profiles fail the RLS policy.
GRANT INSERT, UPDATE ON TABLE public.system_settings TO app_backend;
