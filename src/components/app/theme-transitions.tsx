"use client";

import { useEffect } from "react";

/** Snap a theme change. Color transitions would smear the whole page. */
export function ThemeTransitions() {
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const style = document.createElement("style");
      style.append(document.createTextNode("*,*::before,*::after{transition:none !important}"));
      document.head.append(style);
      void document.body.offsetHeight;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => style.remove());
      });
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);
  return null;
}
