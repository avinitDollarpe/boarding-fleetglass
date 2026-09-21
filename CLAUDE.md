# Fleetglass

Read `AGENTS.md` and `FEATURE_MAP.md` before changing product behavior.

`main` is the default base branch. Postgres is the source of truth. The product requires an active Cursor plan. Intake triggers are `github_pr_mention`, `slack_bot_mention`, and `chat_delegate`. GitHub scope is `DollarPe-Infra` and `avinitDollarpe`, mentions `avinitDollarpe` / `cursor` / `cursoragent`, idempotency `comment_id`. Slack display name is Richard (`@richard`), aliases include `@cursor` and `cursor bot`, channels are `*`, idempotency is `slack_ts`. `POST /api/slack/events` is ready for Richard; pointing the app is later. `app_mention` is ingested only for Slack user `U08C40K4FHN`. Chief owns listeners and hands off to Gilfoyle. Gilfoyle owns board, launch, and Fleetglass writes.

Do not add a Notion importer. Do not build organizations. Do not invent a `bc_id`.
