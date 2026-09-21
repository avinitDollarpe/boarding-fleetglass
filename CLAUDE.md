# Fleetglass

Read `AGENTS.md` and `FEATURE_MAP.md` before changing product behavior.

`main` is the default base branch. Before coding, cloud agents load `pstack` and `caveman`. Postgres is the source of truth. One operator. Slack is deploy env only (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_MENTION_USER_ID`, default mention user `U08C40K4FHN`). `OWNER_EMAIL` locks magic-link sign-in when set. The board stays visible when the Cursor plan is inactive; launches stay gated. Intake triggers are `github_pr_mention`, `slack_bot_mention`, and `chat_delegate`. GitHub scope is `DollarPe-Infra` and `avinitDollarpe`, mentions `avinitDollarpe` / `cursor` / `cursoragent`, idempotency `comment_id`. Magic-link send lands on `/login/check-email`. The UI is one page: a six-column drag-and-drop kanban (Pending, In progress, In review, Blocked, Done, Cancelled) plus a Cursor plan disclosure. It does not create tasks. Chief owns listeners and hands off to Gilfoyle. Gilfoyle owns board, launch, and Fleetglass writes.

Do not add a Notion importer. Do not build organizations. Do not invent a `bc_id`.
