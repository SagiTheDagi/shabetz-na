"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/mobile/avatar";
import type { SessionPayload } from "@/lib/types";

const links = [
  { href: "/admin/settings?tab=dates", label: "תאריכי משמרות" },
  { href: "/admin/settings?tab=ranks", label: "דרגות וסוגי משמרות" },
  { href: "/admin/eligibility", label: "מטריצת כשירות" },
  { href: "/admin/justice", label: "טבלת צדק" },
  { href: "/admin/settings", label: "הגדרות כלליות" },
];

export default function MorePage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionPayload | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => !d.error && setUser(d))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/");
  }

  return (
    <div className="flex flex-col gap-3 max-w-lg">
      <div className="flex items-center gap-3 p-3 rounded-[14px] bg-[#1f2130]">
        <Avatar name={user?.name ?? "מ"} size={40} />
        <div className="min-w-0">
          <div className="text-[15px] truncate">{user?.name ?? "מנהל מערכת"}</div>
          <div className="text-xs nocturne-text-muted font-sans">{user?.worker_id}</div>
        </div>
        <span className="mr-auto">
          <ThemeToggle />
        </span>
      </div>
      <div className="rounded-[14px] bg-[#1f2130] flex flex-col">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="min-h-13 flex items-center px-4 text-[14px] border-b last:border-b-0 border-white/5"
          >
            {l.label}
            <span className="mr-auto text-lg text-[#5c6070]">‹</span>
          </Link>
        ))}
      </div>
      <button
        onClick={logout}
        className="min-h-12 rounded-[10px] border nocturne-border text-[14px] nocturne-error"
      >
        יציאה
      </button>
    </div>
  );
}
