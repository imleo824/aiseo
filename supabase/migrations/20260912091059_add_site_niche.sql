-- Stores the optional business positioning supplied during site setup.
-- The default keeps existing sites valid while leaving the field nullable,
-- matching the production Prisma contract.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS niche text DEFAULT '通用行业';
