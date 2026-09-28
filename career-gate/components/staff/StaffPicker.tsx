"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffMember } from "@/components/staff/StaffContext";

export function StaffPicker({
  value,
  staff,
  onChange,
  disabled = false,
}: {
  value: string;
  staff: StaffMember[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = staff.find((s) => s.id === value) ?? null;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="staff-picker" ref={root}>
      <button
        type="button"
        className="staff-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="staff-picker-avatar">{selected?.display_name.trim().slice(0, 1).toUpperCase() ?? "—"}</span>
        <span className="staff-picker-copy">
          <strong>{selected?.display_name ?? "Unassigned"}</strong>
          <small>{selected?.staff_code ?? "No owner assigned"}</small>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>

      {open && !disabled && (
        <div className="staff-picker-menu" role="listbox">
          <button type="button" role="option" aria-selected={!value} className="staff-picker-option" onClick={() => { onChange(""); setOpen(false); }}>
            <span className="staff-picker-avatar muted">—</span>
            <span><strong>Unassigned</strong><small>No owner assigned</small></span>
            {!value && <b>✓</b>}
          </button>
          {staff.map((member) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={member.id === value}
              className="staff-picker-option"
              onClick={() => { onChange(member.id); setOpen(false); }}
            >
              <span className="staff-picker-avatar">{member.display_name.trim().slice(0, 1).toUpperCase()}</span>
              <span><strong>{member.display_name}</strong><small>{member.staff_code ?? member.role}</small></span>
              {member.id === value && <b>✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
