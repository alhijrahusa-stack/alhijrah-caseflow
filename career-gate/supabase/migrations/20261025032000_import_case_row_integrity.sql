CREATE UNIQUE INDEX IF NOT EXISTS client_import_cases_batch_source_row_uidx
  ON public.client_import_cases (batch_id, source_row)
  WHERE source_row IS NOT NULL;
