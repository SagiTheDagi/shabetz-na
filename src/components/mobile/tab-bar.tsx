"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin", label: "ראשי" },
  { href: "/admin/assign", label: "שיבוץ" },
  { href: "/admin/workers", label: "עובדים" },
  { href: "/admin/more", label: "עוד" },
];

function isActive(href: string, pathname: string) {
  if (href === "/admin") return pathname === "/admin";
  if (href === "/admin/more") {
    return (
      pathname.startsWith("/admin/more") ||
      pathname.startsWith("/admin/settings") ||
      pathname.startsWith("/admin/eligibility") ||
      pathname.startsWith("/admin/justice")
    );
  }
  return pathname.startsWith(href);
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden flex-none grid grid-cols-4 border-t nocturne-border nocturne-bg pt-2 pb-[max(10px,env(safe-area-inset-bottom))]">
      {tabs.map((t) => {
        const active = isActive(t.href, pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`min-h-12 flex flex-col items-center justify-center gap-1 text-[11px] ${
              active ? "nocturne-accent-light" : "nocturne-text-muted"
            }`}
          >
            <span
              className={`w-[18px] h-[3px] rounded-sm block ${active ? "nocturne-accent-bg" : ""}`}
            />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
