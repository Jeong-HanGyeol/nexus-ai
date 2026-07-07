import { randomUUID } from "node:crypto";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { SentinelEvent } from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IEventLogRepository } from "../repository/interfaces/IEventLogRepository.js";

/**
 * Persists every dispatched event into the event_logs table via onAny,
 * giving Sentinel a durable audit trail (report detection, GPT calls,
 * Telegram sends, DB saves, errors) without each stage logging itself.
 */
export class EventLogListener {
  constructor(
    dispatcher: EventDispatcher,
    private readonly eventLogRepository: IEventLogRepository,
    private readonly logger: ILogger,
    private readonly projectId: string | null = null,
  ) {
    dispatcher.onAny((event) => this.handle(event));
  }

  private async handle(event: SentinelEvent): Promise<void> {
    try {
      await this.eventLogRepository.record({
        id: randomUUID(),
        projectId: this.projectId,
        agentId: null,
        eventType: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: new Date(),
      });
    } catch (error) {
      this.logger.error("Failed to persist event log", {
        type: event.type,
        error: String(error),
      });
    }
  }
}
