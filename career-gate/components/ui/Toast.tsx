"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Kind = "success" | "error" | "warning" | "info";
type Toast = { id: number; kind: Kind; message: string };
const Ctx = createContext<(kind: Kind, message: string) => void>(() => undefined);

const TONE: Record<Kind, string> = {
  success: "border-green-300 bg-green-50 text-green-900",
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-slate-300 bg-white text-slate-900",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} data-testid={`toast-${t.kind}`} className={`pointer-events-auto rounded-md border px-4 py-3 text-sm shadow-md transition-opacity duration-200 ${TONE[t.kind]}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
