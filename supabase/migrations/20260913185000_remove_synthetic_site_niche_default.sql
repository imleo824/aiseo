-- A site's market/niche is evidence inferred by the growth engine. Leaving it
-- NULL until the first real site snapshot prevents a placeholder from being
-- mistaken for customer or crawler-supplied business context.
ALTER TABLE public.sites
  ALTER COLUMN niche DROP DEFAULT;
