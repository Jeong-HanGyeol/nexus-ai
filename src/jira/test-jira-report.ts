import { OpenAiProvider } from "../ai/providers/OpenAiProvider.js";
import { loadEnv } from "../config/env.js";
import { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { TelegramBotService } from "../telegram/TelegramBotService.js";
import { JiraClient } from "./JiraClient.js";
import { JiraDailyReportJob } from "./JiraDailyReportJob.js";

/**
 * Manual verification script (npm run jira:test-report): runs the daily
 * Jira briefing immediately instead of waiting for the 9am schedule.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const env = loadEnv();

  if (
    !env.JIRA_BASE_URL ||
    !env.JIRA_EMAIL ||
    !env.JIRA_API_TOKEN ||
    !env.JIRA_PROJECT_KEY
  ) {
    throw new Error(
      "JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY must all be set in .env",
    );
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env");
  }
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env",
    );
  }

  const jiraClient = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    projectKey: env.JIRA_PROJECT_KEY,
  });
  const aiProvider = new OpenAiProvider({ apiKey: env.OPENAI_API_KEY });
  const telegramService = new TelegramBotService({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  });
  const dispatcher = new EventDispatcher(logger);

  const job = new JiraDailyReportJob(
    jiraClient,
    aiProvider,
    telegramService,
    dispatcher,
    "sentinelAI",
    logger,
  );

  await job.run();
}

main().catch((error: unknown) => {
  console.error("Jira report test failed:", error);
  process.exitCode = 1;
});
