from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def p(rel: str) -> Path:
    return ROOT / rel


def replace_once(rel: str, old: str, new: str) -> None:
    path = p(rel)
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f"expected block missing: {rel}")
    path.write_text(text.replace(old, new, 1))


replace_once(
    "murailex/frontend/src/lib/upload.ts",
    '''    storedRecordingId?: string;
    onProgress?: (fraction: number) => void;
''',
    '''    storedRecordingId?: string;
    languageLocale: "ar-YE" | "ar-EG" | "ar-SY" | "ar-LB" | "ar-IQ";
    onProgress?: (fraction: number) => void;
''',
)
replace_once(
    "murailex/frontend/src/lib/upload.ts",
    '''    json: { filename: opts.name, mime_type: mime, size: blob.size, fingerprint, title: opts.title, source: opts.source },
''',
    '''    json: { filename: opts.name, mime_type: mime, size: blob.size, fingerprint, title: opts.title, source: opts.source, language_hint: opts.languageLocale },
''',
)

replace_once(
    "murailex/frontend/src/app/page.tsx",
    '''type SendFn = (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => Promise<void>;
''',
    '''type ArabicLocale = "ar-YE" | "ar-EG" | "ar-SY" | "ar-LB" | "ar-IQ";
type SendFn = (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => Promise<void>;
''',
)
replace_once(
    "murailex/frontend/src/app/page.tsx",
    '''  const [recording, setRecording] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
''',
    '''  const [recording, setRecording] = useState(false);
  const [languageLocale, setLanguageLocale] = useState<ArabicLocale | "">("");
  const [active, setActive] = useState<Active | null>(null);
''',
)
replace_once(
    "murailex/frontend/src/app/page.tsx",
    '''    async (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => {
      setActive({ name, progress: 0 });
      try {
        const rec = await resumableUpload(blob, {
          name,
          title,
          source,
          storedRecordingId: storedId,
          onProgress: (p) => setActive({ name, progress: p }),
        });
''',
    '''    async (blob: Blob, name: string, title: string, source: "upload" | "recording", storedId?: string) => {
      if (!languageLocale) {
        setActive({ name, progress: 0, error: rtl ? "اختر لهجة التسجيل قبل الرفع." : "Select the recording dialect before upload." });
        return;
      }
      setActive({ name, progress: 0 });
      try {
        const rec = await resumableUpload(blob, {
          name,
          title,
          source,
          storedRecordingId: storedId,
          languageLocale,
          onProgress: (p) => setActive({ name, progress: p }),
        });
''',
)
replace_once(
    "murailex/frontend/src/app/page.tsx",
    '''    [router, t],
''',
    '''    [languageLocale, router, rtl, t],
''',
)
replace_once(
    "murailex/frontend/src/app/page.tsx",
    '''            <div className="mt-10 grid w-full gap-3 sm:grid-cols-2">
''',
    '''            <div className="mt-8 w-full max-w-xl">
              <label className="mb-2 block text-xs font-semibold text-slate-300" htmlFor="language-locale">
                {rtl ? "لهجة التسجيل — إلزامي" : "Recording dialect — required"}
              </label>
              <select
                id="language-locale"
                value={languageLocale}
                onChange={(e) => setLanguageLocale(e.target.value as ArabicLocale)}
                className="h-12 w-full rounded-2xl border border-white/[0.10] bg-slate-950/70 px-4 text-sm text-slate-100 outline-none focus:border-indigo-400/60"
              >
                <option value="" disabled>{rtl ? "اختر اللهجة" : "Select dialect"}</option>
                <option value="ar-YE">العربية اليمنية — ar-YE</option>
                <option value="ar-EG">العربية المصرية — ar-EG</option>
                <option value="ar-SY">العربية السورية — ar-SY</option>
                <option value="ar-LB">العربية اللبنانية — ar-LB</option>
                <option value="ar-IQ">العربية العراقية — ar-IQ</option>
              </select>
            </div>
            <div className="mt-4 grid w-full gap-3 sm:grid-cols-2">
''',
)

print("frontend locale selection applied")
