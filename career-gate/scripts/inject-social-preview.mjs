import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "public/career-gate.html");
const html = await readFile(file, "utf8");
const start = "<!-- CAREER_GATE_SOCIAL_PREVIEW_START -->";
const end = "<!-- CAREER_GATE_SOCIAL_PREVIEW_END -->";
const block = `${start}
<link rel="canonical" href="https://alhijrah-caseflow.vercel.app/career-gate.html">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Career Gate — AlHijrah Services LLC">
<meta property="og:title" content="Career Gate — بوابة التوظيف عبر مكتب الهجرة">
<meta property="og:description" content="بوابة التقديم على الوظائف عبر AlHijrah Services LLC">
<meta property="og:url" content="https://alhijrah-caseflow.vercel.app/career-gate.html">
<meta property="og:image" content="https://alhijrah-caseflow.vercel.app/api/social-preview/career-gate">
<meta property="og:image:secure_url" content="https://alhijrah-caseflow.vercel.app/api/social-preview/career-gate">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Career Gate — بوابة التوظيف عبر مكتب الهجرة — AlHijrah Services LLC">
<meta property="og:locale" content="ar_US">
<meta property="og:locale:alternate" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Career Gate — بوابة التوظيف عبر مكتب الهجرة">
<meta name="twitter:description" content="بوابة التقديم على الوظائف عبر AlHijrah Services LLC">
<meta name="twitter:image" content="https://alhijrah-caseflow.vercel.app/api/social-preview/career-gate">
<meta name="twitter:image:alt" content="Career Gate — بوابة التوظيف عبر مكتب الهجرة — AlHijrah Services LLC">
${end}`;

const cleaned = html.includes(start)
  ? html.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block)
  : html.replace(/<title>[\s\S]*?<\/title>/, (title) => `${title}\n${block}`);

if (cleaned === html && !html.includes(start)) {
  throw new Error("Unable to locate <title> in public/career-gate.html");
}

await writeFile(file, cleaned, "utf8");
