"use client";

import {
  Children, Fragment, forwardRef, isValidElement, useCallback, useEffect,
  useId, useImperativeHandle, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import "./royal-select.css";

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string; labelEn?: string; labelAr?: string };
type Choice = { value: string; label: string; disabled: boolean };

/** Declarative option data. RoyalSelect renders the choices inside its own dark listbox. */
export function RoyalOption(props: OptionProps) { void props; return null; }

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}

function choicesFrom(children: ReactNode, language: "en" | "ar"): Choice[] {
  const result: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === Fragment) { result.push(...choicesFrom(child.props.children, language)); return; }
    const englishLabel = child.props.labelEn ?? child.props.label ?? textContent(child.props.children) ?? "";
    const label = language === "ar" ? child.props.labelAr ?? englishLabel : englishLabel;
    result.push({ value: String(child.props.value ?? englishLabel), label, disabled: Boolean(child.props.disabled) });
  });
  return result;
}

export type RoyalSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size" | "onKeyDown" | "onFocus" | "onBlur" | "onClick" | "onChange" | "value" | "defaultValue"> & {
  value?: string | number;
  defaultValue?: string | number;
  searchable?: boolean;
  ariaLabelAr?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

/**
 * Select-only ARIA combobox. Its form value is a real, validatable input; its
 * visible surface and listbox are custom, so mobile never opens a white picker.
 */
export const RoyalSelect = forwardRef<HTMLButtonElement, RoyalSelectProps>(function RoyalSelect({
  children, value, defaultValue, name, form, id, disabled, required, className = "",
  searchable, ariaLabelAr, onChange, onKeyDown, onFocus, onBlur, onClick, autoFocus, title,
  "aria-label": ariaLabel, "aria-labelledby": labelledBy, "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid, ...rest
}, forwardedRef) {
  const { t, language } = useStaffLanguage();
  const accessibleLabel = language === "ar" ? ariaLabelAr ?? ariaLabel : ariaLabel;
  const listLabel = accessibleLabel || title
    ? `${accessibleLabel ?? title} ${t("options", "خيارات")}`
    : t("Options", "الخيارات");
  const generatedId = useId();
  const triggerId = id ?? `royal-select-${generatedId}`;
  const listId = `${triggerId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const optionSearch = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => trigger.current!, []);
  const choices = useMemo(() => choicesFrom(children, language), [children, language]);
  const initialValue = String(defaultValue ?? choices.find(option => !option.disabled)?.value ?? "");
  const [localValue, setLocalValue] = useState(initialValue);
  const currentValue = value === undefined ? localValue : String(value);
  const chosen = choices.find(option => option.value === currentValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, bottom: 0, flip: false, width: 0, maxHeight: 320, direction: "ltr" });
  const typeAhead = useRef({ text: "", time: 0 });
  const canSearch = searchable ?? choices.length > 8;
  const visible = useMemo(() => choices.filter(option => !query || option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [choices, query]);
  const firstEnabled = visible.findIndex(option => !option.disabled);
  const activeIndex = visible[active] && !visible[active].disabled ? active : firstEnabled;

  const measure = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const padding = 10;
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - padding * 2);
    const spaceBelow = window.innerHeight - rect.bottom - padding - 6;
    const spaceAbove = rect.top - padding - 6;
    const flip = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(100, Math.min(340, flip ? spaceAbove : spaceBelow));
    setPosition({
      left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
      top: rect.bottom + 6, bottom: window.innerHeight - rect.top + 6, flip,
      width, maxHeight, direction: getComputedStyle(trigger.current).direction,
    });
  }, []);

  const show = () => {
    if (disabled) return;
    measure();
    setQuery("");
    const index = choices.findIndex(option => option.value === currentValue && !option.disabled);
    setActive(index >= 0 ? index : Math.max(0, choices.findIndex(option => !option.disabled)));
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const onViewport = () => measure();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open, measure]);

  useEffect(() => {
    const parentForm = field.current?.form;
    if (!parentForm || value !== undefined) return;
    const reset = () => { setLocalValue(initialValue); setInvalid(false); setOpen(false); };
    parentForm.addEventListener("reset", reset);
    return () => parentForm.removeEventListener("reset", reset);
  }, [initialValue, value]);

  useEffect(() => {
    if (open && activeIndex >= 0) popup.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const choose = (option: Choice) => {
    if (option.disabled || disabled) return;
    if (value === undefined) setLocalValue(option.value);
    setInvalid(false);
    setOpen(false);
    // Match the existing select change contract without rendering a native picker.
    const target = { value: option.value, name: name ?? "", id: triggerId } as HTMLSelectElement;
    onChange?.({ target, currentTarget: target, type: "change" } as ChangeEvent<HTMLSelectElement>);
    trigger.current?.focus();
  };

  const move = (direction: number) => {
    if (!visible.length) return;
    let index = activeIndex;
    for (let count = 0; count < visible.length; count++) {
      index = (index + direction + visible.length) % visible.length;
      if (!visible[index].disabled) { setActive(index); return; }
    }
  };

  const keys = (event: KeyboardEvent<HTMLButtonElement | HTMLInputElement>) => {
    const inSearch = event.currentTarget === optionSearch.current;
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return;
    }
    if (event.key === "Tab") { if (inSearch) trigger.current?.focus(); setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) { show(); return; }
      if (event.key === "ArrowDown") move(1);
      else if (event.key === "ArrowUp") move(-1);
      else if (event.key === "Home") setActive(firstEnabled);
      else {
        let last = visible.length - 1;
        while (last >= 0 && visible[last].disabled) last--;
        setActive(last);
      }
      return;
    }
    if (event.key === "Enter" || (event.key === " " && !inSearch)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) show(); else if (visible[activeIndex]) choose(visible[activeIndex]);
      return;
    }
    if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = `${now - typeAhead.current.time < 750 ? typeAhead.current.text : ""}${event.key.toLocaleLowerCase()}`;
      typeAhead.current = { text, time: now };
      const candidates = open ? visible : choices;
      const index = candidates.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(text));
      if (!open) show();
      if (index >= 0) setActive(index);
    }
  };

  // Strip select-only DOM attributes; data-* attributes and ARIA remain on the trigger.
  const { onInvalid: _onInvalid, ...triggerProps } = rest;
  return <span className="royal-select-root" data-disabled={disabled || undefined}>
    <input ref={field} className="royal-select-form-value" type="text" name={name} form={form}
      value={currentValue} readOnly={false} required={required} disabled={disabled} tabIndex={-1} aria-hidden="true"
      autoComplete="off" onChange={() => {}} onInvalid={event => {
        event.preventDefault(); setInvalid(true); trigger.current?.focus();
        _onInvalid?.(event as unknown as React.InvalidEvent<HTMLSelectElement>);
      }}/>
    <button {...triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>} ref={trigger} id={triggerId} type="button"
      role="combobox" aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      aria-label={accessibleLabel} aria-labelledby={labelledBy} aria-describedby={describedBy}
      aria-required={required || undefined} aria-invalid={ariaInvalid ?? (invalid || undefined)}
      disabled={disabled} autoFocus={autoFocus} title={title ?? chosen?.label}
      className={`royal-select-trigger ${className}`} data-value={currentValue}
      onFocus={onFocus} onBlur={onBlur}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (open) setOpen(false); else show(); } }}
      onKeyDown={event => { keys(event); if (!event.defaultPrevented) onKeyDown?.(event); }}>
      <span className="royal-select-value">{chosen?.label || "—"}</span>
      <span className="royal-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && !disabled && createPortal(<div ref={popup} className="royal-select-popup" dir={position.direction}
      style={{ left: position.left, top: position.flip ? undefined : position.top, bottom: position.flip ? position.bottom : undefined, width: position.width, maxHeight: position.maxHeight }}>
      {canSearch && <div className="royal-select-search"><input ref={optionSearch} type="search" placeholder={t("Search options…", "ابحث في الخيارات…")} aria-label={t("Search options", "البحث في الخيارات")}
        aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keys}/></div>}
      <div id={listId} role="listbox" aria-label={listLabel} className="royal-select-options">
        {visible.length ? visible.map((option, index) => <div key={`${option.value}-${index}`} id={`${listId}-${index}`} role="option"
          aria-selected={option.value === currentValue} aria-disabled={option.disabled || undefined}
          data-option-index={index} data-value={option.value} data-active={index === activeIndex || undefined}
          className="royal-select-option" onPointerMove={() => { if (!option.disabled) setActive(index); }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <span>{option.label}</span><span className="royal-select-radio" aria-hidden="true"/>
        </div>) : <p className="royal-select-empty">{t("No matching options", "لا توجد خيارات مطابقة")}</p>}
      </div>
    </div>, document.body)}
    {invalid && <span className="royal-select-error" role="alert">{t("Please select an option.", "يرجى اختيار أحد الخيارات.")}</span>}
  </span>;
});
