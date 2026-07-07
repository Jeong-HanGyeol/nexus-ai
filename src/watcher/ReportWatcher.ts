import { readFile } from "node:fs/promises";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { IEventPublisher } from "../dispatcher/IEventPublisher.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IReportWatcher } from "./IReportWatcher.js";

export interface ReportWatcherOptions {
  reportsDir: string;
}

/**
 * Watches the reports/ directory for new Markdown files and publishes a
 * REPORT_CREATED event once each file is fully written.
 *
 * chokidar v4+ dropped glob patterns from watch paths, so the directory is
 * watched as-is and `.md` files are filtered manually in the handler.
 * `awaitWriteFinish` covers "저장 완료 확인" (wait until file size stops
 * changing) so we never read a report mid-write.
 */
export class ReportWatcher implements IReportWatcher {
  private watcher: FSWatcher | undefined;

  constructor(
    private readonly options: ReportWatcherOptions,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  async start(): Promise<void> {
    if (this.watcher) {
      return;
    }

    this.watcher = watch(this.options.reportsDir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", (filePath: string) => {
      if (path.extname(filePath).toLowerCase() !== ".md") {
        return;
      }
      void this.handleNewReport(filePath);
    });

    this.watcher.on("error", (error: unknown) => {
      this.logger.error("Report watcher error", { error: String(error) });
    });

    await new Promise<void>((resolve) => {
      this.watcher?.on("ready", () => resolve());
    });

    this.logger.info("Report watcher started", {
      dir: this.options.reportsDir,
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
    this.logger.info("Report watcher stopped");
  }

  private async handleNewReport(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, "utf-8");

      this.logger.info("Report detected", { filePath });

      this.eventPublisher.publish({
        type: "REPORT_CREATED",
        payload: {
          filePath,
          fileName: path.basename(filePath),
          content,
          detectedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error("Failed to read report file", {
        filePath,
        error: String(error),
      });
    }
  }
}
