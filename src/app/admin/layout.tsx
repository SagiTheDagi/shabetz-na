"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionPayload, Quarter } from "@/lib/types";

interface NavSection {
  title: string;
  items: { href: string; label: string }[];
}

const navSections: NavSection[] = [
  {
    title: "רבעון",
    items: [
      { href: "/admin", label: "ראשי" },
      { href: "/admin/assign", label: "שיבוץ" },
    ],
  },
  {
    title: "ישויות",
    items: [
      { href: "/admin/workers", label: "עובדים" },
      { href: "/admin/eligibility", label: "מטריצת כשירות" },
      { href: "/admin/justice", label: "טבלת צדק" },
    ],
  },
  {
    title: "הגדרות",
    items: [
      { href: "/admin/settings?tab=dates", label: "תאריכי משמרות" },
      { href: "/admin/settings?tab=ranks", label: "דרגות וסוגי משמרות" },
      { href: "/admin/settings", label: "הגדרות כלליות" },
    ],
  },
];

function isNavActive(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (href.includes("?")) {
    const [path] = href.split("?");
    return pathname === path || pathname.startsWith(path + "/");
  }
  return pathname.startsWith(href);
}

function getPageTitle(pathname: string): { title: string; subtitle?: string } {
  if (pathname === "/admin") return { title: "ראשי", subtitle: "סקירת מצב הרבעון" };
  if (pathname.startsWith("/admin/assign")) return { title: "שיבוץ", subtitle: "ניהול שיבוצי משמרות" };
  if (pathname.startsWith("/admin/workers")) return { title: "עובדים", subtitle: "ניהול רשימת עובדים" };
  if (pathname.startsWith("/admin/eligibility")) return { title: "מטריצת כשירות", subtitle: "הגדרת כשירות לפי דרגה" };
  if (pathname.startsWith("/admin/justice")) return { title: "טבלת צדק", subtitle: "חלוקה הוגנת של משמרות" };
  if (pathname.startsWith("/admin/settings")) return { title: "הגדרות", subtitle: "ניהול המערכת" };
  return { title: "ניהול" };
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionPayload | null>(null);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [currentQuarter, setCurrentQuarter] = useState<string>("");

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
    
    // Load quarters
    fetch("/api/quarters")
      .then((r) => r.json())
      .then((data: Quarter[]) => {
        setQuarters(data);
        // Try to restore from localStorage, otherwise use the first quarter
        const saved = localStorage.getItem("selectedQuarter");
        if (saved && data.some((q) => q.quarter_id === saved)) {
          setCurrentQuarter(saved);
        } else if (data.length > 0) {
          setCurrentQuarter(data[0].quarter_id);
        }
      })
      .catch(() => {});
  }, [router]);

  function handleQuarterChange(quarterId: string) {
    setCurrentQuarter(quarterId);
    localStorage.setItem("selectedQuarter", quarterId);
  }

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
  }

  const pageInfo = getPageTitle(pathname);

  return (
    <div className="flex h-screen text-sm nocturne-bg nocturne-text">
      {/* Sidebar - on the right in RTL */}
      <nav className="w-[var(--sidebar-width)] flex-none flex flex-col gap-0.5 py-4 px-2.5 border-l nocturne-sidebar nocturne-border">
        {/* Brand */}
        <div className="px-2 pb-3.5">
          <div className="text-[19px] font-semibold tracking-tight">
            שב״צ-נא
          </div>
          <div className="text-[11px] nocturne-text-muted tracking-wide">
            ניהול משמרות רבעוניות
          </div>
        </div>

        {/* Navigation sections */}
        {navSections.map((section, idx) => (
          <div key={idx}>
            <div className="text-[10px] px-2 pt-2.5 pb-1 tracking-widest nocturne-text-muted">
              {section.title}
            </div>
            {section.items.map((item) => {
              const active = isNavActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg text-[13.5px] transition-colors hover:bg-white/5 nocturne-text-secondary"
                >
                  {active && (
                    <span className="w-[3px] h-[15px] rounded-sm block nocturne-accent-bg" />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}

        {/* User section at bottom */}
        <div className="mt-auto pt-3 px-2 border-t flex items-center gap-2 nocturne-border">
          <span className="w-[var(--avatar-size)] h-[var(--avatar-size)] rounded-[7px] grid place-items-center text-[11px] font-semibold nocturne-accent-badge">
            {user?.name?.[0] || "מ"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] truncate">{user?.name || "מנהל מערכת"}</div>
            <div className="text-[10.5px] nocturne-text-muted font-mono">
              {user?.worker_id || "admin"}
            </div>
          </div>
          <ThemeToggle />
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="h-7 px-2 text-xs hover:bg-white/10 nocturne-text-tertiary"
          >
            יציאה
          </Button>
        </div>
      </nav>

      {/* Main content area */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="h-14 flex-none flex items-center gap-3.5 px-[22px] border-b nocturne-border">
          <h1 className="text-[var(--text-heading)] font-medium m-0">{pageInfo.title}</h1>
          {pageInfo.subtitle && (
            <span className="text-xs nocturne-text-muted">{pageInfo.subtitle}</span>
          )}
          
          {/* Right side actions */}
          <div className="mr-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1.5 text-[11px] py-1 px-2.5 rounded-md border nocturne-border nocturne-text-subtle font-sans hover:bg-white/5 transition-colors">
                {currentQuarter || "בחר רבעון"}
                <ChevronDown className="h-3 w-3 opacity-60" suppressHydrationWarning />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {quarters.map((q) => (
                  <DropdownMenuItem
                    key={q.quarter_id}
                    onClick={() => handleQuarterChange(q.quarter_id)}
                    className={currentQuarter === q.quarter_id ? "bg-white/10" : ""}
                  >
                    {q.quarter_id}
                  </DropdownMenuItem>
                ))}
                {quarters.length === 0 && (
                  <DropdownMenuItem disabled>אין רבעונים</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button 
              variant="outline" 
              size="sm" 
              className="text-xs h-8 px-3 border nocturne-border bg-transparent nocturne-text"
            >
              ייצוא
            </Button>
            <Button 
              size="sm"
              className="text-xs h-8 px-3 bg-transparent border border-primary text-primary"
            >
              פרסום רבעון
            </Button>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 min-h-0 overflow-auto p-5 px-[22px] pb-7">
          {children}
        </div>
      </main>
    </div>
  );
}
