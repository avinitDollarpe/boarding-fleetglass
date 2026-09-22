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
| Slack reply | `POST /api/slack/reply` | `receiveSlackReply`. Signed callback for a Slack wake. |
| GitHub webhook | `POST /api/github/webhook` | `receiveGithubWebhook` |
| Home | `GET /` | Names the routes |

## Slack

| Case | Behavior |
| --- | --- |
| Signing | `SLACK_SIGNING_SECRET` and `X-Slack-Signature`. Unset secret is 503 `slack_unconfigured`. Bad signature is 401 `invalid_signature`. |
| Challenge | `url_verification` returns 200 `{ "challenge": "<value>" }`. |
| Event | `app_mention` only. Other events return 200 `ignored`. |
| Owner | `SLACK_MENTION_USER_ID`, default `U08C40K4FHN`. Anyone else is `ignored: owner`. |
| Bot id | Optional `SLACK_BOT_USER_ID`. When set, and the payload lists bot user ids, that id must be one of them. |
| Permalink | `SLACK_BOT_TOKEN` calls `chat.getPermalink`. Without the token, the URL is `https://slack.com/archives/{channel}/p{ts}`. The wake still runs. |
| Thinking | When `SLACK_BOT_TOKEN` is set and the mention will wake Richard, or when the mention is a ping, Fleetglass calls `assistant.threads.setStatus` with status `is thinking...`. Slack renders that as "{bot} is thinking...". `thread_ts` is the event thread, or the message `ts` when the mention is not already in a thread. On a wake the call is not awaited. On a ping it is awaited before `chat.postMessage`. Failures never change the HTTP result. An unset token skips it. Session channels return `method_not_supported_for_channel_type`; Fleetglass then calls `agents.sessions.setStatus` with `processing` and no `thread_ts`. That fallback is a loading state, not the words "is thinking...". |
| Ping | After the owner and bot checks, Fleetglass strips Slack mention tokens (`<@U...>` and `<!channel>`). If the remaining text is exactly `ping`, any case, it does not call `deliverRichardWake`. It sets the thinking status, then `chat.postMessage` with `SLACK_BOT_TOKEN` and JSON `{ "channel", "text": "pong", "thread_ts" }`. No `username`, `icon_emoji`, `icon_url`, or `as_user`. HTTP 200 `{ "ok": true, "woke": false, "answered": "pong" }`. A post failure is logged, the status is cleared, and the event still returns 200. |
| Status clear | A successful `chat.postMessage` from this bot clears the Slack status. If `chat.postMessage` throws or returns `ok: false`, Fleetglass calls `assistant.threads.setStatus` with `status: ""` on the same `channel_id` and `thread_ts`. When the thinking status used the session fallback, it calls `agents.sessions.setStatus` with `status: ""` and no `thread_ts` instead. Clear errors are logged. After a successful real-ask wake, Fleetglass also clears that status when the brief has no `reply`. A usable `reply.url` stays up until the bot posts or the post fails. |

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
  },
  "reply": {
    "url": "https://fleetglass.example/api/slack/reply",
    "channel_id": "C9",
    "thread_ts": "1710000001.000010",
    "exp": 1710001801,
    "sig": "<hmac sha256 hex>"
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

`reply` is present only on a Slack brief, and only when `FLEETGLASS_PUBLIC_URL` and `FLEETGLASS_REPLY_SECRET` are both set. The base is that URL with no trailing slash. `VERCEL_URL` is not a reply base. The HMAC key is only `FLEETGLASS_REPLY_SECRET`. `SLACK_SIGNING_SECRET` does not sign or verify `reply`. Mint and verify call `slackReplySecret()`. `exp` is a Unix second, 15 minutes ahead. `sig` is HMAC-SHA256 hex over `JSON.stringify(["v1", channel_id, thread_ts, exp])`. The text of the later reply is not inside the HMAC. GitHub briefs omit `reply`. Fleetglass omits `reply` when the public URL is unset, the reply secret is unset, the base is not http(s), the host is localhost, or the host is `*-git-*.vercel.app`. The wake still runs. Set one `FLEETGLASS_REPLY_SECRET` on Production and redeploy. Do not rotate it without redeploying. The routine must POST `reply.url`. It must not use a Slack connector.

Richard's routine posts the final Slack message to `reply.url`. It must not use a Slack connector. The body is `{ "text", "channel_id", "thread_ts", "exp", "sig" }`. Copy `channel_id`, `thread_ts`, `exp`, and `sig` from `reply`. Those two target fields are the strings inside the HMAC. `reply.thread_ts` is the parent thread when the mention is already in a thread, and the mention timestamp when it is not. `ids.slack_ts` is always the mention timestamp. Posting `ids.slack_ts` as `thread_ts` fails the HMAC whenever those values differ. Fleetglass checks the HMAC, rejects an expired `exp`, and rejects a signature it has already accepted in this process. On success it calls `chat.postMessage` with the bot token in that thread only. A different channel or thread does not match the signature. A post that copies `reply.channel_id`, `reply.thread_ts`, `reply.exp`, and `reply.sig` and still returns `invalid_signature` means `FLEETGLASS_REPLY_SECRET` at verify does not match the secret that minted `sig`.

| Reply response | When |
| --- | --- |
| 200 `{ "ok": true, "posted": true }` | Slack `chat.postMessage` returned `ok: true` |
| 400 | Body is not JSON, channel or thread is missing, text is empty, or `exp` is not an integer |
| 401 `{ "error": "expired" }` or `{ "error": "invalid_signature" }` | Past `exp`, or HMAC mismatch |
| 403 `{ "error": "reused" }` | This process already posted with that signature |
| 502 `{ "error": "slack_post_failed" }` | `chat.postMessage` threw or returned `ok: false`. The signature can be reused until `exp`. Status is cleared. |
| 503 `{ "error": "slack_unconfigured" }` | `SLACK_BOT_TOKEN` unset |
| 503 `{ "error": "reply_unconfigured" }` | No reply secret |

This route is not the Slack event ack. Its errors do not change `POST /api/slack/events`.

## Slack app

Turn on Agents & AI Apps so thinking status can show. Add the bot scope `chat:write`. Invite the bot to the channel. Reinstall the app to the workspace after the scope change. `SLACK_BOT_TOKEN` must be the bot token from that install. Fleetglass never posts as `@Cursor` and never posts through a user connection.

## Dedupe

| Key | Shape |
| --- | --- |
| Slack | `slack:{team}:{channel}:{slack_ts}` or `slack_ts:{slack_ts}` |
| GitHub | `github_comment:{comment_id}` |

Table `wake_keys` in `drizzle/0004_wake_keys.sql`. No RLS. Grant is `SELECT, INSERT, DELETE` for `fleetglass_app` when that role exists. Without `DATABASE_URL`, dedupe is in-process only.

## Out of scope

Board, magic-link sign-in, task CRUD, Cursor launch, organizations, Notion import, and a second chat API. Do not invent a `bc_id`. Do not drop old tables.
