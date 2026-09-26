interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div className="min-h-14 flex items-center gap-2.5 px-3 py-2">
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-[11.5px] nocturne-text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mr-auto flex-none w-[46px] h-7 rounded-full p-[3px] flex ${
          checked
            ? "justify-start bg-[#2f2a4d] shadow-[inset_0_0_0_1px_#9184d9]"
            : "justify-end bg-[#232532] shadow-[inset_0_0_0_1px_#3f424d]"
        }`}
      >
        <span
          className={`w-[22px] h-[22px] rounded-full ${checked ? "bg-[#b5abfc]" : "bg-[#5c6070]"}`}
        />
      </button>
    </div>
  );
}
