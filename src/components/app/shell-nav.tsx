"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Drawer } from "@/components/motion/drawer";
import { Tooltip } from "@/components/motion/tooltip";

const HINT: Record<string, string> = {
  "/board": "Drag tasks between states",
  "/activity": "Token heatmap and weekly totals",
  "/settings/integrations": "Slack bots and GitHub mentions",
  "/settings": "Cursor plan and ingest keys",
  "/onboarding": "Link a Cursor account",
};

export function ShellNav({
  links,
}: {
  links: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <>
      <nav className="hidden items-center gap-1 md:flex">
        {links.map((link) => {
          const active = path === link.href;
          return (
            <Tooltip key={link.href} content={HINT[link.href] ?? link.label} side="bottom">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-[8px] px-3 text-sm transition-[color] duration-100 ease-out ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {link.label}
              </Link>
            </Tooltip>
          );
        })}
      </nav>
      <button type="button" className="press btn btn-quiet md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
        <Menu className="size-4" strokeWidth={1.5} />
      </button>
      <Drawer open={open} title="Fleetglass" onClose={() => setOpen(false)}>
        <nav className="flex flex-col gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={path === link.href ? "page" : undefined}
              className={`rounded-[8px] px-3 py-3 text-sm ${path === link.href ? "bg-muted text-foreground" : ""}`}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </Drawer>
    </>
  );
}
