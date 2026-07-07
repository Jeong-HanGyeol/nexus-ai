import path from "node:path";
import { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { ReportWatcher } from "./ReportWatcher.js";

/**
 * Manual verification script (npm run watch:test): starts the Report
 * Watcher against reports/ and logs every REPORT_CREATED event it sees.
 * Drop a .md file into reports/ while this is running to confirm it fires.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const dispatcher = new EventDispatcher(logger);

  dispatcher.on("REPORT_CREATED", (event) => {
    logger.info("REPORT_CREATED received", {
      fileName: event.payload.fileName,
      contentPreview: event.payload.content.slice(0, 80),
    });
  });

  const watcher = new ReportWatcher(
    { reportsDir: path.resolve("reports") },
    dispatcher,
    logger,
  );

  await watcher.start();
  logger.info("Watching for reports. Press Ctrl+C to stop.");

  process.on("SIGINT", () => {
    void watcher.stop().then(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  console.error("Report watcher test failed:", error);
  process.exitCode = 1;
});
