#!/usr/bin/env node
// Claude Code PreToolUse hook: gates a matched tool call (see global
// ~/.claude/settings.json matcher) behind either a local terminal y/n
// answer OR a Telegram reply, whichever arrives first. See
// /Users/hangyeol/.claude/plans/proud-napping-glacier.md for the full design.
//
// Coordination with the nexus-ai "sentinel" agent (src/services/ClaudeCommandListener.ts)
// happens purely through a local marker file under ~/.claude/nexus-cli-approvals/ -
// sentinel already long-polls this same Telegram bot, so this script only ever
// sends messages (never polls Telegram itself, which would conflict with
// sentinel's getUpdates loop).

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  appendFileSync,
  createReadStream,
  createWriteStream,
  openSync,
  closeSync,
} from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

const NEXUS_ENV_PATH = "/Users/hangyeol/Desktop/develop/nexus-ai/.env";
const APPROVAL_DIR = path.join(os.homedir(), ".claude", "nexus-cli-approvals");
const DEBUG_LOG_PATH = path.join(APPROVAL_DIR, "debug.log");
const TIMEOUT_MS = 5 * 60 * 1000;
const NO_TTY_TELEGRAM_WINDOW_MS = 15 * 1000;
const POLL_INTERVAL_MS = 1000;
const AFFIRMATIVE_PATTERN = /^(y|yes|예|네|응|어|ㅇㅋ|오케이|승인|진행)/i;

/** Diagnostics only - this hook's stdout/stderr aren't visible anywhere the
 * user would normally look, so failures (esp. /dev/tty issues) need a file. */
function debugLog(message) {
  try {
    mkdirSync(APPROVAL_DIR, { recursive: true });
    appendFileSync(
      DEBUG_LOG_PATH,
      `[${new Date().toISOString()}] pid=${process.pid} ${message}\n`,
    );
  } catch {
    // best-effort
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function parseEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) {
    return env;
  }
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function truncate(value, max = 300) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function outputDecision(decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function sendTelegramMessage(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch {
    // Best-effort - the local tty prompt still works even if this fails.
  }
}

/** Resolves with the answered line, or undefined if /dev/tty can't be opened (non-interactive). */
function readTtyAnswer(promptText) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    try {
      const ttyIn = createReadStream("/dev/tty");
      const ttyOut = createWriteStream("/dev/tty");
      ttyIn.on("error", (error) => {
        debugLog(`tty read stream error: ${error.message}`);
        settle(undefined);
      });
      ttyOut.on("error", (error) => {
        debugLog(`tty write stream error: ${error.message}`);
        settle(undefined);
      });
      ttyOut.on("open", () => debugLog("tty opened for writing"));
      ttyIn.on("open", () => debugLog("tty opened for reading"));

      const rl = createInterface({ input: ttyIn, output: ttyOut });
      rl.question(promptText, (answer) => {
        debugLog(`tty answered: "${answer}"`);
        rl.close();
        ttyIn.destroy();
        ttyOut.destroy();
        settle(answer);
      });
    } catch (error) {
      debugLog(`tty open threw synchronously: ${String(error)}`);
      settle(undefined);
    }
  });
}

/** Resolves with "approved"/"denied" once ClaudeCommandListener writes a non-pending status. */
function pollApprovalFile(filePath) {
  return new Promise((resolve) => {
    const check = () => {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        if (data.status !== "pending") {
          resolve(data.status);
          return;
        }
      } catch {
        // File may be mid-write from a concurrent process - just retry.
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}

function timeoutSignal(ms) {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

/**
 * Cheap synchronous probe for whether this process has a controlling
 * terminal at all. Hosted/managed Claude Code sessions (no OS tty, ENXIO)
 * must not attempt the local race - if they did, Claude Code's own native
 * approval UI (the one that already surfaces things like GateGuard prompts
 * in-conversation) would never get a chance to run, since this hook would
 * make the allow/deny call unilaterally instead of deferring to it.
 */
function hasControllingTty() {
  try {
    const fd = openSync("/dev/tty", "r");
    closeSync(fd);
    return true;
  } catch (error) {
    debugLog(`no controlling tty: ${String(error)}`);
    return false;
  }
}

async function main() {
  const stdinRaw = await readStdin();

  let input;
  try {
    input = JSON.parse(stdinRaw);
  } catch {
    outputDecision("ask");
    return;
  }

  const toolName = input.tool_name ?? "unknown";
  const toolInput = input.tool_input ?? {};
  const cwd = input.cwd ?? process.cwd();

  debugLog(`invoked: tool=${toolName} cwd=${cwd}`);

  const env = parseEnvFile(NEXUS_ENV_PATH);
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Telegram not configured/reachable - fail open to Claude Code's own
    // permission UI rather than blocking normal CLI usage.
    debugLog("no TELEGRAM_BOT_TOKEN/CHAT_ID found in .env - falling back to ask");
    outputDecision("ask");
    return;
  }

  const humanSummary = `도구: ${toolName}\n경로: ${cwd}\n${truncate(JSON.stringify(toolInput), 300)}`;

  if (!hasControllingTty()) {
    // No OS terminal to race against (e.g. this hosted/managed session).
    // EXPERIMENT: give Telegram a short head start - if it answers within
    // NO_TTY_TELEGRAM_WINDOW_MS, honor that; otherwise fall back to Claude
    // Code's own native approval UI (defer via "ask"). This only works if
    // this harness actually waits out that window rather than bypassing a
    // slow-to-decide hook - that's exactly what this test measures.
    debugLog(`no controlling tty - racing telegram vs ${NO_TTY_TELEGRAM_WINDOW_MS}ms fallback-to-ask window`);

    mkdirSync(APPROVAL_DIR, { recursive: true });
    const id = randomBytes(3).toString("hex");
    const filePath = path.join(APPROVAL_DIR, `${id}.json`);
    const record = {
      id,
      status: "pending",
      tool: toolName,
      cwd,
      inputSummary: truncate(JSON.stringify(toolInput), 300),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(record));

    await sendTelegramMessage(
      token,
      chatId,
      `*[CLI 승인 요청 #${id}]*\n${humanSummary}\n\n"예"/"아니오"로 답해주세요 (${NO_TTY_TELEGRAM_WINDOW_MS / 1000}초 내 - 늦으면 CLI 세션에서 직접 승인하게 됩니다)`,
    );

    const result = await Promise.race([
      pollApprovalFile(filePath).then((status) => ({ source: "telegram", status })),
      timeoutSignal(NO_TTY_TELEGRAM_WINDOW_MS).then(() => ({ source: "fallback" })),
    ]);

    debugLog(`no-tty race settled: source=${result.source}`);

    if (result.source === "fallback") {
      try {
        unlinkSync(filePath);
      } catch {
        // not fatal
      }
      outputDecision("ask");
      return;
    }

    const finalStatus = result.status;
    try {
      writeFileSync(
        filePath,
        JSON.stringify({
          ...record,
          status: finalStatus,
          resolvedAt: new Date().toISOString(),
          resolvedBy: "텔레그램에서 응답",
        }),
      );
      unlinkSync(filePath);
    } catch {
      // not fatal
    }

    await sendTelegramMessage(
      token,
      chatId,
      `*[CLI 승인 #${id}]* ${finalStatus === "approved" ? "허용됨" : "거부됨"} (텔레그램에서 응답)`,
    );

    outputDecision(
      finalStatus === "approved" ? "allow" : "deny",
      `CLI 승인 ${finalStatus === "approved" ? "완료" : "거부"} (텔레그램에서 응답)`,
    );
    return;
  }

  mkdirSync(APPROVAL_DIR, { recursive: true });
  const id = randomBytes(3).toString("hex");
  const filePath = path.join(APPROVAL_DIR, `${id}.json`);
  const inputSummary = truncate(JSON.stringify(toolInput), 300);

  const record = {
    id,
    status: "pending",
    tool: toolName,
    cwd,
    inputSummary,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(filePath, JSON.stringify(record));

  await sendTelegramMessage(
    token,
    chatId,
    `*[CLI 승인 요청 #${id}]*\n${humanSummary}\n\n"예"/"아니오"로 답해주세요 (5분 내, 터미널에서도 답변 가능)`,
  );

  const ttyRace = readTtyAnswer(
    `[CLI 승인 요청 #${id}]\n${humanSummary}\n\n승인하시겠습니까? (y/n, 5분 내 텔레그램으로도 답장 가능)\n> `,
  ).then((answer) =>
    answer === undefined ? new Promise(() => {}) : { source: "tty", answer },
  );
  const telegramRace = pollApprovalFile(filePath).then((status) => ({
    source: "telegram",
    status,
  }));
  const timeoutRace = timeoutSignal(TIMEOUT_MS).then(() => ({
    source: "timeout",
  }));

  debugLog(`request #${id} written, telegram sent, racing tty/telegram/timeout`);

  const result = await Promise.race([ttyRace, telegramRace, timeoutRace]);

  debugLog(`race settled: source=${result.source}`);

  let finalStatus;
  let resolvedBy;
  if (result.source === "tty") {
    finalStatus = AFFIRMATIVE_PATTERN.test(result.answer.trim())
      ? "approved"
      : "denied";
    resolvedBy = "로컬 터미널에서 응답";
  } else if (result.source === "telegram") {
    finalStatus = result.status;
    resolvedBy = "텔레그램에서 응답";
  } else {
    finalStatus = "denied";
    resolvedBy = "5분 시간 초과로 자동 거부";
  }

  try {
    writeFileSync(
      filePath,
      JSON.stringify({
        ...record,
        status: finalStatus,
        resolvedAt: new Date().toISOString(),
        resolvedBy,
      }),
    );
  } catch {
    // Best-effort - the decision below still applies regardless.
  }

  await sendTelegramMessage(
    token,
    chatId,
    `*[CLI 승인 #${id}]* ${finalStatus === "approved" ? "허용됨" : "거부됨"} (${resolvedBy})`,
  );

  try {
    unlinkSync(filePath);
  } catch {
    // Already removed or never fully flushed - not fatal.
  }

  debugLog(`final decision: ${finalStatus} (${resolvedBy}) - exiting normally`);

  outputDecision(
    finalStatus === "approved" ? "allow" : "deny",
    `CLI 승인 ${finalStatus === "approved" ? "완료" : "거부"} (${resolvedBy})`,
  );
}

main()
  .catch((error) => {
    // Any unexpected failure must never block normal Claude Code usage.
    debugLog(`main() threw: ${String(error)} - falling back to ask`);
    outputDecision("ask");
  })
  .finally(() => {
    // Force-terminate - an abandoned tty read or poll loop would otherwise
    // keep this process (and Claude Code's wait on it) alive indefinitely.
    process.exit(0);
  });
