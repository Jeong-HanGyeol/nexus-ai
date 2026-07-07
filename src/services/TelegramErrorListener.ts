import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { SentinelErrorEvent } from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";
import type { ITelegramService } from "../telegram/ITelegramService.js";

/**
 * Subscribes to SENTINEL_ERROR (raised by EventDispatcher once a handler's
 * retries are exhausted) and delivers the "오류 알림" notification.
 */
export class TelegramErrorListener {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly telegramService: ITelegramService,
    private readonly logger: ILogger,
    private readonly projectName: string = "Unknown Project",
    private readonly threadId?: string,
  ) {
    dispatcher.on("SENTINEL_ERROR", (event) => this.handle(event));
  }

  private async handle(event: SentinelErrorEvent): Promise<void> {
    const text = `*[${this.projectName}] 오류 발생*\n원인 이벤트: ${event.payload.sourceEventType}\n메시지: ${event.payload.message}`;

    await this.telegramService.sendMessage(text, this.threadId);
    this.logger.info("Telegram error alert sent", {
      sourceEventType: event.payload.sourceEventType,
    });

    this.dispatcher.publish({
      type: "TELEGRAM_SEND",
      payload: {
        messageType: "error",
        text,
        sentAt: new Date(),
      },
    });
  }
}
