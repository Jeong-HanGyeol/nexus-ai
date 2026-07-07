import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { AppEnv } from "../config/env.js";
import * as schema from "./schema.js";

export type Database = LibSQLDatabase<typeof schema>;

/**
 * Creates the Turso client + Drizzle database instance.
 * Takes env as a parameter (rather than reading process.env directly) so the
 * connection is constructible/testable without a real process environment.
 */
export function createDatabaseClient(env: AppEnv): {
  client: Client;
  db: Database;
} {
  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });

  const db = drizzle(client, { schema });

  return { client, db };
}
