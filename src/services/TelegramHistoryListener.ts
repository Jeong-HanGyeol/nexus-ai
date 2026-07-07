import { randomUUID } from "node:crypto";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { TelegramSendEvent } from "../dispatcher/events.js";
import type { ITelegramHistoryRepository } from "../repository/interfaces/ITelegramHistoryRepository.js";

/**
 * Subscribes to TELEGRAM_SEND and records every outbound message into
 * telegram_history, decoupled from whoever actually sent it
 * (TelegramSummaryListener, TelegramErrorListener, ...). Failures are
 * retried by the dispatcher itself (see EventDispatcher.on).
 */
export class TelegramHistoryListener {
  constructor(
    dispatcher: EventDispatcher,
    private readonly telegramHistoryRepository: ITelegramHistoryRepository,
    private readonly chatId: string,
    private readonly projectId: string | null = null,
  ) {
    dispatcher.on("TELEGRAM_SEND", (event) => this.handle(event));
  }

  private async handle(event: TelegramSendEvent): Promise<void> {
    await this.telegramHistoryRepository.record({
      id: randomUUID(),
      projectId: this.projectId,
      chatId: this.chatId,
      direction: "outbound",
      messageType: event.payload.messageType,
      content: event.payload.text,
      sentAt: event.payload.sentAt,
    });
  }
}
