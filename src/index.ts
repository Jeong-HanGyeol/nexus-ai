import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BudgetLimitedAIProvider } from "./ai/providers/BudgetLimitedAIProvider.js";
import { CachedAIProvider } from "./ai/providers/CachedAIProvider.js";
import { ClaudeProvider } from "./ai/providers/ClaudeProvider.js";
import { OpenAiProvider } from "./ai/providers/OpenAiProvider.js";
import { UsageTrackingAIProvider } from "./ai/providers/UsageTrackingAIProvider.js";
import { AgentLifecycle } from "./agent/AgentLifecycle.js";
import { platformLabel } from "./agent/platformLabel.js";
import { ProjectIdentifierService } from "./agent/ProjectIdentifierService.js";
import { resolveProject } from "./agent/resolveProject.js";
import { loadEnv } from "./config/env.js";
import { createDatabaseClient } from "./database/client.js";
import { EventDispatcher } from "./dispatcher/EventDispatcher.js";
import { ConsoleLogger } from "./logger/ConsoleLogger.js";
import { RepositoryContainer } from "./repository/RepositoryContainer.js";
import { AgentLifecycleListener } from "./services/AgentLifecycleListener.js";
import { ClaudeCommandListener } from "./services/ClaudeCommandListener.js";
import { EventLogListener } from "./services/EventLogListener.js";
import { GptSummaryListener } from "./services/GptSummaryListener.js";
import { ReportSaveListener } from "./services/ReportSaveListener.js";
import { TelegramErrorListener } from "./services/TelegramErrorListener.js";
import { TelegramHistoryListener } from "./services/TelegramHistoryListener.js";
import { TelegramSummaryListener } from "./services/TelegramSummaryListener.js";
import { ensureProjectTopic } from "./telegram/ensureProjectTopic.js";
import { TelegramBotService } from "./telegram/TelegramBotService.js";
import { TelegramPoller } from "./telegram/TelegramPoller.js";
import { ReportWatcher } from "./watcher/ReportWatcher.js";

/**
 * Entry point: validates env, connects to Turso, and wires the current
 * pipeline:
 *   Report Watcher -> REPORT_CREATED -> GptSummaryListener -> GPT_SUMMARY
 *   -> ReportSaveListener -> DATABASE_SAVE -> TelegramSummaryListener
 *   -> TELEGRAM_SEND -> TelegramHistoryListener
 * EventLogListener persists every event regardless of type.
 */
async function main(): Promise<void> {
  const logger = new ConsoleLogger();
  const env = loadEnv();
  const { db } = createDatabaseClient(env);
  const repositories = new RepositoryContainer(db);

  const { project, confidence } = await resolveProject(
    new ProjectIdentifierService(),
    repositories.projects,
    process.cwd(),
  );
  logger.info("Project identified", {
    name: project.name,
    slug: project.slug,
    confidence,
  });

  // OpenAI is optional - only the report-summary pipeline (Report Watcher ->
  // GptSummaryListener) uses it. Without a key that pipeline is simply not
  // wired below; the interactive Telegram <-> Claude command flow never
  // touches OpenAI at all.
  let reportSummaryProvider: CachedAIProvider | undefined;
  if (env.OPENAI_API_KEY) {
    const trackedOpenAiProvider = new UsageTrackingAIProvider(
      new OpenAiProvider({ apiKey: env.OPENAI_API_KEY }),
      repositories.statistics,
      project.id,
      "openai",
    );
    const aiProvider = env.OPENAI_MONTHLY_BUDGET_USD
      ? new BudgetLimitedAIProvider(
          trackedOpenAiProvider,
          repositories.statistics,
          project.id,
          env.OPENAI_MONTHLY_BUDGET_USD,
        )
      : trackedOpenAiProvider;
    // Report summaries are pure/input-determined - safe to cache by content hash.
    reportSummaryProvider = new CachedAIProvider(
      aiProvider,
      repositories.aiResponseCache,
      "report_summary",
    );
  } else {
    logger.info("OPENAI_API_KEY not set, report-summary pipeline disabled");
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env",
    );
  }
  const telegramService = new TelegramBotService({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  });
  // Undefined if the configured chat isn't a Topics-enabled supergroup yet -
  // callers fall back to sending without a thread (see ensureProjectTopic.ts).
  const agentThreadId = await ensureProjectTopic(
    project,
    telegramService,
    repositories.projects,
    logger,
  );

  // Agent registration happens before listener wiring - ReportSaveListener
  // needs a real agentId to satisfy the reports table's NOT NULL FK.
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version: string };
  const hostname = os.hostname();
  const platform = platformLabel(process.platform);
  const agentLifecycle = new AgentLifecycle(
    {
      name: env.AGENT_NAME ?? `${platform} Agent`,
      platform,
      hostname,
      version: packageJson.version,
    },
    repositories.agents,
    logger,
  );
  const agent = await agentLifecycle.start();

  const dispatcher = new EventDispatcher(logger);
  const agentLifecycleListener = new AgentLifecycleListener(
    dispatcher,
    telegramService,
    project.name,
    agentThreadId,
  );
  new EventLogListener(dispatcher, repositories.eventLogs, logger, project.id);
  if (reportSummaryProvider) {
    new GptSummaryListener(dispatcher, reportSummaryProvider, logger);
  }
  new ReportSaveListener(
    dispatcher,
    repositories.reports,
    project.id,
    agent.id,
    logger,
  );
  new TelegramSummaryListener(
    dispatcher,
    telegramService,
    logger,
    project.name,
    agentThreadId,
  );
  new TelegramErrorListener(
    dispatcher,
    telegramService,
    logger,
    project.name,
    agentThreadId,
  );
  new TelegramHistoryListener(
    dispatcher,
    repositories.telegramHistory,
    env.TELEGRAM_CHAT_ID,
    project.id,
  );
  const claudeProvider = new UsageTrackingAIProvider(
    new ClaudeProvider({}, logger),
    repositories.statistics,
    project.id,
    "claude",
  );
  new ClaudeCommandListener(
    dispatcher,
    telegramService,
    claudeProvider,
    repositories.projects,
    logger,
    project.id,
  );

  const reportsDir = path.resolve("reports");
  const watcher = new ReportWatcher({ reportsDir }, dispatcher, logger);
  await watcher.start();

  const poller = new TelegramPoller(
    { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
    dispatcher,
    logger,
  );
  await poller.start();

  dispatcher.publish({
    type: "AGENT_STARTED",
    payload: { agentId: agent.id, hostname, platform, startedAt: new Date() },
  });

  logger.info("Sentinel started", { reportsDir });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    void (async () => {
      await agentLifecycleListener.handleStopped({
        type: "AGENT_STOPPED",
        payload: { agentId: agent.id, hostname, stoppedAt: new Date() },
      });
      await Promise.all([
        watcher.stop(),
        poller.stop(),
        agentLifecycle.stop(),
      ]);
      // brief grace period for fire-and-forget listeners (e.g. history
      // writes) triggered by the AGENT_STOPPED reply above to finish
      await new Promise((resolve) => setTimeout(resolve, 300));
      process.exit(0);
    })();
  };

  // pm2 on Windows doesn't reliably deliver SIGINT the way it does on
  // POSIX - listen for SIGTERM too so "Agent 종료" still fires when pm2
  // stops/restarts the process.
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error("Sentinel failed to start:", error);
  process.exitCode = 1;
});
