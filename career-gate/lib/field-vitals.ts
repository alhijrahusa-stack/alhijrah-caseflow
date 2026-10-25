/**
 * Field Web Vitals from staff browsers: the only measurement of interaction
 * latency on real phones. A report carries the metric, the page as a route
 * pattern (no record ids), a coarse screen class and nothing that identifies
 * a client or a staff member.
 */

export const FIELD_METRICS = ["INP", "CLS", "LCP"] as const;
export type FieldMetric = (typeof FIELD_METRICS)[number];

export type FieldVital = {
  name: FieldMetric;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  route: string;
  screen: "phone" | "tablet" | "desktop";
  navigation: string;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMBER_SEGMENT = /\/\d+(?=\/|$)/g;
const RATINGS = new Set(["good", "needs-improvement", "poor"]);
const SCREENS = new Set(["phone", "tablet", "desktop"]);

/** /staff/client/<uuid>?tab=x → /staff/client/[id]; the query string is dropped. */
export function routePattern(pathname: string) {
  return pathname.split("?")[0].replace(UUID, "[id]").replace(NUMBER_SEGMENT, "/[n]").slice(0, 120);
}

export function screenClass(width: number): FieldVital["screen"] {
  return width < 768 ? "phone" : width < 1200 ? "tablet" : "desktop";
}

/** Accepts only a well-formed report; anything else is null and not logged. */
export function parseFieldVital(body: unknown): FieldVital | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!FIELD_METRICS.includes(b.name as FieldMetric)) return null;
  if (typeof b.value !== "number" || !Number.isFinite(b.value) || b.value < 0 || b.value > 600_000) return null;
  if (!RATINGS.has(b.rating as string) || !SCREENS.has(b.screen as string)) return null;
  if (typeof b.route !== "string" || !b.route.startsWith("/staff")) return null;
  const navigation = typeof b.navigation === "string" && /^[a-z-]{1,24}$/.test(b.navigation) ? b.navigation : "unknown";
  return {
    name: b.name as FieldMetric,
    value: b.name === "CLS" ? Math.round(b.value * 10_000) / 10_000 : Math.round(b.value),
    rating: b.rating as FieldVital["rating"],
    route: routePattern(b.route),
    screen: b.screen as FieldVital["screen"],
    navigation,
  };
}
