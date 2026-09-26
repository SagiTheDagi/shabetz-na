export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="flex-none rounded-[9px] bg-[#2b2741] nocturne-accent-light grid place-items-center text-[13px]"
    >
      {name?.[0] ?? "?"}
    </span>
  );
}
