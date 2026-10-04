import { toast } from "sonner";
import type { ChangeEvent } from "react";

export function isExcelFile(file: File): boolean {
  return /\.xlsx?$/i.test(file.name);
}

/** Read as an ArrayBuffer for Excel files, as text for everything else (CSV/TSV/TXT). */
export async function readImportFile<T>(
  file: File,
  parsers: { excel: (buffer: ArrayBuffer) => T; text: (content: string) => T }
): Promise<T> {
  return isExcelFile(file) ? parsers.excel(await file.arrayBuffer()) : parsers.text(await file.text());
}

/**
 * Shared <input type="file"> onChange flow: pick the file, run `handler`,
 * toast on unexpected failure, and always clear the input so the same file can be re-picked.
 */
export async function handleImportInput(
  e: ChangeEvent<HTMLInputElement>,
  handler: (file: File) => Promise<void>
): Promise<void> {
  const input = e.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await handler(file);
  } catch {
    toast.error("שגיאה בקריאת הקובץ");
  } finally {
    input.value = "";
  }
}
