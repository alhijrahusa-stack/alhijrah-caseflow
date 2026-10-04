"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "ok" | "info" | "danger";
type ToastItem = { id: number; text: string; tone: Tone };
type ToastFn = (text: string, tone?: Tone) => void;

const Ctx = createContext<ToastFn>(() => undefined);

/** Non-blocking micro notifications. They never take focus and dismiss themselves. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const toast = useCallback<ToastFn>((text, tone = "ok") => {
    const id = next.current++;
    setItems((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), tone === "danger" ? 6000 : 3200);
  }, []);
  const value = useMemo(() => toast, [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6"
        role="status"
        aria-live="polite"
        data-testid="toasts"
      >
        {items.map((t) => {
          const Icon = t.tone === "danger" ? AlertTriangle : t.tone === "info" ? Info : CheckCircle2;
          return (
            <div
              key={t.id}
              className="glass-strong fade-in flex max-w-sm items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium text-fg shadow-pop"
            >
              <Icon className={cn("size-4 shrink-0", t.tone === "danger" ? "text-danger" : t.tone === "info" ? "text-info" : "text-primary-text")} aria-hidden />
              <span dir="auto">{t.text}</span>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(Ctx);
}
