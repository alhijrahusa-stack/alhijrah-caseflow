// Declarative description of the conditional intake questions. The UI renders
// from this; the server re-validates with Zod (lib/schemas.ts) and drops
// answers whose visibility condition is not met.
export type FieldSpec = {
  field_id: string;
  type: "yes_no" | "date" | "email";
  label: string;
  required: boolean;
  visible_if?: { field_id: string; equals: string };
  server_validation: string;
};

export const AMAZON_HISTORY: FieldSpec[] = [
  { field_id: "amazon_worked_before", type: "yes_no", label: "Have you worked at Amazon before?", required: true, server_validation: "boolean|null" },
  { field_id: "amazon_worked_from", type: "date", label: "From", required: false, visible_if: { field_id: "amazon_worked_before", equals: "yes" }, server_validation: "date; cleared unless worked_before" },
  { field_id: "amazon_worked_to", type: "date", label: "To", required: false, visible_if: { field_id: "amazon_worked_before", equals: "yes" }, server_validation: "date >= from; cleared unless worked_before" },
  { field_id: "amazon_applied_before", type: "yes_no", label: "Have you submitted an Amazon job application before?", required: true, server_validation: "boolean|null" },
  { field_id: "amazon_application_email", type: "email", label: "Amazon email used (never your password)", required: false, visible_if: { field_id: "amazon_applied_before", equals: "yes" }, server_validation: "email; cleared unless applied_before" },
  { field_id: "currently_amazon", type: "yes_no", label: "Do you currently work at Amazon?", required: false, server_validation: "boolean|null" },
  { field_id: "via_agency", type: "yes_no", label: "Do you currently work through a third-party staffing agency?", required: false, server_validation: "boolean|null" },
];

export function isVisible(spec: FieldSpec, values: Record<string, string>) {
  return !spec.visible_if || values[spec.visible_if.field_id] === spec.visible_if.equals;
}
