"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-screen flex flex-col">
      <header className="bg-card border-b px-4 py-3 flex items-center justify-between">
        <div>
          <span className="text-lg font-semibold">שב&quot;צ-נא</span>
          {user && (
            <span className="text-sm text-muted-foreground mr-3">
              שלום, {user.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={handleLogout}>
            יציאה
          </Button>
        </div>
      </header>
      <main className="flex-1 p-4 max-w-2xl mx-auto w-full">{children}</main>
    </div>
  );
}
