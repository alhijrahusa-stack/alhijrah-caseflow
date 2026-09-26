import "server-only";
import postgres from "postgres";

declare global {
  // Reused across hot reloads and warm serverless invocations.
  var __cgSql: postgres.Sql | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
  });
}

export function sql() {
  globalThis.__cgSql ??= create();
  return globalThis.__cgSql;
}
