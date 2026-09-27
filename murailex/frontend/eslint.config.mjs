import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "public/sw.js", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...next,
  ...ts,
  {
    files: ["src/app/page.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
export default config;
