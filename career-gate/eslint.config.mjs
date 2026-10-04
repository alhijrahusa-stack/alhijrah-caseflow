import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "public/sw.js", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...next,
  ...ts,
  {
    files: ["components/staff/UniversalIntakePanel.tsx", "components/staff/SmartCareerCollectClient.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@next/next/no-location-assign-relative-destination": "off",
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["lib/smart-client-import.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "varsIgnorePattern": "^jsonArray$" }],
    },
  },
  {
    files: ["lib/smart-client-mobile.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "varsIgnorePattern": "^EvidenceField$" }],
    },
  },
];
export default config;
