import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "public/career-gate.html");
const html = await readFile(file, "utf8");
const start = "<!-- CAREER_GATE_SOCIAL_PREVIEW_START -->";
const end = "<!-- CAREER_GATE_SOCIAL_PREVIEW_END -->";
const previewImage = "https://alhijrah-caseflow.vercel.app/api/social-preview/career-gate?v=20261002";
const block = `${start}
<link rel="canonical" href="https://alhijrah-caseflow.vercel.app/">
<meta name="description" content="قدّم طلبك وتابع حالته عبر بوابة Career Gate الرسمية — AlHijrah Services LLC">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Career Gate | AlHijrah Services LLC">
<meta property="og:title" content="Career Gate | بوابة التوظيف">
<meta property="og:description" content="التقديم ومتابعة الطلبات عبر بوابة Career Gate الرسمية — AlHijrah Services LLC">
<meta property="og:url" content="https://alhijrah-caseflow.vercel.app/">
<meta property="og:image" content="${previewImage}">
<meta property="og:image:secure_url" content="${previewImage}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Career Gate — Official Employment Portal">
<meta property="og:locale" content="ar_US">
<meta property="og:locale:alternate" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Career Gate | بوابة التوظيف">
<meta name="twitter:description" content="التقديم ومتابعة الطلبات عبر بوابة Career Gate الرسمية — AlHijrah Services LLC">
<meta name="twitter:image" content="${previewImage}">
<meta name="twitter:image:alt" content="Career Gate — Official Employment Portal">
<style id="career-gate-brand-cleanup">
.office-brand-logo{display:none!important}
.office-lockup{justify-content:flex-start}
@media(max-width:560px){.office-lockup{justify-content:center}}
</style>
${end}`;

let cleaned = html.includes(start)
  ? html.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block)
  : html.replace(/<title>[\s\S]*?<\/title>/, (title) => `${title}\n${block}`);

// The office name already identifies the operator. Remove the redundant image that can
// render as a broken mark on customer devices; keep the Career Gate portal identity.
cleaned = cleaned.replace(/\s*<img\s+class="office-brand-logo"[^>]*>\s*/i, "\n    ");

if (!cleaned.includes(start)) {
  throw new Error("Unable to inject Career Gate social metadata");
}

await writeFile(file, cleaned, "utf8");
