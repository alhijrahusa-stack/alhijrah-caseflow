// Verify the exact files copied into the runtime image, not development node_modules.
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(process.cwd(), ".next/standalone");
const server = join(root, "server.js");
if (!existsSync(server)) {
  console.error("STANDALONE_CHECK=FAILED missing server.js at " + server);
  process.exit(1);
}
for (const name of ["msedge-tts", "groq-sdk"]) {
  const packageJson = join(root, "node_modules", name, "package.json");
  if (!existsSync(packageJson)) {
    console.error("STANDALONE_CHECK=FAILED missing " + packageJson);
    process.exit(1);
  }
  console.log("STANDALONE_MODULE=" + name + " VERIFIED");
}
console.log("STANDALONE_CHECK=PASSED");
