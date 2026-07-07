import type { IAIProvider } from "../ai/IAIProvider.js";
import { JIRA_DAILY_REPORT_SYSTEM_PROMPT } from "../ai/prompts.js";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { ILogger } from "../logger/ILogger.js";
import type { ITelegramService } from "../telegram/ITelegramService.js";
import type { IJiraClient, JiraIssue } from "./IJiraClient.js";

function formatIssue(issue: JiraIssue): string {
  const due = issue.dueDate ? `, 마감: ${issue.dueDate}` : "";
  return `- [${issue.key}] ${issue.summary} (상태: ${issue.status}, 우선순위: ${issue.priority}${due}, 유형: ${issue.issueType})`;
}

/**
 * Daily backlog briefing: pulls the operator's open Jira issues, has the
 * "운영/관리 AI" (OpenAI) turn them into a short prioritized report, and
 * sends it over Telegram. Scheduled by index.ts (weekday mornings) but
 * also runnable on demand (see jira:test-report).
 */
export class JiraDailyReportJob {
  constructor(
    private readonly jiraClient: IJiraClient,
    private readonly aiProvider: IAIProvider,
    private readonly telegramService: ITelegramService,
    private readonly dispatcher: EventDispatcher,
    private readonly projectName: string,
    private readonly logger: ILogger,
    private readonly threadId?: string,
  ) {}

  async run(): Promise<void> {
    try {
      const issues = await this.jiraClient.getMyOpenIssues();
      const listing = issues.length
        ? issues.map(formatIssue).join("\n")
        : "(열려 있는 이슈 없음)";

      const { text: report } = await this.aiProvider.complete(listing, {
        systemPrompt: JIRA_DAILY_REPORT_SYSTEM_PROMPT,
      });

      const text = `*[${this.projectName}] 오늘의 Jira 백로그*\n\n${report}`;
      await this.telegramService.sendMessage(text, this.threadId);
      this.logger.info("Jira daily report sent", {
        issueCount: issues.length,
      });

      this.dispatcher.publish({
        type: "TELEGRAM_SEND",
        payload: {
          messageType: "jira_daily_report",
          text,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error("Jira daily report failed", {
        error: String(error),
      });
      try {
        await this.telegramService.sendMessage(
          `Jira 일일 리포트 생성 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch (replyError) {
        this.logger.error("Failed to send Jira report failure notice", {
          error: String(replyError),
        });
      }
    }
  }
}
