import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const TONES = {
  info: { box: "border-info/30 bg-info/10 text-fg", icon: Info, iconClass: "text-info" },
  ok: { box: "border-ok/30 bg-ok/10 text-fg", icon: CheckCircle2, iconClass: "text-ok" },
  warn: { box: "border-warn/30 bg-warn/10 text-fg", icon: AlertTriangle, iconClass: "text-warn" },
  danger: { box: "border-danger/30 bg-danger/10 text-fg", icon: XCircle, iconClass: "text-danger" },
} as const;

/** Inline message block. Errors pass role="alert" explicitly. */
export function Notice({
  tone = "info",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof TONES }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-6", t.box, className)} {...props}>
      <Icon className={cn("mt-1 size-4 shrink-0", t.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
