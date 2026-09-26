/** @type {import('next').NextConfig} */
const nextConfig = {
  // tesseract.js spawns worker threads and loads language data at runtime;
  // bundling it breaks both.
  serverExternalPackages: ["tesseract.js"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
