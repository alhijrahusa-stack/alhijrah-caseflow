"use client";

import { useState } from "react";
import { StageBadge } from "@/components/StageBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { allowedTransitions, STAGE_LABELS, type Stage } from "@/lib/workflow/engine";
import { useApi } from "./useApi";

export function WorkflowPanel({ clientId, stage }: { clientId: string; stage: Stage }) {
  const { call, pending, error } = useApi();
  const [note, setNote] = useState("");
  const next = allowedTransitions(stage);

  return (
    <Card title="Workflow">
      <p className="mb-4 text-sm">
        Current stage: <StageBadge stage={stage} />
      </p>
      {next.length ? (
        <>
          <label className="label" htmlFor="wf-note">Note (optional)</label>
          <textarea id="wf-note" className="input mb-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {next.map((to) => (
              <Button
                key={to}
                variant={to === "withdrawn" || to === "rejected" ? "danger" : "primary"}
                disabled={pending}
                onClick={async () => {
                  if (await call("/api/workflow", "POST", { clientId, to, note: note || undefined })) setNote("");
                }}
              >
                {STAGE_LABELS[to]}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">This case is closed.</p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
