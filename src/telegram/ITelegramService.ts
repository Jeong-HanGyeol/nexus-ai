export interface InlineKeyboardButton {
  text: string;
  callbackData: string;
}

export interface ITelegramService {
  /**
   * threadId, if given, targets a specific forum topic (see ensureProjectTopic.ts).
   * buttons, if given, renders an inline keyboard below the message (rows of buttons);
   * a tap sends a callback_query that TelegramPoller turns into TELEGRAM_CALLBACK_RECEIVED.
   */
  sendMessage(
    text: string,
    threadId?: string,
    buttons?: InlineKeyboardButton[][],
  ): Promise<void>;
  /** Creates a new forum topic in the configured chat, returning its message_thread_id. Throws if the chat isn't a forum-enabled supergroup or the bot lacks "Manage Topics" permission. */
  createForumTopic(name: string): Promise<string>;
  /** Clears the tapped button's loading spinner; text (if given) shows as a brief toast to the tapper. */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}
