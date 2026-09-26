export function fmtTime(ms: number | null | undefined, withMs = false): string {
  if (ms == null || Number.isNaN(ms)) return "--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base = `${h > 0 ? `${h}:` : ""}${h > 0 ? String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(Math.floor(ms % 1000)).padStart(3, "0")}` : base;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function shortHash(h: string | null | undefined, n = 12): string {
  return h ? `${h.slice(0, n)}…${h.slice(-6)}` : "—";
}

/** Direction of a run of text by its first strong character (Unicode bidi rule P2), for layout only. */
export function textDir(text: string): "rtl" | "ltr" {
  const m = text.match(/[A-Za-z\u00C0-\u024F]|[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/);
  return m && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(m[0]) ? "rtl" : "ltr";
}
