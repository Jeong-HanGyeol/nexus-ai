import type { NewProject, Project } from "../../database/schema.js";

export interface IProjectRepository {
  create(project: NewProject): Promise<Project>;
  findById(id: string): Promise<Project | undefined>;
  findByPath(path: string): Promise<Project | undefined>;
  findBySlug(slug: string): Promise<Project | undefined>;
  findByTelegramThreadId(threadId: string): Promise<Project | undefined>;
  findAll(): Promise<Project[]>;
  updateStatus(id: string, status: string): Promise<void>;
  updateClaudeSessionId(id: string, sessionId: string): Promise<void>;
  updateTelegramThreadId(id: string, threadId: string): Promise<void>;
}
