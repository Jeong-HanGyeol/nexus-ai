import { matchProjectFromText } from "../agent/matchProjectFromText.js";
import { isSelfModificationRequested } from "../agent/selfModificationTrigger.js";
import type { IAIProvider } from "../ai/IAIProvider.js";
import {
  buildContinuationCheckPrompt,
  buildRiskClassificationPrompt,
  GENERAL_CHAT_SYSTEM_PROMPT,
  TELEGRAM_RESULT_SYSTEM_PROMPT,
} from "../ai/prompts.js";
import type { Project } from "../database/schema.js";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type { TelegramCommandReceivedEvent } from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IProjectRepository } from "../repository/interfaces/IProjectRepository.js";
import type { ITelegramService } from "../telegram/ITelegramService.js";

/** How long a follow-up message with no project name keeps routing to the last active project. */
const STICKY_PROJECT_WINDOW_MS = 5 * 60 * 1000;
/** How long a pending "이거 진행할까요?" approval request stays open before it's discarded. */
const PENDING_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

const AFFIRMATIVE_PATTERN = /^(네|예|응|어|ㅇㅋ|오케이|승인|진행|yes|ok|approve)/i;

interface PendingApproval {
  project: Project;
  originalText: string;
  reason: string;
  requestedAt: number;
}

/**
 * Routes TELEGRAM_COMMAND_RECEIVED:
 * 1. If there's a pending approval request awaiting a yes/no answer (see
 *    below), this message IS that answer - resolve it instead of routing
 *    as a new command.
 * 2. If the message contains the explicit "sentinelAI"/"sentinel" opt-in
 *    keyword (isSelfModificationRequested), target Sentinel/NEXUS's own
 *    project directly - this is the only way a command reaches Sentinel's
 *    own codebase, since the AI's everyday name ("NEXUS"/"넥서스") is used
 *    in normal conversation and must NOT double as a self-targeting trigger.
 * 3. Otherwise, match the command text against the remaining registered
 *    projects (matchProjectFromText, whole-word match; falling back to the
 *    "sticky" last-active project - see below). If nothing matches, this
 *    isn't a project-specific dev task - answer via the "운영/관리 AI"
 *    (general conversation) instead of refusing or guessing.
 * 4. Before actually running Claude, ask the "운영/관리 AI" whether the
 *    request looks safe or needs human approval (buildRiskClassificationPrompt).
 *    Headless Claude has no interactive terminal for its own permission
 *    prompts to appear in, so this check happens here, before Claude starts.
 *    SAFE -> run immediately (--permission-mode acceptEdits).
 *    NEEDS_APPROVAL -> ask on Telegram and wait (see step 1); once approved,
 *    run with --permission-mode bypassPermissions since a human already
 *    signed off explicitly.
 * 5. Run Claude headlessly in the matched project's directory (the "개발
 *    전용 AI"), resuming its last session if one is saved (--resume), or
 *    starting fresh otherwise. Save the returned sessionId so the next
 *    command continues the same conversation.
 * 6. Format Claude's raw result into a Telegram message via the "운영/관리
 *    AI", per Sentinel's AI role separation.
 *
 * Errors are caught internally (never rethrown) so the dispatcher's retry
 * wrapper never re-runs a dev task that may have already had side effects.
 *
 * A message that names no project keeps routing to whichever project was
 * last active, for STICKY_PROJECT_WINDOW_MS - otherwise a plain follow-up
 * like "그럼 깃허브에 등록하려고" would lose the conversation the moment it
 * stops repeating the project's name. Before actually resuming that
 * project's Claude session, a cheap "관리 AI" classification call checks
 * whether the message really continues that conversation or is an
 * unrelated new topic (buildContinuationCheckPrompt) - otherwise a stray
 * "점심 뭐 먹지" would silently trigger a real Claude run in that project.
 */
export class ClaudeCommandListener {
  private lastActiveProjectId: string | undefined;
  private lastActiveAt: number | undefined;
  private pendingApproval: PendingApproval | undefined;

  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly telegramService: ITelegramService,
    private readonly claudeProvider: IAIProvider,
    private readonly managementAiProvider: IAIProvider,
    private readonly projectRepository: IProjectRepository,
    private readonly logger: ILogger,
    /** Sentinel's own project - excluded from routing so a stray "sentinel"-containing message never re-targets Sentinel's own codebase/credentials. */
    private readonly selfProjectId?: string,
    /** Human-readable Jira report schedule (e.g. "평일 오전 9시(KST)"), so general chat can answer questions about it. Unset if Jira isn't configured. */
    private readonly jiraScheduleDescription?: string,
  ) {
    dispatcher.on("TELEGRAM_COMMAND_RECEIVED", (event) => this.handle(event));
  }

  private async handle(event: TelegramCommandReceivedEvent): Promise<void> {
    try {
      if (this.pendingApproval) {
        await this.resolvePendingApproval(this.pendingApproval, event.payload.text);
        return;
      }

      const allProjects = await this.projectRepository.findAll();
      const selfTargeted =
        this.selfProjectId &&
        isSelfModificationRequested(event.payload.text);

      const projects = selfTargeted
        ? allProjects
        : allProjects.filter((p) => p.id !== this.selfProjectId);

      let project = selfTargeted
        ? allProjects.find((p) => p.id === this.selfProjectId)
        : matchProjectFromText(event.payload.text, projects);

      let continuedFromContext = false;
      if (
        !project &&
        this.lastActiveProjectId &&
        this.lastActiveAt &&
        Date.now() - this.lastActiveAt < STICKY_PROJECT_WINDOW_MS
      ) {
        const stickyCandidate = allProjects.find(
          (p) => p.id === this.lastActiveProjectId,
        );
        if (stickyCandidate) {
          const { text: classification } =
            await this.managementAiProvider.complete(event.payload.text, {
              systemPrompt: buildContinuationCheckPrompt(
                stickyCandidate.name,
              ),
            });
          if (classification.trim().toUpperCase().startsWith("CONTINUE")) {
            project = stickyCandidate;
            continuedFromContext = true;
          }
        }
      }

      if (!project) {
        const contextLines = [
          `관리 중인 프로젝트 목록: ${projects.map((p) => p.name).join(", ") || "(없음)"}`,
        ];
        if (this.jiraScheduleDescription) {
          contextLines.push(
            `Jira 일일 백로그 리포트 전송 시각: ${this.jiraScheduleDescription}`,
          );
        }

        const { text } = await this.managementAiProvider.complete(
          `[NEXUS 시스템 정보]\n${contextLines.join("\n")}\n\n[사용자 메시지]\n${event.payload.text}`,
          { systemPrompt: GENERAL_CHAT_SYSTEM_PROMPT },
        );
        await this.reply(text);
        return;
      }

      this.lastActiveProjectId = project.id;
      this.lastActiveAt = Date.now();

      const { text: riskClassification } =
        await this.managementAiProvider.complete(event.payload.text, {
          systemPrompt: buildRiskClassificationPrompt(project.name),
        });

      if (riskClassification.trim().toUpperCase().startsWith("NEEDS_APPROVAL")) {
        const reason =
          riskClassification.split(":").slice(1).join(":").trim() ||
          "이유가 명시되지 않았습니다";

        this.pendingApproval = {
          project,
          originalText: event.payload.text,
          reason,
          requestedAt: Date.now(),
        };

        this.logger.info("Command needs approval before running", {
          project: project.name,
          reason,
        });

        await this.reply(
          `*[${project.name}]* 승인이 필요합니다\n\n${reason}\n\n진행할까요? ("예"/"아니오"로 답해주세요)`,
        );
        return;
      }

      await this.runClaudeTask(project, event.payload.text, {
        continuedFromContext,
      });
    } catch (error) {
      this.logger.error("Claude command routing failed", {
        error: String(error),
      });
      try {
        await this.reply(
          `명령 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch (replyError) {
        // Never let a failure-to-notify escalate into a dispatcher retry of
        // the whole handler (which could re-run a side-effecting dev task).
        this.logger.error("Failed to send error reply", {
          error: String(replyError),
        });
      }
    }
  }

  private async resolvePendingApproval(
    pending: PendingApproval,
    replyText: string,
  ): Promise<void> {
    this.pendingApproval = undefined;

    const expired = Date.now() - pending.requestedAt > PENDING_APPROVAL_TIMEOUT_MS;
    if (expired) {
      await this.reply(
        `*[${pending.project.name}]* 승인 대기 시간이 지나 요청이 취소되었습니다. 다시 요청해주세요.`,
      );
      return;
    }

    if (!AFFIRMATIVE_PATTERN.test(replyText.trim())) {
      await this.reply(`*[${pending.project.name}]* 취소했습니다.`);
      return;
    }

    this.logger.info("Command approved, running now", {
      project: pending.project.name,
    });

    await this.runClaudeTask(pending.project, pending.originalText, {
      permissionMode: "bypassPermissions",
    });
  }

  private async runClaudeTask(
    project: Project,
    text: string,
    options: {
      continuedFromContext?: boolean;
      permissionMode?: "acceptEdits" | "bypassPermissions";
    },
  ): Promise<void> {
    this.logger.info("Routing command to Claude", {
      project: project.name,
      path: project.path,
      resuming: Boolean(project.claudeSessionId),
      continuedFromContext: Boolean(options.continuedFromContext),
      permissionMode: options.permissionMode ?? "acceptEdits",
    });

    const result = await this.claudeProvider.complete(text, {
      cwd: project.path,
      permissionMode: options.permissionMode ?? "acceptEdits",
      ...(project.claudeSessionId
        ? { sessionId: project.claudeSessionId }
        : {}),
    });

    if (result.sessionId) {
      await this.projectRepository.updateClaudeSessionId(
        project.id,
        result.sessionId,
      );
    }

    const formatted = await this.managementAiProvider.complete(result.text, {
      systemPrompt: TELEGRAM_RESULT_SYSTEM_PROMPT,
    });

    await this.reply(`*[${project.name}]*\n\n${formatted.text}`);
  }

  private async reply(text: string): Promise<void> {
    await this.telegramService.sendMessage(text);
    this.dispatcher.publish({
      type: "TELEGRAM_SEND",
      payload: { messageType: "command_ack", text, sentAt: new Date() },
    });
  }
}
