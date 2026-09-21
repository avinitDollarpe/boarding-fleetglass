import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { disconnectGithubInstall, disconnectSlackInstall, saveGithub, saveSlack } from "@/app/actions";
import { Shell } from "@/components/app/shell";
import { readGithub, readSlack } from "@/server/installs";
import { GITHUB_MENTION_TARGETS, GITHUB_REPO_OWNERS, SLACK_ALIASES, SLACK_HANDLE } from "@/lib/bots";
import { CHIEF_SLACK_USER_ID } from "@/lib/slack-event";
import { appOrigin } from "@/server/oauth-state";
import { readPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ slack?: string; github?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const [plan, slack, github] = await Promise.all([
    readPlan(session.user.id),
    readSlack(session.user.id),
    readGithub(session.user.id),
  ]);
  const origin = appOrigin();
  return (
    <Shell email={session.user.email} planActive={plan.status === "active"}>
      <div className="flex max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <Link href="/settings">Settings</Link> / Integrations
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Richard (@{SLACK_HANDLE}) is the Slack app. Point its Event Subscriptions request URL here when you are ready. OAuth on this page is the per-tenant path once Slack client secrets are set. A Grok teammate named Fleetglass is optional and interim.
          </p>
        </div>

        <section className="card flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Slack</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Display name is Richard, handle @{SLACK_HANDLE}. Aliases: {SLACK_ALIASES.join(", ")}. Channel scope * means every channel. An app mention creates a task only when the Slack user is {CHIEF_SLACK_USER_ID}.
              </p>
            </div>
            <span className="num text-sm text-muted-foreground">{slack.installed ? "Installed" : "Not installed"}</span>
          </div>
          {query.slack === "unconfigured" ? (
            <p className="text-sm">Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET before installing.</p>
          ) : null}
          {query.slack === "installed" ? <p className="text-sm">Slack workspace connected.</p> : null}
          {query.slack === "error" ? <p className="text-sm">Slack install did not finish.</p> : null}
          {slack.installed ? (
            <p className="text-sm">
              Workspace {slack.teamName || slack.teamId}. Bot user {slack.botUserId}.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <a href="/api/slack/install" className="press btn btn-primary">
              {slack.installed ? "Reconnect Slack" : "Install Slack app"}
            </a>
            {slack.installed ? (
              <form action={disconnectSlackInstall}>
                <button type="submit" className="press btn btn-quiet">
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
          <form action={saveSlack} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Display name
              <input name="displayName" defaultValue={slack.displayName} className="field" maxLength={80} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Handle
              <input name="handle" defaultValue={slack.handle} className="field" placeholder={SLACK_HANDLE} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Aliases
              <textarea name="aliases" defaultValue={slack.aliases.join("\n")} className="field" placeholder={SLACK_ALIASES.join("\n")} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Channel allowlist
              <textarea name="channelAllowlist" defaultValue={slack.channelAllowlist.join("\n")} className="field" placeholder="*" />
            </label>
            <p className="text-xs text-muted-foreground">* or an empty allowlist accepts every channel. One id or name per line.</p>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={slack.enabled} className="size-4" />
              Enabled
            </label>
            <button type="submit" className="press btn btn-quiet w-fit">
              Save Slack bot
            </button>
          </form>
          <div className="flex flex-col gap-2 rounded-[8px] border border-border p-3 text-sm">
            <p className="font-medium">Event Subscriptions request URL</p>
            <p className="num break-all">{origin}/api/slack/events</p>
            <ol className="list-decimal space-y-1 ps-4 text-muted-foreground">
              <li>Set SLACK_SIGNING_SECRET from Richard&apos;s app credentials when you point the app. Live pointing is later.</li>
              <li>Set SLACK_BOT_TOKEN so permalinks resolve. Set SLACK_FLEETGLASS_USER_ID or SLACK_OWNER_EMAIL until OAuth is installed.</li>
              <li>Paste the request URL into Slack. Fleetglass returns the url_verification challenge after the signature checks out.</li>
              <li>Subscribe to the bot event app_mention. Only {CHIEF_SLACK_USER_ID} is ingested. Idempotency is the message slack_ts.</li>
            </ol>
          </div>
        </section>

        <section className="card flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">GitHub</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A pull request comment becomes a task when it mentions {GITHUB_MENTION_TARGETS.join(", ")} on a repo under {GITHUB_REPO_OWNERS.join(" or ")}. Idempotency is the comment id.
              </p>
            </div>
            <span className="num text-sm text-muted-foreground">{github.installed ? "Installed" : "Not installed"}</span>
          </div>
          {query.github === "unconfigured" ? <p className="text-sm">Set GITHUB_APP_SLUG before installing.</p> : null}
          {query.github === "installed" ? <p className="text-sm">GitHub App installation saved.</p> : null}
          {query.github === "error" ? <p className="text-sm">GitHub install did not finish.</p> : null}
          {github.installationId ? <p className="num text-sm">Installation {github.installationId}</p> : null}
          <div className="flex flex-wrap gap-3">
            <a href="/api/github/install" className="press btn btn-primary">
              {github.installed ? "Reconnect GitHub App" : "Install GitHub App"}
            </a>
            {github.installed ? (
              <form action={disconnectGithubInstall}>
                <button type="submit" className="press btn btn-quiet">
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
          <form action={saveGithub} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Mention targets
              <textarea name="mentionTargets" defaultValue={github.mentionTargets.join("\n")} className="field" placeholder={GITHUB_MENTION_TARGETS.join("\n")} />
            </label>
            <p className="text-xs text-muted-foreground">GitHub logins, without @. avinitDollarpe, cursor, and cursoragent are always matched. Extra logins and GITHUB_APP_SLUG are added on top.</p>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={github.enabled} className="size-4" />
              Enabled
            </label>
            <button type="submit" className="press btn btn-quiet w-fit">
              Save GitHub targets
            </button>
          </form>
          <p className="num break-all text-xs text-muted-foreground">Webhook URL {origin}/api/github/webhook</p>
        </section>
      </div>
    </Shell>
  );
}
