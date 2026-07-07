import { randomUUID } from "node:crypto";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { GptSummaryEvent } from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IReportRepository } from "../repository/interfaces/IReportRepository.js";

/**
 * Subscribes to GPT_SUMMARY and persists the report (raw content + summary)
 * into the `reports` table, linked to this Agent's own project and agent
 * row. Publishes DATABASE_SAVE afterwards, matching the spec's pipeline
 * order (REPORT_CREATED -> GPT_SUMMARY -> DATABASE_SAVE -> TELEGRAM_SEND) -
 * Telegram delivery happens only once the report is durably saved.
 */
export class ReportSaveListener {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly reportRepository: IReportRepository,
    private readonly projectId: string,
    private readonly agentId: string,
    private readonly logger: ILogger,
  ) {
    dispatcher.on("GPT_SUMMARY", (event) => this.handle(event));
  }

  private async handle(event: GptSummaryEvent): Promise<void> {
    const report = await this.reportRepository.create({
      id: randomUUID(),
      projectId: this.projectId,
      agentId: this.agentId,
      filePath: event.payload.filePath,
      rawContent: event.payload.content,
      summary: event.payload.summary,
      createdAt: new Date(),
    });

    this.logger.info("Report saved to database", {
      reportId: report.id,
      fileName: event.payload.fileName,
    });

    this.dispatcher.publish({
      type: "DATABASE_SAVE",
      payload: {
        reportId: report.id,
        fileName: event.payload.fileName,
        summary: event.payload.summary,
        savedAt: new Date(),
      },
    });
  }
}
