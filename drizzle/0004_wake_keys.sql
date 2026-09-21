-- Webhook dedupe. No RLS: Slack and GitHub have no session, so app.user_id is unset.
CREATE TABLE IF NOT EXISTS wake_keys (
  idempotency_key text PRIMARY KEY,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleetglass_app') THEN
    GRANT SELECT, INSERT, DELETE ON wake_keys TO fleetglass_app;
  END IF;
END $$;
