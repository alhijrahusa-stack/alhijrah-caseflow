import * as React from "react";

import { cn } from "@/lib/utils";

const fieldClass = "w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] text-[15px] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--muted)] focus:border-accent-400 focus:ring-2 focus:ring-accent-200 dark:focus:ring-accent-500/30 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-11 px-4", fieldClass, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("min-h-24 px-4 py-3 leading-7", fieldClass, className)} {...props} />
));
Textarea.displayName = "Textarea";