"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <div className="min-h-screen flex items-center justify-center p-4 nocturne-bg">
      <div className="w-full max-w-[400px] rounded-[14px] p-6 nocturne-surface shadow-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-[28px] font-semibold mb-1 nocturne-text tracking-tight">
            שב״צ-נא
          </h1>
          <p className="text-sm nocturne-text-muted">
            מערכת ניהול משמרות רבעוניות
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label 
              htmlFor="worker_id" 
              className="block text-xs nocturne-text-subtle"
            >
              מספר עובד
            </label>
            <input
              id="worker_id"
              type="text"
              value={workerId}
              onChange={(e) => {
                setWorkerId(e.target.value);
                setNeedsPassword(false);
                setError("");
              }}
              placeholder="הזן מספר עובד"
              autoFocus
              disabled={loading}
              className="w-full h-9 px-2.5 text-sm rounded-lg outline-none transition-colors nocturne-surface nocturne-text border nocturne-border focus:border-primary caret-primary"
            />
          </div>

          {needsPassword && (
            <div className="space-y-1.5">
              <label 
                htmlFor="password" 
                className="block text-xs nocturne-text-subtle"
              >
                סיסמה
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="הזן סיסמה"
                autoFocus
                disabled={loading}
                className="w-full h-9 px-2.5 text-sm rounded-lg outline-none transition-colors nocturne-surface nocturne-text border nocturne-border focus:border-primary caret-primary"
              />
            </div>
          )}

          {error && (
            <div className="text-sm p-2.5 rounded-lg bg-status-unavailable-bg text-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !workerId.trim()}
            className="w-full h-9 text-sm font-medium rounded-lg transition-colors disabled:opacity-45 disabled:cursor-not-allowed bg-transparent border border-primary text-primary hover:bg-primary/10"
          >
            {loading ? "מתחבר..." : "כניסה"}
          </button>
        </form>
      </div>
    </div>
  );
}
