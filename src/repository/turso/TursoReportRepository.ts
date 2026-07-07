import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { reports } from "../../database/schema.js";
import type { NewReport, Report } from "../../database/schema.js";
import type { IReportRepository } from "../interfaces/IReportRepository.js";

export class TursoReportRepository implements IReportRepository {
  constructor(private readonly db: Database) {}

  async create(report: NewReport): Promise<Report> {
    const now = new Date();
    const row: NewReport = {
      ...report,
      id: report.id ?? randomUUID(),
      createdAt: report.createdAt ?? now,
    };
    await this.db.insert(reports).values(row);
    return row as Report;
  }

  async findById(id: string): Promise<Report | undefined> {
    const rows = await this.db
      .select()
      .from(reports)
      .where(eq(reports.id, id))
      .limit(1);
    return rows[0];
  }

  async findByProject(projectId: string): Promise<Report[]> {
    return this.db
      .select()
      .from(reports)
      .where(eq(reports.projectId, projectId));
  }

  async updateSummary(id: string, summary: string): Promise<void> {
    await this.db.update(reports).set({ summary }).where(eq(reports.id, id));
  }
}
