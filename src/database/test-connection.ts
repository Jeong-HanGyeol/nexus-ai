import { sql } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { createDatabaseClient } from "./client.js";

/**
 * Standalone script (npm run db:test) that verifies the Turso connection
 * and confirms the schema tables exist after `npm run db:push`.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const env = loadEnv();
  const { client, db } = createDatabaseClient(env);

  try {
    await db.run(sql`select 1`);
    logger.info("Turso connection OK");

    const tables = await client.execute(
      "select name from sqlite_master where type = 'table' order by name",
    );
    logger.info("Tables found", {
      tables: tables.rows.map((row) => row.name),
    });
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Turso connection test failed:", error);
  process.exitCode = 1;
});
