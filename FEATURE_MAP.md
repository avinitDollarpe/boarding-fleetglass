# Feature map

Fleetglass Postgres is the source of truth. The dashboard is per user. The Fleetglass Slack bot and GitHub App listen. Gilfoyle writes and launches. Cursor cloud agents do the work, and only when the Cursor plan is active.

## Spine

```
Fleetglass Slack bot | Fleetglass GitHub App | chat_delegate
        → intake (trigger + slack_ts or comment id)
        → Fleetglass task (create, follow-up, or dedupe)
        → Gilfoyle or the built-in orchestrator
        → Cursor plan gate
        → Cloud Agent
        → state / token / subtask updates
        → board, task detail, heatmap
```

## Triggers

| Feature | Where | Behavior |
| --- | --- | --- |
| `github_pr_mention` | `tasks.trigger`, `tasks.source`, `src/lib/intake.ts` | Payload: repo, pr number/url, comment body, commenter, mention targets, comment id. `source_ref` is the PR URL, lowercased, without query or hash. |
| `slack_bot_mention` | same | Payload: team, channel, permalink, text, user, `slackTs`. `source_ref` is the Slack permalink. |
| `chat_delegate` | same | User delegates in chat. Dashboard add-task uses this trigger. |
| Idempotency | `tasks.idempotency_key`, unique `(user_id, idempotency_key)` | Explicit key, else `github_comment:{commentId}`, else Slack message ts as `slack:{team}:{channel}:{slackTs}`. Duplicate webhook returns the existing task. |
| PR follow-up | `tasks.parent_id` | A later GitHub mention on a PR that already has a top-level task links a child. Dedupe wins. |
| Slack bot | Settings → Integrations → Slack, `integrations` provider `slack` | Per-tenant OAuth. Encrypted bot token, display name, handle, aliases, channel allowlist, enabled. Default handle `Fleetglass`. |
| GitHub App | Settings → Integrations → GitHub, `integrations` provider `github` | Per-tenant installation id and mention targets. Same enable switch. Not `@cursor`. |

## Plan gate

| Feature | Where | Behavior |
| --- | --- | --- |
| Account link | `cursor_accounts`, `POST /api/cursor/link` | Cursor user API key, encrypted at rest. |
| Verify | `src/lib/plan.ts`, `GET/POST /api/v1/plan` | `GetPlanInfo` plus `interpretPlan`. Fail closed. |
| Blocked state | `blocked:cursor_plan` | Exact state when the plan is inactive. Task still exists. No spin-up. |
| Launch | `POST /api/v1/tasks/:id/launch` | Re-checks the plan. Stores `bc_id` and agent URL from Cursor. 402 or billing refusal blocks. Other errors stay `Holding`. |
| Local override | `DEV_PLAN_OVERRIDE` | Off Vercel only, and only when `ALLOW_PLAN_OVERRIDE=1`. Banner on the signed-in shell. |

## Board and ingest

| Feature | Where | Behavior |
| --- | --- | --- |
| Auth | Auth.js magic link | Database sessions. Dev mailbox at `/dev/mailbox` when `DEV_MAILBOX=1` and not on Vercel. |
| Tenancy | `user_id` + RLS | Personal accounts. `workspace_id` nullable. No orgs in v1. |
| Tasks | `/board`, `/api/v1/tasks` | Kanban of every state, including `blocked:cursor_plan`. |
| Subtasks | task detail, `POST /api/v1/tasks/:id/subtasks` | One level. Timeline, subtasks, and tokens use beui tabs. |
| Tokens | `token_usage`, `POST /api/v1/usage`, `POST /api/v1/tasks/:id/sync` | Per task. Cursor sync upserts `cursor:{bcId}:{runId}` and rolls the delta. Cost is an estimate in micros. |
| Heatmap | `/activity` | Account-level daily event counts, 20 weeks, Monday-first UTC, beui HeatCalendar. |
| Agent status | `POST /api/v1/agent-status` | Gilfoyle updates state, `bc_id`, PR URL by task id or idempotency key. New `bc_id` requires an active plan. |
| Ingest keys | `/settings` | `fg_` bearer tokens. SHA-256 lookup, AES-256-GCM at rest. Shown once. |
| Sample fleet | board, after plan is active | GitHub parent + follow-up on one PR, a Slack mention, and a chat task left at `blocked:cursor_plan`. Marked `is_sample`. |

## Roles

| Role | Owns |
| --- | --- |
| Fleetglass bot | Slack app and GitHub App listeners, intake, dashboard settings |
| Gilfoyle | Board, Cursor launch, Fleetglass writes |
| Fleetglass | Source of truth, plan gate, dashboard, ingest API |
| Cursor Cloud | Worker. Refused when the plan is inactive |

A Grok teammate named Fleetglass is an interim intake persona only.

## Out of scope

Organizations, Notion as source of truth, treating `@cursor` as a built-in listener, invented cloud-agent ids.
