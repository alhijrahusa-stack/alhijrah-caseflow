"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "glass-strong fixed inset-x-3 bottom-3 z-50 max-h-[85dvh] overflow-y-auto rounded-[1.75rem] p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2",
          className,
        )}
        {...props}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="rounded-full p-2 transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:hover:bg-white/10" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}