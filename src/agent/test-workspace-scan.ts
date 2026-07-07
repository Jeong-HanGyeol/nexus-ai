import path from "node:path";
import { loadEnv } from "../config/env.js";
import { createDatabaseClient } from "../database/client.js";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { RepositoryContainer } from "../repository/RepositoryContainer.js";
import { ProjectIdentifierService } from "./ProjectIdentifierService.js";
import { upsertProject } from "./resolveProject.js";
import { WorkspaceScanner } from "./WorkspaceScanner.js";

/**
 * Manual verification script (npm run agent:test-workspace-scan): scans the
 * workspace root (parent of this project's cwd, override with argv[2]),
 * prints every discovered project, and upserts them into `projects`.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const workspaceRoot = process.argv[2] ?? path.dirname(process.cwd());

  const scanner = new WorkspaceScanner(new ProjectIdentifierService());
  const discovered = await scanner.scan(workspaceRoot);

  logger.info("Workspace scan complete", {
    workspaceRoot,
    count: discovered.length,
  });
  for (const project of discovered) {
    logger.info("Discovered project", {
      path: project.path,
      name: project.identification.name,
      confidence: project.identification.confidence,
    });
  }

  const env = loadEnv();
  const { db } = createDatabaseClient(env);
  const repositories = new RepositoryContainer(db);

  for (const project of discovered) {
    const { project: row, confidence } = await upsertProject(
      project.identification,
      repositories.projects,
      project.path,
    );
    logger.info("Upserted into projects table", {
      name: row.name,
      slug: row.slug,
      confidence,
    });
  }
}

main().catch((error: unknown) => {
  console.error("Workspace scan test failed:", error);
  process.exitCode = 1;
});
