import type { IEventPublisher } from "../dispatcher/IEventPublisher.js";
import type { ILogger } from "../logger/ILogger.js";
import type { ITelegramPoller } from "./ITelegramPoller.js";

export interface TelegramPollerOptions {
  botToken: string;
  /** Only messages from this chat are processed - 1 Agent = 1 Chat, no /use or /agents selection. */
  chatId: string;
  pollTimeoutSeconds?: number;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

/**
 * Long-polls Telegram's getUpdates endpoint for inbound messages instead of
 * running a webhook server. Any updates already pending at startup are
 * skipped (offset advanced past them without processing), so a restart
 * never replays commands that arrived while Sentinel was offline.
 */
export class TelegramPoller implements ITelegramPoller {
  private running = false;
  private offset: number | undefined;
  private abortController: AbortController | undefined;
  private loopPromise: Promise<void> | undefined;

  constructor(
    private readonly options: TelegramPollerOptions,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    await this.skipPendingBacklog();
    this.loopPromise = this.pollLoop();

    this.logger.info("Telegram poller started", {
      chatId: this.options.chatId,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    await this.loopPromise;
  }

  private async skipPendingBacklog(): Promise<void> {
    const updates = await this.fetchUpdates(0);
    const lastUpdate = updates[updates.length - 1];
    if (lastUpdate) {
      this.offset = lastUpdate.update_id + 1;
      this.logger.info("Skipped pending Telegram backlog", {
        count: updates.length,
      });
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.fetchUpdates(
          this.options.pollTimeoutSeconds ?? 30,
        );

        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.handleUpdate(update);
        }
      } catch (error) {
        if (!this.running) {
          break; // expected abort from stop()
        }
        this.logger.error("Telegram poll failed", { error: String(error) });
        await this.sleep(5000);
      }
    }
  }

  private handleUpdate(update: TelegramUpdate): void {
    const message = update.message;
    if (!message?.text) {
      return;
    }

    if (String(message.chat.id) !== this.options.chatId) {
      this.logger.warn("Ignoring message from unrecognized chat", {
        chatId: message.chat.id,
      });
      return;
    }

    this.eventPublisher.publish({
      type: "TELEGRAM_COMMAND_RECEIVED",
      payload: {
        chatId: String(message.chat.id),
        text: message.text,
        messageId: message.message_id,
        receivedAt: new Date(message.date * 1000),
      },
    });
  }

  private async fetchUpdates(
    timeoutSeconds: number,
  ): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({ timeout: String(timeoutSeconds) });
    if (this.offset !== undefined) {
      params.set("offset", String(this.offset));
    }

    this.abortController = new AbortController();
    const url = `https://api.telegram.org/bot${this.options.botToken}/getUpdates?${params.toString()}`;
    const response = await fetch(url, { signal: this.abortController.signal });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Telegram getUpdates failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as TelegramGetUpdatesResponse;
    return data.result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
