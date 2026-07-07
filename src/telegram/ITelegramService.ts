export interface ITelegramService {
  /** threadId, if given, targets a specific forum topic (see ensureProjectTopic.ts). */
  sendMessage(text: string, threadId?: string): Promise<void>;
  /** Creates a new forum topic in the configured chat, returning its message_thread_id. Throws if the chat isn't a forum-enabled supergroup or the bot lacks "Manage Topics" permission. */
  createForumTopic(name: string): Promise<string>;
}
