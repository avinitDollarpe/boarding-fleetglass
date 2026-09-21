import Link from "next/link";
import { signOut } from "@/auth";

export function Shell({
  email,
  children,
}: {
  email?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="fleet-app min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-6 py-2">
          <Link href="/board" className="text-[15px] font-medium tracking-tight">
            Fleetglass
          </Link>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
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
