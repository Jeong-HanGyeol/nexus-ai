import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { projects } from "../../database/schema.js";
import type { NewProject, Project } from "../../database/schema.js";
import type { IProjectRepository } from "../interfaces/IProjectRepository.js";

export class TursoProjectRepository implements IProjectRepository {
  constructor(private readonly db: Database) {}

  async create(project: NewProject): Promise<Project> {
    const now = new Date();
    const row: NewProject = {
      ...project,
      id: project.id ?? randomUUID(),
      createdAt: project.createdAt ?? now,
      updatedAt: project.updatedAt ?? now,
    };
    await this.db.insert(projects).values(row);
    return row as Project;
  }

  async findById(id: string): Promise<Project | undefined> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return rows[0];
  }

  async findByPath(path: string): Promise<Project | undefined> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.path, path))
      .limit(1);
    return rows[0];
  }

  async findBySlug(slug: string): Promise<Project | undefined> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    return rows[0];
  }

  async findByTelegramThreadId(threadId: string): Promise<Project | undefined> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.telegramThreadId, threadId))
      .limit(1);
    return rows[0];
  }

  async findAll(): Promise<Project[]> {
    return this.db.select().from(projects);
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ status, updatedAt: new Date() })
      .where(eq(projects.id, id));
  }

  async updateClaudeSessionId(id: string, sessionId: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ claudeSessionId: sessionId, updatedAt: new Date() })
      .where(eq(projects.id, id));
  }

  async updateTelegramThreadId(id: string, threadId: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ telegramThreadId: threadId, updatedAt: new Date() })
      .where(eq(projects.id, id));
  }
}
