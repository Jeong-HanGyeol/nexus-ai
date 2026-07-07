import type { EventLog, NewEventLog } from "../../database/schema.js";

export interface IEventLogRepository {
  record(entry: NewEventLog): Promise<EventLog>;
  findByProject(projectId: string): Promise<EventLog[]>;
}
