"use client";

/** "שמור תצוגה": asks for a title, then POSTs the spec (without data) + source. */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { InsightCardContent } from "./insight-card";

export function SaveViewButton({ content, question }: { content: InsightCardContent; question: string }) {
  const { kind, spec } = content;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(spec.title);
  const [saving, setSaving] = useState(false);
  // Ref, not state: two Enter presses can land before the re-render that disables the button.
  const inFlight = useRef(false);

  async function save() {
    if (!title.trim() || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      // The server's schema drops data/truncated; only source lives outside the spec.
      // Default table columns (none chosen) aren't saved, so re-runs show every column the result has then.
      const { source, ...rest } = spec;
      if ("columns_default" in rest && rest.columns_default) delete (rest as { columns?: unknown }).columns;
      const res = await fetch("/api/insights/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), question, kind, spec: { ...rest, title: title.trim() }, source }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "שמירת התצוגה נכשלה");
        return;
      }
      toast.success("התצוגה נשמרה");
      setOpen(false);
    } catch {
      toast.error("שמירת התצוגה נכשלה");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] nocturne-text-muted hover:opacity-80"
      >
        <Bookmark className="size-3" /> שמור תצוגה
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>שמירת תצוגה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="insight-title">כותרת</Label>
            <Input
              id="insight-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
              }}
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">התצוגה תהיה זמינה לכל המנהלים, עם נתונים עדכניים בכל פתיחה.</p>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>ביטול</Button>
            <Button onClick={() => void save()} disabled={!title.trim() || saving}>שמירה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
