import type { ITelegramService } from "./ITelegramService.js";

export interface TelegramBotServiceOptions {
  botToken: string;
  chatId: string;
}

/**
 * Thin wrapper over the Telegram Bot API's sendMessage endpoint. Uses
 * Node's built-in fetch - no bot library needed since Sentinel only pushes
 * notifications for now (no inbound command handling yet).
 */
export class TelegramBotService implements ITelegramService {
  constructor(private readonly options: TelegramBotServiceOptions) {}

  async sendMessage(text: string): Promise<void> {
    try {
      await this.send(text, "Markdown");
    } catch (error) {
      // Messages built from arbitrary/dynamic content (error text, AI
      // output) can contain unescaped Markdown special characters that
      // Telegram's legacy parser rejects (400 "can't parse entities").
      // Fall back to plain text once rather than losing the notification.
      if (error instanceof Error && error.message.includes("can't parse entities")) {
        await this.send(text, undefined);
        return;
      }
      throw error;
    }
  }

  private async send(text: string, parseMode: "Markdown" | undefined): Promise<void> {
    const url = `https://api.telegram.org/bot${this.options.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.options.chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Telegram sendMessage failed (${response.status}): ${body}`,
      );
    }
  }
}
