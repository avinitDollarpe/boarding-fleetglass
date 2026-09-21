import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { disconnectGithubInstall, disconnectSlackInstall, saveGithub, saveSlack } from "@/app/actions";
import { Shell } from "@/components/app/shell";
import { readGithub, readSlack } from "@/server/installs";
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
            The Fleetglass Slack bot and GitHub App are the product listeners. They are not the Cursor bot. A Grok teammate named Fleetglass may sit in front of intake until the install is live. This page is the source of truth.
          </p>
        </div>

        <section className="card flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Slack</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Install the Fleetglass app into a workspace. It opens a task when someone mentions @{slack.handle} or an alias, and when Slack delivers an app mention to this bot.
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
              <input name="handle" defaultValue={slack.handle} className="field" placeholder="Fleetglass" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Aliases
              <textarea name="aliases" defaultValue={slack.aliases.join("\n")} className="field" placeholder={"Chief\ngilfoyle"} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Channel allowlist
              <textarea name="channelAllowlist" defaultValue={slack.channelAllowlist.join("\n")} className="field" placeholder={"C0123\neng-supervisor"} />
            </label>
            <p className="text-xs text-muted-foreground">Leave the allowlist empty to accept every channel. One id or name per line.</p>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={slack.enabled} className="size-4" />
              Enabled
            </label>
            <button type="submit" className="press btn btn-quiet w-fit">
              Save Slack bot
            </button>
          </form>
          <p className="num break-all text-xs text-muted-foreground">Events URL {origin}/api/slack/events</p>
        </section>

        <section className="card flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">GitHub</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Install the Fleetglass GitHub App. A pull request comment becomes a task when it mentions a target below, or the app slug from GITHUB_APP_SLUG.
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
              <textarea name="mentionTargets" defaultValue={github.mentionTargets.join("\n")} className="field" placeholder={"fleetglass\nchakravarti"} />
            </label>
            <p className="text-xs text-muted-foreground">GitHub logins, without @. The Cursor bot is not a default target.</p>
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
