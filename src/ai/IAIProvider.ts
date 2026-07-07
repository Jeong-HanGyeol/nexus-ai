export interface AICompletionOptions {
  /** Prepended as context/instructions ahead of the prompt. */
  systemPrompt?: string;
  /** Working directory the AI should operate in (relevant for ClaudeProvider). */
  cwd?: string;
  /** Resume a previous conversation instead of starting fresh (relevant for ClaudeProvider). */
  sessionId?: string;
  /**
   * Claude CLI --permission-mode override (only meaningful for
   * ClaudeProvider; ignored by other providers). Defaults to "acceptEdits"
   * if unset - headless mode has no interactive terminal, so leaving this
   * unset entirely lets Claude fall back to its interactive default, which
   * silently gets stuck waiting for a permission popup that can never appear.
   */
  permissionMode?:
    | "acceptEdits"
    | "auto"
    | "bypassPermissions"
    | "manual"
    | "dontAsk"
    | "plan";
}

export interface AICompletionUsage {
  inputTokens: number;
  outputTokens: number;
  /** Real cost from the provider when available (Claude CLI), otherwise a rough estimate (OpenAI). */
  costUsd?: number;
}

export interface AICompletionResult {
  text: string;
  /** Present when the provider supports resumable sessions (ClaudeProvider). */
  sessionId?: string;
  /** Present when the provider reports token/cost usage - used for DB usage tracking and budget checks. */
  usage?: AICompletionUsage;
}

/**
 * Common contract for every AI backend Sentinel talks to, so business logic
 * (listeners/services) never depends on a concrete provider. OpenAiProvider
 * is Sentinel's "운영/관리 AI" (stateless, one-shot). ClaudeProvider is the
 * "개발 전용 AI" (headless Claude Code CLI, optionally session-resumable).
 */
export interface IAIProvider {
  complete(
    prompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult>;
}
