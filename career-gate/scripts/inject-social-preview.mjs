import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const FILE = resolve(process.cwd(), "public/career-gate.html");

const PAGE_URL =
  "https://alhijrah-caseflow.vercel.app/career-gate.html";

const PREVIEW_IMAGE_URL =
  "https://alhijrah-caseflow.vercel.app/career-gate-social-v3.png";

const TITLE =
  "Career Gate | بوابة التوظيف";

const SITE_NAME =
  "Career Gate | مكتب الهجرة";

const DESCRIPTION =
  "قدّم طلبك للوظيفة الآن وتابع حالة طلبك مباشرة عبر بوابة التوظيف الرسمية — مكتب الهجرة، عبدالله المريسي.";

const IMAGE_ALT =
  "Career Gate — بوابة التوظيف الرسمية — مكتب الهجرة، عبدالله المريسي";

const START =
  "<!-- CAREER_GATE_SOCIAL_PREVIEW_START -->";

const END =
  "<!-- CAREER_GATE_SOCIAL_PREVIEW_END -->";

const html = await readFile(FILE, "utf8");

if (!/<head(?:\s[^>]*)?>/i.test(html)) {
  throw new Error("career-gate.html: missing <head>");
}

if (!/<title>[\s\S]*?<\/title>/i.test(html)) {
  throw new Error("career-gate.html: missing <title>");
}

const metadata = `${START}
<link rel="canonical" href="${PAGE_URL}">

<meta name="description" content="${DESCRIPTION}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${PAGE_URL}">
<meta property="og:image" content="${PREVIEW_IMAGE_URL}">
<meta property="og:image:secure_url" content="${PREVIEW_IMAGE_URL}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1536">
<meta property="og:image:height" content="807">
<meta property="og:image:alt" content="${IMAGE_ALT}">
<meta property="og:locale" content="ar_US">
<meta property="og:locale:alternate" content="en_US">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${PREVIEW_IMAGE_URL}">
<meta name="twitter:image:alt" content="${IMAGE_ALT}">
${END}`;

function injectMetadata(source) {
  const startIndex = source.indexOf(START);
  const endIndex = source.indexOf(END);

  if (startIndex !== -1 || endIndex !== -1) {
    if (
      startIndex === -1 ||
      endIndex === -1 ||
      endIndex < startIndex
    ) {
      throw new Error(
        "career-gate.html: malformed social-preview markers"
      );
    }

    return (
      source.slice(0, startIndex) +
      metadata +
      source.slice(endIndex + END.length)
    );
  }

  return source.replace(
    /<title>[\s\S]*?<\/title>/i,
    (title) => `${title}\n${metadata}`
  );
}

const updated = injectMetadata(html);

const required = [
  `rel="canonical" href="${PAGE_URL}"`,
  `property="og:site_name" content="${SITE_NAME}"`,
  `property="og:title" content="${TITLE}"`,
  `property="og:description" content="${DESCRIPTION}"`,
  `property="og:url" content="${PAGE_URL}"`,
  `property="og:image" content="${PREVIEW_IMAGE_URL}"`,
  `property="og:image:secure_url" content="${PREVIEW_IMAGE_URL}"`,
  `property="og:image:type" content="image/jpeg"`,
  `property="og:image:width" content="1536"`,
  `property="og:image:height" content="807"`,
  `name="twitter:card" content="summary_large_image"`,
  `name="twitter:title" content="${TITLE}"`,
  `name="twitter:description" content="${DESCRIPTION}"`,
  `name="twitter:image" content="${PREVIEW_IMAGE_URL}"`,
];

for (const value of required) {
  if (!updated.includes(value)) {
    throw new Error(
      `career-gate.html: social-preview validation failed: ${value}`
    );
  }
}

if (updated !== html) {
  await writeFile(FILE, updated, "utf8");
}
