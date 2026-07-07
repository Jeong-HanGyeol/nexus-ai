import type { IAIProvider } from "../ai/IAIProvider.js";
import { REPORT_SUMMARY_SYSTEM_PROMPT } from "../ai/prompts.js";
import { truncateForAI } from "../ai/truncateForAI.js";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { ReportCreatedEvent } from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";

/**
 * Subscribes to REPORT_CREATED, asks the (management) AI provider for a
 * stateless summary, and publishes GPT_SUMMARY carrying the original report
 * data forward so the next stage (DATABASE_SAVE) has everything it needs
 * without re-reading the file. Failures are retried by the dispatcher
 * itself (see EventDispatcher.on).
 */
export class GptSummaryListener {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly aiProvider: IAIProvider,
    private readonly logger: ILogger,
  ) {
    dispatcher.on("REPORT_CREATED", (event) => this.handle(event));
  }

  private async handle(event: ReportCreatedEvent): Promise<void> {
    const { text: summary } = await this.aiProvider.complete(
      truncateForAI(event.payload.content),
      { systemPrompt: REPORT_SUMMARY_SYSTEM_PROMPT },
    );

    this.logger.info("GPT summary generated", {
      fileName: event.payload.fileName,
    });

    this.dispatcher.publish({
      type: "GPT_SUMMARY",
      payload: {
        filePath: event.payload.filePath,
        fileName: event.payload.fileName,
        content: event.payload.content,
        summary,
        summarizedAt: new Date(),
      },
    });
  }
}
