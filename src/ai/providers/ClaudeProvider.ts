import spawn from "cross-spawn";
import type { ILogger } from "../../logger/ILogger.js";
import type {
  AICompletionOptions,
  AICompletionResult,
  IAIProvider,
} from "../IAIProvider.js";

export interface ClaudeProviderOptions {
  /** Defaults to "claude" (resolved via PATH). */
  executable?: string;
}

interface ClaudeCliResult {
  result: string;
  session_id: string;
  is_error: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Sentinel's "개발 전용 AI": runs the Claude Code CLI in headless mode
 * (`claude -p --output-format json`). Each call spawns a fresh process -
 * a conversation is only continued if the caller passes back the
 * sessionId from a previous AICompletionResult via options.sessionId
 * (--resume), which is how Sentinel "attaches" to an in-progress project.
 */
export class ClaudeProvider implements IAIProvider {
  private readonly executable: string;

  constructor(
    options: ClaudeProviderOptions = {},
    private readonly logger?: ILogger,
  ) {
    this.executable = options.executable ?? "claude";
  }

  async complete(
    prompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult> {
    const effectivePrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const args = [
      "-p",
      effectivePrompt,
      "--output-format",
      "json",
      "--permission-mode",
      options?.permissionMode ?? "acceptEdits",
    ];
    if (options?.sessionId) {
      args.push("--resume", options.sessionId);
    }

    const stdout = await this.run(args, options?.cwd);
    const parsed = this.parseCliOutput(stdout);

    if (!parsed) {
      // Occasionally the CLI's stdout isn't valid JSON (observed with
      // multi-turn tool-using responses) - fall back to the raw text
      // rather than failing the whole command. sessionId/usage are
      // unavailable in this fallback, so the next call starts fresh.
      this.logger?.warn(
        "Claude CLI output was not valid JSON, falling back to raw text",
        { preview: stdout.slice(0, 200) },
      );
      return { text: stdout.trim() };
    }

    if (parsed.is_error) {
      throw new Error(`Claude CLI returned an error: ${parsed.result}`);
    }

    const inputTokens = parsed.usage?.input_tokens;
    const outputTokens = parsed.usage?.output_tokens;
    const usage =
      inputTokens !== undefined && outputTokens !== undefined
        ? {
            inputTokens,
            outputTokens,
            ...(parsed.total_cost_usd !== undefined
              ? { costUsd: parsed.total_cost_usd }
              : {}),
          }
        : undefined;

    return {
      text: parsed.result,
      sessionId: parsed.session_id,
      ...(usage ? { usage } : {}),
    };
  }

  /** Tries a direct parse, then falls back to extracting the outermost {...} substring. */
  private parseCliOutput(stdout: string): ClaudeCliResult | undefined {
    try {
      return JSON.parse(stdout) as ClaudeCliResult;
    } catch {
      const start = stdout.indexOf("{");
      const end = stdout.lastIndexOf("}");
      if (start < 0 || end <= start) {
        return undefined;
      }
      try {
        return JSON.parse(stdout.slice(start, end + 1)) as ClaudeCliResult;
      } catch {
        return undefined;
      }
    }
  }

  private run(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // cross-spawn resolves the Windows .cmd shim and quotes arguments
      // correctly - a plain spawn(..., { shell: true }) mangles prompts
      // containing spaces/punctuation on Windows (cmd.exe re-parses the
      // joined argv string).
      const child = spawn(this.executable, args, { cwd });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`claude exited with code ${code}: ${stderr}`));
        }
      });
    });
  }
}
