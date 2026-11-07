// Verify exactly what the Docker runtime receives, not development node_modules.
async function main() {
  const [{ existsSync }, { join, resolve }] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);
  const root = resolve(process.cwd(), ".next/standalone");
  const server = join(root, "server.js");
  if (!existsSync(server)) {
    throw new Error("STANDALONE_CHECK=FAILED missing " + server);
  }
  for (const name of ["msedge-tts", "groq-sdk"]) {
    const manifest = join(root, "node_modules", name, "package.json");
    if (!existsSync(manifest)) {
      throw new Error("STANDALONE_CHECK=FAILED missing " + manifest);
    }
    console.log("STANDALONE_MODULE=" + name + " VERIFIED");
  }
  console.log("STANDALONE_CHECK=PASSED");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
