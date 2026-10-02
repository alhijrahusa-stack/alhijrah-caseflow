import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-lg border border-line-strong bg-surface-2 text-[15px] text-fg outline-none transition-colors duration-150 placeholder:text-fg-subtle hover:border-fg-subtle/50 focus:border-primary-text focus:ring-2 focus:ring-primary/30 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, "h-10 px-3.5", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldClass, "min-h-24 px-3.5 py-2.5 leading-7", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** Native select (keeps platform pickers on mobile) styled to the field tokens. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <select ref={ref} className={cn(fieldClass, "h-10 appearance-none pe-9 ps-3.5 text-sm", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
    </div>
  ),
);
Select.displayName = "Select";

export function Field({ label, hint, className, children }: { label: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[13px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg-muted", className)}>
      <input type="checkbox" className="size-4 rounded border-line-strong" {...props} />
      {label}
    </label>
  );
}
