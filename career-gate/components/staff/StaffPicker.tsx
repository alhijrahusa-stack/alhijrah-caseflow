"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffMember } from "@/components/staff/StaffContext";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("") || "—";
}

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
  const selected = staff.find((member) => member.id === value) ?? null;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="staff-picker" ref={root}>
      <button
        type="button"
        className="staff-picker-trigger"
        aria-label="Handled by"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="staff-picker-avatar">{selected ? initials(selected.display_name) : "—"}</span>
        <span className="staff-picker-copy">
          <strong>{selected?.display_name ?? "Unassigned"}</strong>
          <small>
            {selected?.staff_code ?? "No owner assigned"}
            {selected && <> · {selected.role}</>}
          </small>
          {selected && (
            <span>
              <span className="staff-picker-role">{selected.role}</span>
              {selected.eligible_for_round_robin && <span className="staff-picker-rr">Round-robin</span>}
            </span>
          )}
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>

      {open && !disabled && (
        <div className="staff-picker-menu" role="listbox" aria-label="Available staff">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className="staff-picker-option"
            onClick={() => { onChange(""); setOpen(false); }}
          >
            <span className="staff-picker-avatar muted">—</span>
            <span><strong>Unassigned</strong><small>No owner assigned</small></span>
            {!value && <b aria-hidden="true">✓</b>}
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
              <span className="staff-picker-avatar">{initials(member.display_name)}</span>
              <span>
                <strong>{member.display_name}</strong>
                <small>{member.staff_code ?? "No staff code"}</small>
                <span className="staff-picker-role">{member.role}</span>
                {member.eligible_for_round_robin && <span className="staff-picker-rr">Round-robin</span>}
              </span>
              {member.id === value && <b aria-hidden="true">✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
