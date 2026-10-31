"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import "./toast.css";

type Kind = "success" | "error" | "warning" | "info";
type Toast = { id: number; kind: Kind; message: string };
const Ctx = createContext<(kind: Kind, message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => { for (const timer of pending.values()) clearTimeout(timer); pending.clear(); };
  }, []);
  const push = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4500));
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="cg-toast-stack" aria-live="polite" aria-relevant="additions" role="status">
        {toasts.map((t) => (
          <div key={t.id} data-testid={`toast-${t.kind}`} data-kind={t.kind} className="cg-toast">
            <span className="cg-toast-symbol" aria-hidden="true">{t.kind === "error" ? "!" : t.kind === "success" ? "✓" : t.kind === "warning" ? "!" : "i"}</span>
            <span>{t.message}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
