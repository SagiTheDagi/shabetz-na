"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [workerId, setWorkerId] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: workerId, password: password || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.requiresPassword) {
          setNeedsPassword(true);
          setLoading(false);
          return;
        }
        setError(data.error || "שגיאה בהתחברות");
        setLoading(false);
        return;
      }

      if (data.is_admin) {
        router.push("/admin");
      } else {
        router.push("/worker");
      }
    } catch {
      setError("שגיאת רשת");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">שב&quot;צ-נא</CardTitle>
          <p className="text-sm text-muted-foreground">מערכת ניהול משמרות</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="worker_id">מספר עובד</Label>
              <Input
                id="worker_id"
                value={workerId}
                onChange={(e) => {
                  setWorkerId(e.target.value);
                  setNeedsPassword(false);
                  setError("");
                }}
                placeholder="הזן מספר עובד"
                autoFocus
                disabled={loading}
              />
            </div>

            {needsPassword && (
              <div className="space-y-2">
                <Label htmlFor="password">סיסמה</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="הזן סיסמה"
                  autoFocus
                  disabled={loading}
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading || !workerId.trim()}>
              {loading ? "מתחבר..." : "כניסה"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
