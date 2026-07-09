import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchProjectFromText } from "../agent/matchProjectFromText.js";
import {
  isSelfModificationRequested,
  stripSelfModificationTrigger,
} from "../agent/selfModificationTrigger.js";
import type { IAIProvider } from "../ai/IAIProvider.js";
import type { Project } from "../database/schema.js";
import type { EventDispatcher } from "../dispatcher/EventDispatcher.js";
import type {
  TelegramCallbackReceivedEvent,
  TelegramCommandReceivedEvent,
} from "../dispatcher/events.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IProjectRepository } from "../repository/interfaces/IProjectRepository.js";
import { ensureProjectTopic } from "../telegram/ensureProjectTopic.js";
import type {
  InlineKeyboardButton,
  ITelegramService,
} from "../telegram/ITelegramService.js";

const AFFIRMATIVE_PATTERN = /^(네|예|응|어|ㅇㅋ|오케이|승인|진행|yes|ok|approve)/i;

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

/**
 * Routes TELEGRAM_COMMAND_RECEIVED:
 * 1. If there's a pending CLI-hook approval request awaiting a yes/no
 *    answer (see tryResolveCliApproval), this message IS that answer -
 *    resolve it instead of routing as a new command.
 * 2. If the message contains the explicit "sentinelAI"/"sentinel" opt-in
 *    keyword (isSelfModificationRequested), target Sentinel/NEXUS's own
 *    project directly - this is the only way a command reaches Sentinel's
 *    own codebase, since the AI's everyday name ("NEXUS"/"넥서스") is used
 *    in normal conversation and must NOT double as a self-targeting trigger.
 * 3. Otherwise, match the command text against the remaining registered
 *    projects (matchProjectFromText, whole-word match). Every project maps
 *    to exactly one Telegram topic, so there's no ambiguity to resolve with
 *    AI here - if nothing matches, reply with the list of managed projects
 *    and stop. No OpenAI call anywhere in this routing step.
 * 4. Run Claude headlessly in the matched project's directory (the "개발
 *    전용 AI") with --permission-mode acceptEdits, resuming its last
 *    session if one is saved (--resume), or starting fresh otherwise.
 *    There is no pre-run risk/approval gate here - project-matched
 *    commands always run immediately. Save the returned sessionId so the
 *    next command continues the same conversation. Claude's raw result is
 *    sent to Telegram as-is - no AI reformatting step, so a topic bound to
 *    a project talks directly to that project's Claude session with no
 *    OpenAI call anywhere in the path.
 *
 * Errors are caught internally (never rethrown) so the dispatcher's retry
 * wrapper never re-runs a dev task that may have already had side effects.
 */
export class ClaudeCommandListener {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly telegramService: ITelegramService,
    private readonly claudeProvider: IAIProvider,
    private readonly projectRepository: IProjectRepository,
    private readonly logger: ILogger,
    /** Sentinel's own project - excluded from routing so a stray "sentinel"-containing message never re-targets Sentinel's own codebase/credentials. */
    private readonly selfProjectId?: string,
  ) {
    dispatcher.on("TELEGRAM_COMMAND_RECEIVED", (event) => this.handle(event));
    dispatcher.on("TELEGRAM_CALLBACK_RECEIVED", (event) =>
      this.handleCallback(event),
    );
  }

  private async handle(event: TelegramCommandReceivedEvent): Promise<void> {
    try {
      if (await this.tryResolveCliApproval(event.payload.text)) {
        return;
      }

      // Sending a message inside a project's own Telegram topic is a more
      // deliberate signal than any text match - it skips keyword/name
      // matching (and the self-modification trigger word) entirely, since
      // navigating to that specific topic already unambiguously says which
      // project this is about.
      let project = event.payload.threadId
        ? await this.projectRepository.findByTelegramThreadId(
            event.payload.threadId,
          )
        : undefined;
      let taskText = event.payload.text;

      if (project) {
        this.logger.info("Routed via Telegram topic", {
          project: project.name,
          threadId: event.payload.threadId,
        });
      } else {
        const allProjects = await this.projectRepository.findAll();
        const selfTargeted =
          this.selfProjectId &&
          isSelfModificationRequested(event.payload.text);

        // The trigger word is just a routing signal, not part of the actual
        // task - strip it so headless Claude sees only the real instruction
        // (see stripSelfModificationTrigger's doc comment).
        taskText = selfTargeted
          ? stripSelfModificationTrigger(event.payload.text)
          : event.payload.text;

        const projects = selfTargeted
          ? allProjects
          : allProjects.filter((p) => p.id !== this.selfProjectId);

        project = selfTargeted
          ? allProjects.find((p) => p.id === this.selfProjectId)
          : matchProjectFromText(taskText, projects);

        if (!project) {
          const projectNames = projects.map((p) => p.name).join(", ") || "(없음)";
          await this.reply(
            `어느 프로젝트인지 알 수 없습니다. 프로젝트 토픽에서 대화하시거나 메시지에 프로젝트 이름을 포함해주세요.\n\n관리 중인 프로젝트: ${projectNames}`,
          );
          return;
        }
      }

      await this.runClaudeTask(project, taskText);
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
   * never falls through to project matching.
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
    await this.finalizeCliApproval(oldest.file, approved, "텔레그램에서 응답");

    return true;
  }

  /** Writes the resolved status to a CLI approval marker file and acks it on Telegram - shared by the text-reply path (tryResolveCliApproval) and the inline-button path (handleCallback). */
  private async finalizeCliApproval(
    filePath: string,
    approved: boolean,
    resolvedBy: string,
  ): Promise<void> {
    const record = JSON.parse(await readFile(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      filePath,
      JSON.stringify({
        ...record,
        status: approved ? "approved" : "denied",
        resolvedAt: new Date().toISOString(),
        resolvedBy,
      }),
    );

    await this.reply(
      `*[CLI 승인]* ${approved ? "허용" : "거부"}했습니다. (도구: ${String(record.tool ?? "?")})`,
    );
  }

  /**
   * Routes an inline-button tap (TELEGRAM_CALLBACK_RECEIVED). Only
   * "cli:<id>:*" callbacks are handled here - they resolve a specific
   * scripts/cli-approval-hook.mjs marker file directly by id, since a
   * button tap carries no free text for tryResolveCliApproval's
   * regex/oldest-file lookup to work with.
   */
  private async handleCallback(
    event: TelegramCallbackReceivedEvent,
  ): Promise<void> {
    try {
      const { data, callbackQueryId } = event.payload;

      if (data.startsWith("cli:")) {
        const [, id, action] = data.split(":");
        const filePath = path.join(CLI_APPROVAL_DIR, `${id}.json`);
        const approved = action === "approve";

        let record: { status?: string };
        try {
          record = JSON.parse(await readFile(filePath, "utf-8"));
        } catch {
          await this.telegramService.answerCallbackQuery(
            callbackQueryId,
            "이미 처리되었거나 만료된 요청입니다",
          );
          return;
        }
        if (record.status !== "pending") {
          await this.telegramService.answerCallbackQuery(
            callbackQueryId,
            "이미 처리된 요청입니다",
          );
          return;
        }

        await this.telegramService.answerCallbackQuery(
          callbackQueryId,
          approved ? "승인했습니다" : "거부했습니다",
        );
        await this.finalizeCliApproval(filePath, approved, "텔레그램 버튼");
        return;
      }

      await this.telegramService.answerCallbackQuery(callbackQueryId);
    } catch (error) {
      this.logger.error("Telegram callback handling failed", {
        error: String(error),
      });
      try {
        await this.reply(
          `명령 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch (replyError) {
        this.logger.error("Failed to send error reply", {
          error: String(replyError),
        });
      }
    }
  }

  private async runClaudeTask(project: Project, text: string): Promise<void> {
    this.logger.info("Routing command to Claude", {
      project: project.name,
      path: project.path,
      resuming: Boolean(project.claudeSessionId),
    });

    const result = await this.claudeProvider.complete(text, {
      cwd: project.path,
      permissionMode: "acceptEdits",
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

    await this.reply(
      `*[${project.name}]*\n\n${result.text}`,
      await this.projectThreadId(project),
    );
  }

  private async reply(
    text: string,
    threadId?: string,
    buttons?: InlineKeyboardButton[][],
  ): Promise<void> {
    await this.telegramService.sendMessage(text, threadId, buttons);
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
}
