const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

export function dayShort(iso: string) {
  return DAY_SHORT[new Date(iso + "T12:00:00").getDay()];
}

export function DateChip({ iso, weekend }: { iso: string; weekend?: boolean }) {
  return (
    <span
      className={`w-10 h-10 flex-none rounded-[10px] flex flex-col items-center justify-center ${
        weekend ? "bg-[#2b2741]" : "bg-[#292b31]"
      }`}
    >
      <span className="text-[15px] leading-none font-sans">{iso.slice(8, 10)}</span>
      <span className="text-[10px] nocturne-text-tertiary">{dayShort(iso)}</span>
    </span>
  );
}
