import type {
  AICompletionOptions,
  AICompletionResult,
  IAIProvider,
} from "../IAIProvider.js";
import type { IStatisticsRepository } from "../../repository/interfaces/IStatisticsRepository.js";

/**
 * Decorator: refuses to call the inner (OpenAI) provider once this
 * calendar month's tracked spend reaches the configured budget. Throws
 * rather than silently degrading, so the existing EventDispatcher retry ->
 * SENTINEL_ERROR -> Telegram alert path (already built) surfaces it to the
 * admin without any new alerting mechanism.
 *
 * Must wrap a provider that UsageTrackingAIProvider also wraps (or has
 * already wrapped) the same metricName, since it reads cost back out of
 * the same `statistics` rows that decorator writes.
 */
export class BudgetLimitedAIProvider implements IAIProvider {
  constructor(
    private readonly inner: IAIProvider,
    private readonly statisticsRepository: IStatisticsRepository,
    private readonly projectId: string,
    private readonly monthlyBudgetUsd: number,
    private readonly metricName = "ai_usage_openai",
  ) {}

  async complete(
    prompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult> {
    const spent = await this.getMonthToDateSpendUsd();
    if (spent >= this.monthlyBudgetUsd) {
      throw new Error(
        `월간 OpenAI 예산 초과: $${spent.toFixed(4)} / $${this.monthlyBudgetUsd} - 이번 달 요약 기능이 제한됩니다.`,
      );
    }

    return this.inner.complete(prompt, options);
  }

  private async getMonthToDateSpendUsd(): Promise<number> {
    const rows = await this.statisticsRepository.findByProject(
      this.projectId,
      this.metricName,
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let total = 0;
    for (const row of rows) {
      if (row.recordedAt < monthStart) {
        continue;
      }
      try {
        const usage = JSON.parse(row.metricValue) as { costUsd?: number };
        total += usage.costUsd ?? 0;
      } catch {
        // malformed row, skip
      }
    }

    return total;
  }
}
