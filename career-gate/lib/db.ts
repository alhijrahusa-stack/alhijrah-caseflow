import "server-only";
import postgres from "postgres";

declare global {
  // Reused across hot reloads and warm serverless invocations.
  var __cgSql: postgres.Sql | undefined;
}

export class DatabaseConfigurationError extends Error {
  readonly code = "DATABASE_CONFIGURATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

function supabaseProjectRef(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function databaseProjectRef(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    if (direct?.[1]) return direct[1];
    const user = decodeURIComponent(u.username);
    const pooler = user.match(/^postgres\.([a-z0-9]+)$/i);
    return pooler?.[1]?.toLowerCase() ?? null;
  } catch {
    throw new DatabaseConfigurationError("DATABASE_URL is not a valid PostgreSQL URL");
  }
}

function validateDatabaseTarget(url: string) {
  const expected = supabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const actual = databaseProjectRef(url);
  if (expected && actual && expected !== actual) {
    throw new DatabaseConfigurationError(
      `DATABASE_URL points to Supabase project ${actual}; Career Gate is configured for ${expected}`,
    );
  }
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseConfigurationError("DATABASE_URL is not set");
  validateDatabaseTarget(url);
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

export function databaseConfigMessage(error: unknown): string | null {
  return error instanceof DatabaseConfigurationError ? error.message : null;
}
