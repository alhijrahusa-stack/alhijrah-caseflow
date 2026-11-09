"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import { useState } from "react";
import { TaskForm } from "@/components/staff/ClientActions";

export function NewTaskButton() {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="w-full"><TaskForm clientId={null} onDone={() => setOpen(false)} /></div>
  ) : (
    <ActionButton type="button" onClick={() => setOpen(true)} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white">+ Office task</ActionButton>
  );
}
