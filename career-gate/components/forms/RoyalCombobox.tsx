"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import "./royal-select.css";

/** Dark suggestions for fields that must also accept a new, freely typed value. */
export const RoyalCombobox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { options: readonly string[] }>(function RoyalCombobox({ options, value, defaultValue, onChange, onKeyDown, onFocus, onBlur, ...props }, ref) {
  const { t } = useStaffLanguage();
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  const generatedId = useId();
  const listId = `royal-suggestions-${generatedId}`;
  const [localValue, setLocalValue] = useState(String(defaultValue ?? ""));
  const currentValue = value === undefined ? localValue : String(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, bottom: 0, flip: false, width: 0, maxHeight: 280, direction: "ltr" });
  const visible = options.filter(option => option.toLocaleLowerCase().includes(currentValue.toLocaleLowerCase()));
  const activeIndex = active >= visible.length ? -1 : active;
  const measure = useCallback(() => {
    if (!input.current) return;
    const rect = input.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 20);
    const below = window.innerHeight - rect.bottom - 16;
    const flip = below < 160 && rect.top > below;
    const maxHeight = Math.max(80, Math.min(280, flip ? rect.top - 16 : below));
    setPosition({ left: Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)), top: rect.bottom + 6, bottom: window.innerHeight - rect.top + 6, flip,
      width, maxHeight, direction: getComputedStyle(input.current).direction });
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!input.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);
  const show = () => { if (!props.disabled) { measure(); setOpen(true); } };
  const choose = (text: string) => {
    if (!input.current) return;
    if (value === undefined) setLocalValue(text);
    input.current.value = text;
    onChange?.({ target: input.current, currentTarget: input.current, type: "change" } as ChangeEvent<HTMLInputElement>);
    setActive(-1); setOpen(false); input.current.focus();
  };
  return <span className="royal-combobox-root">
    <input {...props} ref={input} value={currentValue} role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
      aria-expanded={open && visible.length > 0} aria-controls={open && visible.length ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      autoComplete="off" onFocus={event => { show(); onFocus?.(event); }}
      onBlur={event => { setOpen(false); onBlur?.(event); }}
      onChange={event => { if (value === undefined) setLocalValue(event.target.value); setActive(-1); show(); onChange?.(event); }}
      onKeyDown={event => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && visible.length) {
          event.preventDefault(); event.stopPropagation(); show();
          setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
        } else if (event.key === "Enter" && open && activeIndex >= 0) {
          event.preventDefault(); event.stopPropagation(); choose(visible[activeIndex]);
        } else if (event.key === "Tab") setOpen(false);
        if (!event.defaultPrevented) onKeyDown?.(event);
      }}/>
    {open && visible.length > 0 && createPortal(<div ref={popup} className="royal-select-popup" dir={position.direction}
      style={{ left: position.left, top: position.flip ? undefined : position.top, bottom: position.flip ? position.bottom : undefined, width: position.width, maxHeight: position.maxHeight }}>
      <div role="listbox" id={listId} className="royal-select-options" aria-label={`${props["aria-label"] ?? t("Field", "الحقل")} ${t("suggestions", "اقتراحات")}`}>
        {visible.map((option, index) => <div key={option} id={`${listId}-${index}`} role="option" aria-selected={option === currentValue}
          className="royal-select-option" data-active={activeIndex === index || undefined}
          onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <span>{option}</span><span className="royal-select-radio" aria-hidden="true"/>
        </div>)}
      </div>
    </div>, document.body)}
  </span>;
});
