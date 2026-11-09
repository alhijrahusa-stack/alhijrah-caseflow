"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { acquireModalLayer, isTopModalLayer, releaseModalLayer } from "@/lib/modal-layer";
import "@/components/staff/smart/royal-intake.css";

/** A context-preserving dialog with keyboard containment and focus restoration. */
export function GlassReviewDialog({ title, children, onClose, wide = false, drawer = false, closeLabel }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; drawer?: boolean; closeLabel?: string;
}) {
  const { t } = useStaffLanguage();
  const ref = useRef<HTMLElement>(null);
  const token = useRef(Symbol("review-dialog"));
  const titleId = useId();
  const [entering, setEntering] = useState(true);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const id = token.current;
    acquireModalLayer(id);
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = ref.current;
    panel?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopModalLayer(id)) return;
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
      const wasTop = isTopModalLayer(id);
      releaseModalLayer(id);
      document.removeEventListener("keydown", keydown);
      if (wasTop && prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className={`cg-glass-dialog-layer ${drawer ? "is-drawer" : ""}`} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className={`cg-glass-dialog ${wide ? "is-wide" : ""}`} data-entering={entering} onAnimationEnd={event => { if (event.target === event.currentTarget) setEntering(false); }} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><div><span className="cg-dialog-kicker">CAREER GATE · REVIEW</span><h2 id={titleId}>{title}</h2></div><button type="button" className="cg-review-button" aria-label={closeLabel ?? `${t("Close","إغلاق")} ${title}`} onClick={onClose}>✕</button></header>
      <div className="cg-glass-dialog-body">{children}</div>
    </section>
  </div>, document.body);
}
