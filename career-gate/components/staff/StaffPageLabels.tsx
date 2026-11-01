"use client";

import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

export function StaffInput({ placeholderAr, ariaLabelAr, ...props }: InputHTMLAttributes<HTMLInputElement> & { placeholderAr?: string; ariaLabelAr?: string }) {
  const { language } = useStaffLanguage();
  return <input {...props} placeholder={language === "ar" && placeholderAr ? placeholderAr : props.placeholder}
    aria-label={language === "ar" && ariaLabelAr ? ariaLabelAr : props["aria-label"]}/>;
}

export function StaffNav({ ariaLabelAr, ...props }: HTMLAttributes<HTMLElement> & { ariaLabelAr: string }) {
  const { language } = useStaffLanguage();
  return <nav {...props} aria-label={language === "ar" ? ariaLabelAr : props["aria-label"]}/>;
}

export function StaffEmptyState({ title, titleAr, text, textAr, action }: { title: string; titleAr: string; text: string; textAr: string; action?: ReactNode }) {
  const { t } = useStaffLanguage();
  return <EmptyState title={t(title, titleAr)} text={t(text, textAr)} action={action}/>;
}
