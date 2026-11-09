"use client";

import { memo, useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";

type Props = Omit<ComponentProps<"button">, "onClick"> & {
  onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown;
  pending?: boolean;
  pendingLabel?: ReactNode;
};

/** Native button semantics; synchronous exclusion before React commits the pending state. */
export const ActionButton = memo(function ActionButton({ onClick, pending = false, pendingLabel, disabled, children, ...props }: Props) {
  const [running, setRunning] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = pending || running;
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (lock.current || busy || disabled) { event.preventDefault(); return; }
    if (!onClick) return;
    lock.current = true;
    let result: unknown;
    try { result = onClick(event); }
    catch (error) { lock.current = false; throw error; }
    if (!result || typeof (result as PromiseLike<unknown>).then !== "function") { lock.current = false; return; }
    setRunning(true);
    // The handler retains its own error UI. Rejections remain visible to the
    // browser error channel, and never strand the synchronous lock.
    void Promise.resolve(result).catch(error => { window.dispatchEvent(new ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error) })); }).finally(() => {
      lock.current = false; if (mounted.current) setRunning(false);
    });
  }
  return <button {...props} className={`cg-action-control ${props.className ?? ""}`} disabled={disabled || busy} aria-busy={busy || props["aria-busy"]} data-action-pending={busy || undefined} onClick={click}>
    {busy && pendingLabel ? pendingLabel : children}
  </button>;
});
