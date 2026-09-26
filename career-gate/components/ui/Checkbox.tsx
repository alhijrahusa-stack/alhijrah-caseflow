import type { InputHTMLAttributes } from "react";

export function Checkbox({
  label,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 text-sm ${className}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
