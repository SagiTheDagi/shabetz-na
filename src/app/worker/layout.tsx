"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { SessionPayload } from "@/lib/types";

export default function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    <div className="min-h-screen flex flex-col nocturne-bg nocturne-text">
      {/* Header */}
      <header className="h-14 flex-none px-5 flex items-center justify-between border-b nocturne-border">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">שב״צ-נא</span>
          {user && (
            <span className="text-sm nocturne-text-muted">
              שלום, {user.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="h-8 px-3 text-xs rounded-lg transition-colors bg-transparent border nocturne-border nocturne-text-tertiary hover:bg-white/5"
          >
            יציאה
          </button>
        </div>
      </header>
      
      {/* Main content */}
      <main className="flex-1 p-5 max-w-2xl mx-auto w-full overflow-auto">
        {children}
      </main>
    </div>
  );
}
