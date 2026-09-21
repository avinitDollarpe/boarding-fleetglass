"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { EASE_OUT } from "@/lib/ease";

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <div className="fixed inset-0 z-30 md:hidden">
          <motion.button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: EASE_OUT }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label={title}
            className="absolute inset-y-0 start-0 flex w-[min(100%,320px)] flex-col gap-4 border-e border-border bg-card p-4 shadow-[0_16px_40px_oklch(0_0_0/0.35)]"
            initial={{ x: reduce ? 0 : -24, opacity: reduce ? 1 : 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduce ? 0 : -24, opacity: reduce ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT }}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{title}</p>
              <button type="button" className="press btn btn-quiet" onClick={onClose}>
                Close
              </button>
            </div>
            {children}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
