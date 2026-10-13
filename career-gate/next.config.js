/** @type {import('next').NextConfig} */
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const connect = ["'self'", supabase && supabase.origin, supabase && `wss://${supabase.host}`].filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  // The approved public Career Gate receipt uses html2canvas from cdnjs.
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src ${connect}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const smartOcrCsp = csp
  .replace("https://cdnjs.cloudflare.com", "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net")
  .replace("frame-ancestors", "worker-src 'self' blob:; frame-ancestors")
  .replace(`connect-src ${connect}`, `connect-src ${connect} https://cdn.jsdelivr.net https://tessdata.projectnaptha.com`);
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["sharp"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
      {
        source: "/staff/smart-client-import/:path*",
        headers: [{ key: "Content-Security-Policy", value: smartOcrCsp }],
      },
    ];
  },
};

module.exports = nextConfig;
