import type { NewStatistic, Statistic } from "../../database/schema.js";

export interface IStatisticsRepository {
  record(statistic: NewStatistic): Promise<Statistic>;
  findByProject(projectId: string, metricName?: string): Promise<Statistic[]>;
}
