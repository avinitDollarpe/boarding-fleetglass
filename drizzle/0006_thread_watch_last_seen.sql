-- Watches expire after 7 days without a mention or follow-up wake.
ALTER TABLE thread_watches ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
