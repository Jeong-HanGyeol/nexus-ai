import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { ProjectIdentifierService } from "./ProjectIdentifierService.js";

/**
 * Manual verification script (npm run agent:test-project-id) covering 3
 * scenarios: signals disagreeing (this project: package.json="sentinel" vs
 * folder="projectButler"), signals agreeing (synthetic fixture), and no
 * signals at all (empty dir -> "Unknown Project").
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const identifier = new ProjectIdentifierService();

  const currentProject = await identifier.identify(process.cwd());
  logger.info("Scenario 1 - this project (signals disagree)", {
    ...currentProject,
  });

  const agreeingParentDir = await mkdtemp(
    path.join(tmpdir(), "sentinel-agree-"),
  );
  const agreeingProjectDir = path.join(agreeingParentDir, "kdhc");
  await mkdir(agreeingProjectDir);
  await writeFile(
    path.join(agreeingProjectDir, "package.json"),
    JSON.stringify({ name: "kdhc" }),
  );
  try {
    const agreeing = await identifier.identify(agreeingProjectDir);
    logger.info("Scenario 2 - package.json + folder name agree", {
      ...agreeing,
    });
  } finally {
    await rm(agreeingParentDir, { recursive: true, force: true });
  }

  const emptyDir = await mkdtemp(path.join(tmpdir(), "sentinel-empty-"));
  try {
    const unknown = await identifier.identify(emptyDir);
    logger.info("Scenario 3 - no signals available", { ...unknown });
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("Project identifier test failed:", error);
  process.exitCode = 1;
});
