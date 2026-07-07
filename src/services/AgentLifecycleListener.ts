import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type {
  AgentStartedEvent,
  AgentStoppedEvent,
} from "../dispatcher/events.js";
import type { ITelegramService } from "../telegram/ITelegramService.js";

/**
 * Delivers the "Agent 시작"/"Agent 종료" Telegram notifications. Exposes
 * handleStopped() as a plain method (not just a dispatcher subscription) so
 * the shutdown path can await it directly before process.exit() - a
 * fire-and-forget dispatcher.publish() gives no guarantee the message goes
 * out before the process dies.
 */
export class AgentLifecycleListener {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly telegramService: ITelegramService,
    private readonly projectName: string,
    private readonly threadId?: string,
  ) {
    dispatcher.on("AGENT_STARTED", (event) => this.handleStarted(event));
  }

  async handleStarted(event: AgentStartedEvent): Promise<void> {
    const text = `*[${this.projectName}] Agent 시작*\n호스트: ${event.payload.hostname}\n플랫폼: ${event.payload.platform}`;
    await this.reply(text, "agent_started");
  }

  async handleStopped(event: AgentStoppedEvent): Promise<void> {
    const text = `*[${this.projectName}] Agent 종료*\n호스트: ${event.payload.hostname}`;
    await this.reply(text, "agent_stopped");
  }

  private async reply(
    text: string,
    messageType: "agent_started" | "agent_stopped",
  ): Promise<void> {
    await this.telegramService.sendMessage(text, this.threadId);
    this.dispatcher.publish({
      type: "TELEGRAM_SEND",
      payload: { messageType, text, sentAt: new Date() },
    });
  }
}
