const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const MONTH_SHORT = ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];
const MONTH_FULL = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

export function dayShort(iso: string) {
  return DAY_SHORT[new Date(iso + "T12:00:00").getDay()];
}

export function monthShort(iso: string) {
  return MONTH_SHORT[Number(iso.slice(5, 7)) - 1];
}

export function monthLabel(iso: string) {
  return `${MONTH_FULL[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export function DateChip({ iso, weekend }: { iso: string; weekend?: boolean }) {
  return (
    <span
      className={`w-[52px] h-11 flex-none rounded-[10px] flex flex-col items-center justify-center gap-0.5 ${
        weekend ? "bg-[#2b2741]" : "bg-[#292b31]"
      }`}
    >
      <span className="text-[15px] leading-none font-sans">{iso.slice(8, 10)}</span>
      <span className="text-[9.5px] leading-none whitespace-nowrap nocturne-text-tertiary">
        {dayShort(iso)} · {monthShort(iso)}
      </span>
    </span>
  );
}
