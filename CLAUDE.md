# Fleetglass

Read `AGENTS.md` and `FEATURE_MAP.md` before changing product behavior.

`main` is the default base branch. Postgres is the source of truth. The product requires an active Cursor plan. Intake triggers are `github_pr_mention`, `slack_bot_mention`, and `chat_delegate`. Chief is the Slack app. `POST /api/slack/events` is the Event Subscriptions request URL. `app_mention` is ingested only for Slack user `U08C40K4FHN`. Per-tenant OAuth is the later path. Chief is not a Cursor bot. Gilfoyle owns board, launch, and Fleetglass writes.

Do not add a Notion importer. Do not build organizations. Do not invent a `bc_id`.
