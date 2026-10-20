"use client";

import { useReportWebVitals } from "next/web-vitals";
import { FIELD_METRICS, screenClass, type FieldMetric } from "@/lib/field-vitals";

/** Sends INP, CLS and LCP from staff pages to the server log, where real-device figures are read. */
export function FieldVitals() {
  useReportWebVitals((metric) => {
    if (!FIELD_METRICS.includes(metric.name as FieldMetric)) return;
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      route: window.location.pathname,
      screen: screenClass(window.innerWidth),
      navigation: metric.navigationType,
    });
    const sent = navigator.sendBeacon?.("/api/staff/vitals", new Blob([body], { type: "application/json" }));
    if (!sent) void fetch("/api/staff/vitals", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  });
  return null;
}
