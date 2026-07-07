import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { eventLogs } from "../../database/schema.js";
import type { EventLog, NewEventLog } from "../../database/schema.js";
import type { IEventLogRepository } from "../interfaces/IEventLogRepository.js";

export class TursoEventLogRepository implements IEventLogRepository {
  constructor(private readonly db: Database) {}

  async record(entry: NewEventLog): Promise<EventLog> {
    const row: NewEventLog = {
      ...entry,
      id: entry.id ?? randomUUID(),
      createdAt: entry.createdAt ?? new Date(),
    };
    await this.db.insert(eventLogs).values(row);
    return row as EventLog;
  }

  async findByProject(projectId: string): Promise<EventLog[]> {
    return this.db
      .select()
      .from(eventLogs)
      .where(eq(eventLogs.projectId, projectId));
  }
}
