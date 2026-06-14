"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AssignmentWarning } from "@/lib/types";

interface ForceAssignModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  warnings: AssignmentWarning[];
  workerName: string;
}

export function ForceAssignModal({
  open,
  onClose,
  onConfirm,
  warnings,
  workerName,
}: ForceAssignModalProps) {
  const [reason, setReason] = useState("");

  function handleConfirm() {
    if (!reason.trim()) return;
    onConfirm(reason.trim());
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>שיבוץ חריג — {workerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">שיבוץ זה חורג מהכללים:</p>
          <ul className="space-y-1">
            {warnings
              .filter((w) => w.severity === "red")
              .map((w, i) => (
                <li
                  key={i}
                  className="text-sm text-red-700 bg-red-50 px-3 py-1.5 rounded flex items-center gap-2"
                >
                  <span>⚠️</span>
                  <span>{w.message}</span>
                </li>
              ))}
          </ul>
          <div className="space-y-2">
            <Label>סיבה לשיבוץ חריג</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="הזן סיבה..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!reason.trim()}
          >
            שיבוץ בכל זאת
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
