# Fleetglass

Read `AGENTS.md` and `FEATURE_MAP.md` before changing product behavior.

`main` is the default base branch. Postgres is the source of truth. The product requires an active Cursor plan. Intake triggers are `github_pr_mention`, `slack_bot_mention`, and `chat_delegate`. GitHub scope is `DollarPe-Infra` and `avinitDollarpe`, mentions `avinitDollarpe` / `cursor` / `cursoragent`, idempotency `comment_id`. Slack bots are per-user connectors: encrypted signing secret, bot token, and owner allowlist. `POST /api/slack/events` routes by `team_id` and `api_app_id`. Do not put a tenant Slack secret in deploy env. Magic-link send lands on `/login/check-email`. The board is a drag-and-drop kanban. Chief owns listeners and hands off to Gilfoyle. Gilfoyle owns board, launch, and Fleetglass writes.

Do not add a Notion importer. Do not build organizations. Do not invent a `bc_id`.
