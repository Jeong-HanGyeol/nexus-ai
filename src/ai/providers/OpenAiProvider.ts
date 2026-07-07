import OpenAI from "openai";
import type {
  AICompletionOptions,
  AICompletionResult,
  AICompletionUsage,
  IAIProvider,
} from "../IAIProvider.js";

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
}

/**
 * Rough per-1M-token pricing (USD) for cost estimation - OpenAI's API does
 * not return actual dollar cost, only token counts. Update if pricing
 * changes; this only feeds the soft monthly budget check, not billing.
 */
const PRICING_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

/**
 * Sentinel's "운영/관리 AI": stateless OpenAI-backed provider used for report
 * summaries, Telegram message generation, diff explanations, etc. Each call
 * opens a brand new request - no chat history is kept between calls.
 */
export class OpenAiProvider implements IAIProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? "gpt-4o-mini";
  }

  async complete(
    prompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        ...(options?.systemPrompt
          ? [{ role: "system" as const, content: options.systemPrompt }]
          : []),
        { role: "user" as const, content: prompt },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("OpenAI returned an empty completion");
    }

    const usage = this.buildUsage(response.usage);

    return usage ? { text: text.trim(), usage } : { text: text.trim() };
  }

  private buildUsage(
    usage: OpenAI.CompletionUsage | undefined,
  ): AICompletionUsage | undefined {
    if (!usage) {
      return undefined;
    }

    const inputTokens = usage.prompt_tokens;
    const outputTokens = usage.completion_tokens;
    const pricing = PRICING_PER_1M_TOKENS[this.model];
    const costUsd = pricing
      ? (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output
      : undefined;

    return costUsd === undefined
      ? { inputTokens, outputTokens }
      : { inputTokens, outputTokens, costUsd };
  }
}
