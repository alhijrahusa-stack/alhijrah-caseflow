"use client";

export type Choice = { value: string; label: string; hint?: string | null };

/** Checkbox list. Order of `value` follows the order items were ticked. */
export function MultiSelect({
  name,
  choices,
  value,
  onChange,
  disabled,
  numbered,
}: {
  name: string;
  choices: Choice[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: (v: string) => string | null;
  numbered?: boolean;
}) {
  if (!choices.length) return <p className="text-sm text-slate-500">No options available for the current selection.</p>;
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{name}</legend>
      {choices.map((c) => {
        const checked = value.includes(c.value);
        const reason = disabled?.(c.value) ?? null;
        const pos = value.indexOf(c.value);
        return (
          <label
            key={c.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors duration-200 ${
              checked ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-slate-300"
            } ${reason ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={checked}
              disabled={Boolean(reason)}
              onChange={(e) => onChange(e.target.checked ? [...value, c.value] : value.filter((v) => v !== c.value))}
            />
            <span className="flex-1">
              <span className="block font-medium">
                {numbered && checked && <span className="mr-2 rounded bg-brand-600 px-1.5 text-xs text-white">{pos + 1}</span>}
                {c.label}
              </span>
              {c.hint && <span className="block text-sm text-slate-500">{c.hint}</span>}
              {reason && <span className="block text-xs text-slate-500">{reason}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
