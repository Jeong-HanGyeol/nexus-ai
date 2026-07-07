import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchProjectFromText } from "../agent/matchProjectFromText.js";
import {
  isSelfModificationRequested,
  stripSelfModificationTrigger,
} from "../agent/selfModificationTrigger.js";
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
import { ensureProjectTopic } from "../telegram/ensureProjectTopic.js";
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

/** How many past turns (user+NEXUS combined) to keep for the memoryless general-chat path. */
const MAX_GENERAL_CHAT_HISTORY = 6;

/**
 * Marker files written by scripts/cli-approval-hook.mjs (a Claude Code
 * PreToolUse hook - see /Users/hangyeol/.claude/plans/proud-napping-glacier.md).
 * That hook and this long-running listener are separate OS processes that
 * coordinate purely through this directory, since only this listener may
 * long-poll Telegram (the hook only ever sends messages).
 */
const CLI_APPROVAL_DIR = path.join(os.homedir(), ".claude", "nexus-cli-approvals");
/** Slightly longer than the hook's own 5-minute wait, so a crashed hook's leftover file doesn't hijack replies forever. */
const CLI_APPROVAL_STALE_MS = 6 * 60 * 1000;

interface GeneralChatTurn {
  role: "user" | "assistant";
  text: string;
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
  /** OpenAiProvider is stateless per-call, so this is the only memory the general-chat (no-project) path has across messages. */
  private readonly generalChatHistory: GeneralChatTurn[] = [];

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
      if (await this.tryResolveCliApproval(event.payload.text)) {
        return;
      }

      if (this.pendingApproval) {
        await this.resolvePendingApproval(this.pendingApproval, event.payload.text);
        return;
      }

      const allProjects = await this.projectRepository.findAll();
      const selfTargeted =
        this.selfProjectId &&
        isSelfModificationRequested(event.payload.text);

      // The trigger word is just a routing signal, not part of the actual
      // task - strip it so headless Claude sees only the real instruction
      // (see stripSelfModificationTrigger's doc comment).
      const taskText = selfTargeted
        ? stripSelfModificationTrigger(event.payload.text)
        : event.payload.text;

      const projects = selfTargeted
        ? allProjects
        : allProjects.filter((p) => p.id !== this.selfProjectId);

      let project = selfTargeted
        ? allProjects.find((p) => p.id === this.selfProjectId)
        : matchProjectFromText(taskText, projects);

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
            await this.managementAiProvider.complete(taskText, {
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
        // OpenAiProvider is stateless per-call - without this, each general
        // chat reply has zero awareness of what was just asked/answered.
        const historyBlock = this.generalChatHistory.length
          ? `\n\n[최근 대화 기록]\n${this.generalChatHistory
              .map(
                (turn) =>
                  `${turn.role === "user" ? "사용자" : "NEXUS"}: ${turn.text}`,
              )
              .join("\n")}`
          : "";

        const { text: replyText } = await this.managementAiProvider.complete(
          `[NEXUS 시스템 정보]\n${contextLines.join("\n")}${historyBlock}\n\n[사용자 메시지]\n${taskText}`,
          { systemPrompt: GENERAL_CHAT_SYSTEM_PROMPT },
        );

        this.recordGeneralChatTurn("user", taskText);
        this.recordGeneralChatTurn("assistant", replyText);

        await this.reply(replyText);
        return;
      }

      this.lastActiveProjectId = project.id;
      this.lastActiveAt = Date.now();

      const { text: riskClassification } =
        await this.managementAiProvider.complete(taskText, {
          systemPrompt: buildRiskClassificationPrompt(project.name),
        });

      if (riskClassification.trim().toUpperCase().startsWith("NEEDS_APPROVAL")) {
        const reason =
          riskClassification.split(":").slice(1).join(":").trim() ||
          "이유가 명시되지 않았습니다";

        this.pendingApproval = {
          project,
          originalText: taskText,
          reason,
          requestedAt: Date.now(),
        };

        this.logger.info("Command needs approval before running", {
          project: project.name,
          reason,
        });

        await this.reply(
          `*[${project.name}]* 승인이 필요합니다\n\n${reason}\n\n진행할까요? ("예"/"아니오"로 답해주세요)`,
          await this.projectThreadId(project),
        );
        return;
      }

      await this.runClaudeTask(project, taskText, {
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

  /**
   * Checks for a pending CLI-hook approval request (scripts/cli-approval-hook.mjs)
   * before any other routing. If found, this incoming message IS the answer
   * to that request, not a project command - resolve it and stop, so it
   * never falls through to project matching/general chat.
   */
  private async tryResolveCliApproval(replyText: string): Promise<boolean> {
    let entries: string[];
    try {
      entries = await readdir(CLI_APPROVAL_DIR);
    } catch {
      return false;
    }

    const pending: Array<{ file: string; createdAt: number }> = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(CLI_APPROVAL_DIR, entry);
      try {
        const data = JSON.parse(await readFile(filePath, "utf-8")) as {
          status?: string;
          createdAt?: string;
        };
        if (data.status !== "pending" || !data.createdAt) {
          continue;
        }
        const createdAt = Date.parse(data.createdAt);
        if (
          Number.isNaN(createdAt) ||
          Date.now() - createdAt > CLI_APPROVAL_STALE_MS
        ) {
          // Orphaned from a hook process that never got to clean up (e.g.
          // killed mid-flight) - remove it so it can't hijack future replies.
          await rm(filePath, { force: true });
          continue;
        }
        pending.push({ file: filePath, createdAt });
      } catch {
        continue;
      }
    }

    const oldest = pending.sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) {
      return false;
    }

    const approved = AFFIRMATIVE_PATTERN.test(replyText.trim());
    const record = JSON.parse(await readFile(oldest.file, "utf-8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      oldest.file,
      JSON.stringify({
        ...record,
        status: approved ? "approved" : "denied",
        resolvedAt: new Date().toISOString(),
        resolvedBy: "텔레그램에서 응답",
      }),
    );

    await this.reply(
      `*[CLI 승인]* ${approved ? "허용" : "거부"}했습니다. (도구: ${String(record.tool ?? "?")})`,
    );

    return true;
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
        await this.projectThreadId(pending.project),
      );
      return;
    }

    if (!AFFIRMATIVE_PATTERN.test(replyText.trim())) {
      await this.reply(
        `*[${pending.project.name}]* 취소했습니다.`,
        await this.projectThreadId(pending.project),
      );
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

    await this.reply(
      `*[${project.name}]*\n\n${formatted.text}`,
      await this.projectThreadId(project),
    );
  }

  private async reply(text: string, threadId?: string): Promise<void> {
    await this.telegramService.sendMessage(text, threadId);
    this.dispatcher.publish({
      type: "TELEGRAM_SEND",
      payload: { messageType: "command_ack", text, sentAt: new Date() },
    });
  }

  /** Resolves (and lazily creates) this project's Telegram forum topic. */
  private async projectThreadId(project: Project): Promise<string | undefined> {
    return ensureProjectTopic(
      project,
      this.telegramService,
      this.projectRepository,
      this.logger,
    );
  }

  private recordGeneralChatTurn(
    role: GeneralChatTurn["role"],
    text: string,
  ): void {
    this.generalChatHistory.push({ role, text });
    while (this.generalChatHistory.length > MAX_GENERAL_CHAT_HISTORY) {
      this.generalChatHistory.shift();
    }
  }
}
