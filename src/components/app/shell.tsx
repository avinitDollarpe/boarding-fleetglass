import Link from "next/link";
import { signOut } from "@/auth";

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
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-3">
          <Link href={planActive ? "/board" : "/onboarding"} className="text-[15px] font-semibold tracking-tight">
            Fleetglass
          </Link>
          <nav className="flex items-center gap-1">
            {visible.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-[8px] px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                {link.label}
              </Link>
            ))}
            {!planActive ? (
              <Link href="/onboarding" className="rounded-[8px] px-3 py-2 text-sm text-foreground">
                Plan
              </Link>
            ) : null}
          </nav>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="press btn btn-quiet text-sm">
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
