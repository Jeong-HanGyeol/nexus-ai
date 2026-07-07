import { loadEnv } from "../config/env.js";
import { ConsoleLogger } from "../logger/ConsoleLogger.js";
import { TelegramBotService } from "./TelegramBotService.js";

/**
 * Manual verification script (npm run telegram:test): sends a plain test
 * message directly via TelegramBotService, without going through the
 * event pipeline.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const env = loadEnv();

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env",
    );
  }

  const telegram = new TelegramBotService({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  });

  await telegram.sendMessage("Sentinel Telegram 연동 테스트 메시지입니다.");
  logger.info("Telegram test message sent");
}

main().catch((error: unknown) => {
  console.error("Telegram test failed:", error);
  process.exitCode = 1;
});
