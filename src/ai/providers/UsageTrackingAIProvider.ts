import { randomUUID } from "node:crypto";
import type {
  AICompletionOptions,
  AICompletionResult,
  IAIProvider,
} from "../IAIProvider.js";
import type { IStatisticsRepository } from "../../repository/interfaces/IStatisticsRepository.js";

/**
 * Decorator: records every call's token/cost usage into the `statistics`
 * table (metricName = `ai_usage_${providerName}`), giving Sentinel a
 * queryable history of API call counts and token spend without any
 * provider having to know about the repository layer. Usage is recorded
 * against this Agent's own identified project (not the sub-project a
 * command targets), since spend tracking is per-deployment, not per-task.
 */
export class UsageTrackingAIProvider implements IAIProvider {
  constructor(
    private readonly inner: IAIProvider,
    private readonly statisticsRepository: IStatisticsRepository,
    private readonly projectId: string,
    private readonly providerName: string,
  ) {}

  async complete(
    prompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult> {
    const result = await this.inner.complete(prompt, options);

    if (result.usage) {
      await this.statisticsRepository.record({
        id: randomUUID(),
        projectId: this.projectId,
        metricName: `ai_usage_${this.providerName}`,
        metricValue: JSON.stringify(result.usage),
        recordedAt: new Date(),
      });
    }

    return result;
  }
}
