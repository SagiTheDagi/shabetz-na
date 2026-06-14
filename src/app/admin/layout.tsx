"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionPayload } from "@/lib/types";

const navItems = [
  { href: "/admin", label: "ראשי", icon: "📊" },
  { href: "/admin/upload", label: "העלאת תאריכים", icon: "📤" },
  { href: "/admin/assign", label: "שיבוץ", icon: "📋" },
  { href: "/admin/settings", label: "הגדרות", icon: "⚙️" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionPayload | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          router.push("/");
        } else {
          setUser(data);
        }
      })
      .catch(() => router.push("/"));
  }, [router]);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-800 dark:bg-slate-900 text-white flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-700">
          <h1 className="text-lg font-bold">שב&quot;צ-נא</h1>
          <p className="text-xs text-slate-400">ניהול משמרות</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                  active
                    ? "bg-slate-700 text-white"
                    : "text-slate-300 hover:bg-slate-700/50"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-card border-b flex items-center justify-between px-6 shrink-0">
          <h2 className="text-lg font-semibold">
            {navItems.find(
              (item) =>
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href)
            )?.label || "ניהול"}
          </h2>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user && (
              <span className="text-sm text-muted-foreground">{user.name}</span>
            )}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              יציאה
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
