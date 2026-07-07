import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { EventDispatcher } from "./EventDispatcher.js";

/**
 * Manual verification script (npm run dispatcher:test): a listener that
 * always throws should be retried per RetryOptions, then a SENTINEL_ERROR
 * event should fire once attempts are exhausted.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const dispatcher = new EventDispatcher(logger, {
    maxAttempts: 3,
    delayMs: 100,
    backoffFactor: 1,
  });

  let attempts = 0;
  dispatcher.on("REPORT_CREATED", () => {
    attempts += 1;
    throw new Error(`Simulated failure #${attempts}`);
  });

  dispatcher.on("SENTINEL_ERROR", (event) => {
    logger.info("SENTINEL_ERROR received by listener", event.payload);
  });

  dispatcher.publish({
    type: "REPORT_CREATED",
    payload: {
      filePath: "test.md",
      fileName: "test.md",
      content: "test",
      detectedAt: new Date(),
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));
  logger.info("Test finished", { totalHandlerAttempts: attempts });
}

main().catch((error: unknown) => {
  console.error("Dispatcher test failed:", error);
  process.exitCode = 1;
});
