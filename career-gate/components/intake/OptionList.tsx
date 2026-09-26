export function OptionList({
  options,
  value,
  onSelect,
  name,
}: {
  options: { value: string; label: string; hint?: string }[];
  value: string | null;
  onSelect: (value: string) => void;
  name: string;
}) {
  if (!options.length) return <p className="text-sm text-slate-500">No options available.</p>;
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(o.value)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              selected
                ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <span className="block font-medium">{o.label}</span>
            {o.hint && <span className="block text-sm text-slate-500">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
