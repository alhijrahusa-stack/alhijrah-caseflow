import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-2xl border hairline bg-white/70 px-4 text-[15px] outline-none transition placeholder:text-[var(--muted)] focus:border-accent-400 focus:ring-2 focus:ring-accent-200 dark:bg-white/[0.04] dark:focus:ring-accent-500/30",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full rounded-2xl border hairline bg-white/70 px-4 py-3 text-[15px] leading-7 outline-none transition focus:border-accent-400 focus:ring-2 focus:ring-accent-200 dark:bg-white/[0.04] dark:focus:ring-accent-500/30",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
