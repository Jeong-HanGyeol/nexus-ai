import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { DatabaseSaveEvent } from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";
import type { ITelegramService } from "../telegram/ITelegramService.js";

/**
 * Subscribes to DATABASE_SAVE (after the report is durably persisted) and
 * delivers the "작업 완료" notification to Telegram. Publishes TELEGRAM_SEND
 * afterwards so TelegramHistoryListener and EventLogListener both record it
 * without this class knowing about them.
 */
export class TelegramSummaryListener {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly telegramService: ITelegramService,
    private readonly logger: ILogger,
    private readonly projectName: string = "Unknown Project",
  ) {
    dispatcher.on("DATABASE_SAVE", (event) => this.handle(event));
  }

  private async handle(event: DatabaseSaveEvent): Promise<void> {
    const text = `*[${this.projectName}] 작업 완료: ${event.payload.fileName}*\n\n${event.payload.summary}`;

    await this.telegramService.sendMessage(text);
    this.logger.info("Telegram summary sent", {
      fileName: event.payload.fileName,
      reportId: event.payload.reportId,
    });

    this.dispatcher.publish({
      type: "TELEGRAM_SEND",
      payload: {
        messageType: "report_summary",
        text,
        sentAt: new Date(),
      },
    });
  }
}
