import type { NewReport, Report } from "../../database/schema.js";

export interface IReportRepository {
  create(report: NewReport): Promise<Report>;
  findById(id: string): Promise<Report | undefined>;
  findByProject(projectId: string): Promise<Report[]>;
  updateSummary(id: string, summary: string): Promise<void>;
}
