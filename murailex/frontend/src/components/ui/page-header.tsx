"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function PageHeader({ title, back, actions, description }: { title: ReactNode; back?: string; actions?: ReactNode; description?: ReactNode }) {
  const { t, dir } = useI18n();
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <header className="flex items-start gap-2">
      {back && (
        <Button asChild variant="ghost" size="icon" aria-label={t("back")} className="-ms-2 shrink-0">
          <Link href={back}>
            <Back />
          </Link>
        </Button>
      )}
      <div className="min-w-0 flex-1 pt-1">
        <h1 className="truncate text-xl font-semibold text-fg sm:text-[22px]" dir="auto">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
    </header>
  );
}
