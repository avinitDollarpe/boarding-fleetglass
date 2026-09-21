import Link from "next/link";
import { signOut } from "@/auth";
import { ShellNav } from "@/components/app/shell-nav";

const links = [
  { href: "/board", label: "Board", needsPlan: true },
  { href: "/activity", label: "Activity", needsPlan: true },
  { href: "/settings/integrations", label: "Integrations", needsPlan: false },
  { href: "/settings", label: "Settings", needsPlan: false },
];

export function Shell({
  email,
  planActive,
  children,
}: {
  email?: string | null;
  planActive: boolean;
  children: React.ReactNode;
}) {
  const visible = links.filter((link) => planActive || !link.needsPlan);
  return (
    <div className="fleet-app min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-2">
          <Link href={planActive ? "/board" : "/onboarding"} className="text-[15px] font-medium tracking-tight">
            Fleetglass
          </Link>
          <ShellNav
            links={[
              ...visible,
              ...(!planActive ? [{ href: "/onboarding", label: "Plan" }] : []),
            ]}
          />
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="press min-h-11 px-3 text-sm text-muted-foreground">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
