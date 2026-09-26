"use client";

import { useEffect } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title?: string;
  closeLabel?: string;
  /** Fixed height (e.g. "70dvh"); omit for content height. */
  height?: string;
  children: React.ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  eyebrow,
  title,
  closeLabel = "סגירה",
  height,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(10,11,18,.55)]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        style={{ height, maxHeight: "92dvh" }}
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl bg-[#1c1e2c] shadow-[0_-12px_40px_rgba(0,0,0,.45)]"
      >
        <div className="flex justify-center pt-2.5">
          <span className="block w-[38px] h-1 rounded-sm bg-[#3f424d]" />
        </div>
        {(eyebrow || title) && (
          <div className="flex items-start gap-2.5 px-[18px] pt-3 pb-2.5">
            <div className="flex flex-col gap-0.5 min-w-0">
              {eyebrow && <span className="text-xs nocturne-accent">{eyebrow}</span>}
              {title && <span className="text-[17px] truncate">{title}</span>}
            </div>
            <button
              onClick={onClose}
              className="mr-auto min-h-10 px-3 text-[13px] nocturne-text-tertiary"
            >
              {closeLabel}
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col pb-[max(20px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
