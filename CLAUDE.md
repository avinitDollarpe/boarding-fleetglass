# Fleetglass

Read `AGENTS.md` and `FEATURE_MAP.md` before changing product behavior.

`main` is the default base branch. Before coding, load `pstack` and `caveman`. pstack means go deep on the Slack, GitHub, and `CHIEF_HANDOFF_URL` path, then write less. caveman means terse communication. Code, commits, and pull requests stay normal English.

Fleetglass is a backend API. It intakes Slack `app_mention` and GitHub PR comments, then POSTs a `fleetglass.wake` brief to `CHIEF_HANDOFF_URL` so Richard can route. Slack is env-only (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_MENTION_USER_ID`, default `U08C40K4FHN`). GitHub uses `GITHUB_WEBHOOK_SECRET`. Repo owners are `DollarPe-Infra` and `avinitDollarpe`. Mentions are `avinitDollarpe`, `cursor`, and `cursoragent`. Idempotency is Slack `slack_ts` and GitHub `comment_id`.

Do not rebuild the kanban, magic-link dashboard, or a fake chat API. Do not add a Notion importer. Do not build organizations. Do not invent a `bc_id`.
