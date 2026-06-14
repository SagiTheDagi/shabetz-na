export interface ParsedShiftDate {
  date: string; // ISO format YYYY-MM-DD
  shift_type_id: string;
  is_weekend: boolean;
  display_date: string; // DD/MM/YYYY
  day_name: string;
}

const HEBREW_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  // Thursday (4), Friday (5), Saturday (6)
  return day === 4 || day === 5 || day === 6;
}

function parseDateString(raw: string): Date | null {
  const trimmed = raw.trim();

  // Try DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // Try YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

export function parseShiftFile(
  content: string,
  defaultShiftTypeId: string
): { dates: ParsedShiftDate[]; errors: string[] } {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  const dates: ParsedShiftDate[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Format: date[,shift_type_id] or date[\tshift_type_id]
    const parts = line.split(/[,\t]+/).map((p) => p.trim());
    const dateStr = parts[0];
    const shiftTypeId = parts[1] || defaultShiftTypeId;

    const parsed = parseDateString(dateStr);
    if (!parsed) {
      errors.push(`שורה ${i + 1}: לא ניתן לפרסר תאריך "${dateStr}"`);
      continue;
    }

    const isoDate = parsed.toISOString().split("T")[0];
    const day = parsed.getDay();

    dates.push({
      date: isoDate,
      shift_type_id: shiftTypeId,
      is_weekend: isWeekend(parsed),
      display_date: `${parsed.getDate().toString().padStart(2, "0")}/${(parsed.getMonth() + 1).toString().padStart(2, "0")}/${parsed.getFullYear()}`,
      day_name: HEBREW_DAYS[day],
    });
  }

  // Sort by date
  dates.sort((a, b) => a.date.localeCompare(b.date));

  return { dates, errors };
}
