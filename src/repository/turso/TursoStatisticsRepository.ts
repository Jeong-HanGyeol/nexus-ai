import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { statistics } from "../../database/schema.js";
import type { NewStatistic, Statistic } from "../../database/schema.js";
import type { IStatisticsRepository } from "../interfaces/IStatisticsRepository.js";

export class TursoStatisticsRepository implements IStatisticsRepository {
  constructor(private readonly db: Database) {}

  async record(statistic: NewStatistic): Promise<Statistic> {
    const row: NewStatistic = {
      ...statistic,
      id: statistic.id ?? randomUUID(),
      recordedAt: statistic.recordedAt ?? new Date(),
    };
    await this.db.insert(statistics).values(row);
    return row as Statistic;
  }

  async findByProject(
    projectId: string,
    metricName?: string,
  ): Promise<Statistic[]> {
    const conditions = metricName
      ? and(
          eq(statistics.projectId, projectId),
          eq(statistics.metricName, metricName),
        )
      : eq(statistics.projectId, projectId);
    return this.db.select().from(statistics).where(conditions);
  }
}
