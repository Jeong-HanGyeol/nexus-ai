import type { Project } from "../database/schema.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IProjectRepository } from "../repository/interfaces/IProjectRepository.js";
import type { ITelegramService } from "./ITelegramService.js";

/**
 * Returns this project's Telegram forum topic id, creating it on first use.
 * Requires the configured chat to already be a Topics-enabled supergroup
 * with the bot promoted to admin ("Manage Topics") - if that hasn't been
 * set up yet (or the chat is still a plain 1:1/DM chat), createForumTopic
 * throws and this just logs a warning and returns undefined, so callers
 * fall back to sending without a thread (today's flat behavior) instead of
 * failing the whole notification.
 */
export async function ensureProjectTopic(
  project: Project,
  telegramService: ITelegramService,
  projectRepository: IProjectRepository,
  logger: ILogger,
): Promise<string | undefined> {
  if (project.telegramThreadId) {
    return project.telegramThreadId;
  }

  try {
    const threadId = await telegramService.createForumTopic(project.name);
    await projectRepository.updateTelegramThreadId(project.id, threadId);
    project.telegramThreadId = threadId;
    logger.info("Telegram forum topic created", {
      project: project.name,
      threadId,
    });
    return threadId;
  } catch (error) {
    logger.warn("Could not create Telegram forum topic - sending without a thread", {
      project: project.name,
      error: String(error),
    });
    return undefined;
  }
}
