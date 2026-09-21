# Fleetglass

Read `AGENTS.md` and `FEATURE_MAP.md` before changing product behavior.

`main` is the default base branch. Postgres is the source of truth. The product requires an active Cursor plan. Intake triggers are `github_pr_mention`, `slack_bot_mention`, and `chat_delegate`. Chief owns listeners. Gilfoyle owns board, launch, and Fleetglass writes.

Do not add a Notion importer. Do not build organizations. Do not invent a `bc_id`.
