"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import "@/components/staff/smart/royal-intake.css";

const dialogStack: symbol[] = [];
let originalOverflow: string | null = null;

/** A context-preserving dialog with keyboard containment and focus restoration. */
export function GlassReviewDialog({ title, children, onClose, wide = false, drawer = false, closeLabel }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; drawer?: boolean; closeLabel?: string;
}) {
  const { t } = useStaffLanguage();
  const ref = useRef<HTMLElement>(null);
  const token = useRef(Symbol("review-dialog"));
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const id = token.current;
    if (dialogStack.length === 0) originalOverflow = document.body.style.overflow;
    dialogStack.push(id);
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const panel = ref.current;
    panel?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || dialogStack.at(-1) !== id) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"],iframe')).filter((node) => node.tabIndex >= 0 && !node.closest('[inert],[aria-hidden="true"]') && node.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      const wasTop = dialogStack.at(-1) === id;
      const position = dialogStack.indexOf(id);
      if (position !== -1) dialogStack.splice(position, 1);
      document.removeEventListener("keydown", keydown);
      if (dialogStack.length === 0) { document.body.style.overflow = originalOverflow ?? ""; originalOverflow = null; }
      if (wasTop && prior?.isConnected) prior.focus();
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className={`cg-glass-dialog-layer ${drawer ? "is-drawer" : ""}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className={`cg-glass-dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><div><span className="cg-dialog-kicker">CAREER GATE · REVIEW</span><h2 id={titleId}>{title}</h2></div><button type="button" className="cg-review-button" aria-label={closeLabel ?? `${t("Close","إغلاق")} ${title}`} onClick={onClose}>✕</button></header>
      <div className="cg-glass-dialog-body">{children}</div>
    </section>
  </div>, document.body);
}
