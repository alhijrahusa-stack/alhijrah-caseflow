ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_unique
  ON public.notifications (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
