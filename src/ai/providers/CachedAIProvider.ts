import { createHash, randomUUID } from "node:crypto";
import type {
  AICompletionOptions,
  AICompletionResult,
  IAIProvider,
} from "../IAIProvider.js";
import type { IAiResponseCacheRepository } from "../../repository/interfaces/IAiResponseCacheRepository.js";

/**
 * Decorator: skips the real API call when the exact same content was
 * already processed under this `kind` (e.g. the same report re-detected,
 * or - once a git-diff feature exists - the same diff re-analyzed).
 * Cache key is content-only (kind + sha256(prompt)); only wrap providers
 * used for pure, input-determined tasks (report summaries) - never wrap a
 * provider used for stateful/side-effecting work (Claude dev commands),
 * where "the same text" should NOT short-circuit to a stale answer.
 */
export class CachedAIProvider implements IAIProvider {
  constructor(
    private readonly inner: IAIProvider,
    private readonly cacheRepository: IAiResponseCacheRepository,
    private readonly kind: string,
  ) {}

  async complete(
    prompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult> {
    const cacheKey = this.buildCacheKey(prompt);
    const cached = await this.cacheRepository.findByKey(cacheKey);
    if (cached) {
      return { text: cached.responseText };
    }

    const result = await this.inner.complete(prompt, options);

    await this.cacheRepository.save({
      id: randomUUID(),
      cacheKey,
      responseText: result.text,
      createdAt: new Date(),
    });

    return result;
  }

  private buildCacheKey(prompt: string): string {
    const hash = createHash("sha256").update(prompt).digest("hex");
    return `${this.kind}:${hash}`;
  }
}
