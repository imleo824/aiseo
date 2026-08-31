-- A comparison must be an explicit immutable pair. Selecting the two most
-- recently fetched rolling windows would compare overlapping periods and
-- misstate growth.
ALTER TABLE public.data_snapshots
  ADD COLUMN period_start date,
  ADD COLUMN period_end date,
  ADD COLUMN comparison_snapshot_id uuid REFERENCES public.data_snapshots(id) ON DELETE SET NULL,
  ADD CONSTRAINT data_snapshots_period_order CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  ADD CONSTRAINT data_snapshots_no_self_comparison CHECK (comparison_snapshot_id IS NULL OR comparison_snapshot_id <> id);

CREATE INDEX data_snapshots_site_source_period_end_idx ON public.data_snapshots(site_id, source, period_end DESC);
CREATE INDEX data_snapshots_comparison_snapshot_id_idx ON public.data_snapshots(comparison_snapshot_id);

COMMENT ON COLUMN public.data_snapshots.comparison_snapshot_id IS 'Explicit preceding non-overlapping period paired with this current snapshot.';
