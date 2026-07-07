import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { tasks } from "../../database/schema.js";
import type { NewTask, Task } from "../../database/schema.js";
import type { ITaskRepository } from "../interfaces/ITaskRepository.js";

export class TursoTaskRepository implements ITaskRepository {
  constructor(private readonly db: Database) {}

  async create(task: NewTask): Promise<Task> {
    const now = new Date();
    const row: NewTask = {
      ...task,
      id: task.id ?? randomUUID(),
      createdAt: task.createdAt ?? now,
      updatedAt: task.updatedAt ?? now,
    };
    await this.db.insert(tasks).values(row);
    return row as Task;
  }

  async findByProject(projectId: string): Promise<Task[]> {
    return this.db.select().from(tasks).where(eq(tasks.projectId, projectId));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }
}
