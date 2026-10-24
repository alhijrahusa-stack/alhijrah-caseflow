/** Canonical client register destination for a pipeline stage. */
export function pipelineClientHref(status: string): string {
  const view = status === "completed" ? "completed" : "active";
  return `/staff/clients?view=${view}&status=${encodeURIComponent(status)}`;
}
