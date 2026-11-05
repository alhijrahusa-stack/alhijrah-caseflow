"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useAction } from "@/components/forms/useAction";
import { useStaff } from "@/components/staff/StaffContext";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { LOCATION_DIRECTORY as LOCATIONS, SHIFT_TYPES, locationIndexForCode, matchLocations } from "@/lib/location-shift-options";
import "./quick-location.css";

type Props = {
  clientId: string;
  /** What the file shows today: the client's preferred location, else the primary preference's site. */
  label: string | null;
  /** Site code of the primary preference, or null when the client has none. */
  siteCode: string | null;
};

type Pending = { basis: string | null; label: string; siteCode: string };

/**
 * Preferred location with an in-place editor. The new site shows at once
 * (optimistic) and reverts if the save is refused; the save updates the
 * primary preference the pipeline reads, the file's preferred location and
 * the activity log in one transaction. Managers only, as for preferences.
 */
export function QuickLocationEdit({ clientId, label, siteCode }: Props) {
  const { isManager } = useStaff();
  const { t, dir } = useStaffLanguage();
  const action = useAction({ successMessage: null });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The optimistic value holds until the server's value changes under it.
  const optimistic = pending && pending.basis === label ? pending : null;
  const shown = optimistic?.label ?? label;
  const currentCode = optimistic?.siteCode ?? siteCode;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  async function save(index: number, shift: string | null) {
    const location = LOCATIONS[index];
    const basis = label;
    setPending({ basis, label: location.name, siteCode: location.code });
    close(true);
    const result = await action.run({
      action: "set_preferred_location", client_id: clientId, location: index,
      expected_site_code: currentCode, ...(shift ? { shift } : {}),
    }, t(`Preferred location set to ${location.name}`, `تم تعيين الموقع المفضل إلى ${location.name}`));
    if (!result) setPending(null);
  }

  return (
    <span className="cg-qle" dir={dir}>
      <span className="cg-qle-value" data-testid="preferred-location-value" data-pending={action.pending || undefined}>{shown ?? "—"}</span>
      {isManager && (
        <button ref={trigger} type="button" className="cg-qle-trigger" aria-haspopup="dialog" aria-expanded={open}
          aria-label={t("Change preferred location", "تغيير الموقع المفضل")} title={t("Change preferred location", "تغيير الموقع المفضل")}
          aria-disabled={action.pending || undefined} onClick={() => { if (!action.pending) setOpen((value) => !value); }}>
          <span aria-hidden="true" className="cg-qle-icon" />
        </button>
      )}
      {open && (
        <LocationPicker anchor={trigger} currentIndex={locationIndexForCode(currentCode)} needsShift={currentCode === null}
          onCancel={() => close(true)} onSave={save} />
      )}
    </span>
  );
}

function LocationPicker({ anchor, currentIndex, needsShift, onCancel, onSave }: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  currentIndex: number;
  needsShift: boolean;
  onCancel: () => void;
  onSave: (index: number, shift: string | null) => void;
}) {
  const { t, dir } = useStaffLanguage();
  const ids = useId();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(currentIndex);
  const [active, setActive] = useState(0);
  const [shift, setShift] = useState("");
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const results = useMemo(() => matchLocations(query), [query]);
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const canSave = selected >= 0 && selected !== currentIndex && (!needsShift || shift !== "");

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      const left = Math.min(Math.max(12, dir === "rtl" ? rect.right - width : rect.left - 12), window.innerWidth - width - 12);
      // Open downward when the full panel fits below the button, else grow upward from it,
      // so the panel stays attached to the button as the result list shrinks or grows.
      const height = Math.max(panel.current?.scrollHeight ?? 0, 420);
      const fitsBelow = rect.bottom + 8 + height <= window.innerHeight - 12 || rect.top < window.innerHeight / 2;
      setPosition(fitsBelow ? { left, top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 });
    };
    place();
    // Focus once placed: an element that is still visibility:hidden cannot take focus.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, dir]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) onCancel();
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [anchor, onCancel]);

  useEffect(() => {
    document.getElementById(`${ids}-opt-${results[activeIndex]?.index}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, ids, results]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== input.current) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(Math.min(activeIndex + 1, results.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); }
    else if (event.key === "Enter") {
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && canSave) { onSave(selected, needsShift ? shift : null); return; }
      const choice = results[activeIndex];
      if (choice) setSelected(choice.index);
    }
  }

  const titleId = `${ids}-title`;
  const listId = `${ids}-list`;
  return createPortal(
    <div ref={panel} role="dialog" aria-modal="false" aria-labelledby={titleId} dir={dir} className="cg-qle-panel" data-testid="quick-location"
      style={position ? { left: position.left, top: position.top, bottom: position.bottom } : { opacity: 0, pointerEvents: "none" }} onKeyDown={onKeyDown}>
      <header>
        <h3 id={titleId}>{t("Preferred location", "الموقع المفضل")}</h3>
        <button type="button" className="cg-qle-close" aria-label={t("Close", "إغلاق")} onClick={onCancel}>×</button>
      </header>
      <input ref={input} type="search" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={results[activeIndex] ? `${ids}-opt-${results[activeIndex].index}` : undefined}
        aria-label={t("Search locations", "ابحث عن موقع")} placeholder={t("City, building code or street", "المدينة أو رمز المبنى أو الشارع")}
        value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} autoComplete="off" />
      <ul id={listId} role="listbox" aria-label={t("Locations", "المواقع")} className="cg-qle-list">
        {results.map((location, position) => (
          <li key={location.code} id={`${ids}-opt-${location.index}`} role="option" aria-selected={selected === location.index}
            data-active={position === activeIndex || undefined} data-current={location.index === currentIndex || undefined}
            onPointerMove={() => setActive(position)} onClick={() => setSelected(location.index)}>
            <span className="cg-qle-name">{location.name}</span>
            <span className="cg-qle-address" dir="ltr">{location.address}</span>
            {location.index === currentIndex && <span className="cg-qle-badge">{t("Current", "الحالي")}</span>}
          </li>
        ))}
        {results.length === 0 && <li role="presentation" className="cg-qle-empty">{t("No location matches", "لا يوجد موقع مطابق")}</li>}
      </ul>
      {needsShift && (
        <fieldset className="cg-qle-shifts">
          <legend>{t("No primary preference yet — choose a shift", "لا يوجد تفضيل أساسي بعد — اختر الوردية")}</legend>
          <div>
            {SHIFT_TYPES.map(([code, name]) => (
              <label key={code} data-checked={shift === code || undefined}>
                <input type="radio" name={`${ids}-shift`} value={code} checked={shift === code} onChange={() => setShift(code)} />
                {name.split(" / ")[dir === "rtl" ? 1 : 0] ?? name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <footer>
        <span className="cg-qle-hint">{t("Updates the pipeline and activity log", "يُحدِّث المسار وسجل النشاط")}</span>
        <button type="button" className="cg-qle-cancel" onClick={onCancel}>{t("Cancel", "إلغاء")}</button>
        <button type="button" className="cg-qle-save" disabled={!canSave} onClick={() => onSave(selected, needsShift ? shift : null)}>{t("Save", "حفظ")}</button>
      </footer>
    </div>,
    document.body,
  );
}
