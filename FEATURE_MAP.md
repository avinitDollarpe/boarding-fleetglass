# Feature map

Fleetglass is an API. Slack and GitHub wake Richard. Postgres stores dedupe keys when `DATABASE_URL` is set. There is no board.

## Spine

```
Slack app_mention
GitHub PR comment
        → signature and filter
        → fleetglass.wake
        → POST CHIEF_HANDOFF_URL
        → Richard routes
```

## Routes

| Feature | Where | Behavior |
| --- | --- | --- |
| Health | `GET /api/health` | `{ "ok": true }` |
| Slack events | `POST /api/slack/events` | `src/server/listeners.ts` `receiveSlackEvent` |
| GitHub webhook | `POST /api/github/webhook` | `receiveGithubWebhook` |
| Home | `GET /` | Names the three routes |

## Slack

| Case | Behavior |
| --- | --- |
| Signing | `SLACK_SIGNING_SECRET` and `X-Slack-Signature`. Unset secret is 503 `slack_unconfigured`. Bad signature is 401 `invalid_signature`. |
| Challenge | `url_verification` returns 200 `{ "challenge": "<value>" }`. |
| Event | `app_mention` only. Other events return 200 `ignored`. |
| Owner | `SLACK_MENTION_USER_ID`, default `U08C40K4FHN`. Anyone else is `ignored: owner`. |
| Bot id | Optional `SLACK_BOT_USER_ID`. When set, and the payload lists bot user ids, that id must be one of them. |
| Permalink | `SLACK_BOT_TOKEN` calls `chat.getPermalink`. Without the token, the URL is `https://slack.com/archives/{channel}/p{ts}`. The wake still runs. |

## GitHub

| Case | Behavior |
| --- | --- |
| Signing | `GITHUB_WEBHOOK_SECRET` and `X-Hub-Signature-256`. Unset is 503. Bad signature is 401. |
| Events | `issue_comment` and `pull_request_review_comment`, action `created`, on a pull request. |
| Repos | `DollarPe-Infra` and `avinitDollarpe`. |
| Mentions | `avinitDollarpe`, `cursor`, `cursoragent`, plus `GITHUB_APP_SLUG`. |
| Idempotency | `github_comment:{comment_id}` |

## Richard wake

Code: `src/server/wake.ts` `deliverRichardWake`.

HTTP contract. `POST $CHIEF_HANDOFF_URL` with `Content-Type: application/json`. When `CHIEF_HANDOFF_AUTHORIZATION` is set, that trimmed value is the `Authorization` header, unchanged. Do not add or strip `Bearer`. Richard’s Grok Bot webhook routine `fleetglass-slack-chief-webhook` requires it: paste the routine panel Webhook URL into `CHIEF_HANDOFF_URL` and the panel Authorization header into `CHIEF_HANDOFF_AUTHORIZATION`. Unset authorization keeps Content-Type only.

Slack brief:

```json
{
  "type": "fleetglass.wake",
  "source": "slack",
  "text": "ship the api",
  "url": "https://slack.com/archives/C9/p1710000001000100",
  "author": "U08C40K4FHN",
  "ids": {
    "slack_ts": "1710000001.000100",
    "event_id": "Ev9",
    "team_id": "T1",
    "channel_id": "C9"
  }
}
```

GitHub brief:

```json
{
  "type": "fleetglass.wake",
  "source": "github",
  "text": "@avinitDollarpe please",
  "url": "https://github.com/DollarPe-Infra/app/pull/3",
  "author": "ada",
  "ids": {
    "comment_id": "99",
    "repo": "DollarPe-Infra/app",
    "pr_number": 3
  }
}
```

| Fleetglass response | When |
| --- | --- |
| 200 `{ "ok": true, "woke": true, "deduped": false }` | Richard returned 2xx |
| 200 `{ "ok": true, "woke": false, "deduped": true }` | Key already claimed |
| 200 `{ "ok": true, "woke": false, "reason": "no_handoff" }` | `CHIEF_HANDOFF_URL` unset. Key is not stored. |
| 502 `{ "error": "wake_failed" }` | POST failed or Richard was not 2xx. Key is released. |

## Dedupe

| Key | Shape |
| --- | --- |
| Slack | `slack:{team}:{channel}:{slack_ts}` or `slack_ts:{slack_ts}` |
| GitHub | `github_comment:{comment_id}` |

Table `wake_keys` in `drizzle/0004_wake_keys.sql`. No RLS. Grant is `SELECT, INSERT, DELETE` for `fleetglass_app` when that role exists. Without `DATABASE_URL`, dedupe is in-process only.

## Out of scope

Board, magic-link sign-in, task CRUD, Cursor launch, organizations, Notion import, and a second chat API. Do not invent a `bc_id`. Do not drop old tables.
