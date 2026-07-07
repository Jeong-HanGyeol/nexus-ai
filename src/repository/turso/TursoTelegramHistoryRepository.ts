import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { telegramHistory } from "../../database/schema.js";
import type {
  NewTelegramHistoryEntry,
  TelegramHistoryEntry,
} from "../../database/schema.js";
import type { ITelegramHistoryRepository } from "../interfaces/ITelegramHistoryRepository.js";

export class TursoTelegramHistoryRepository
  implements ITelegramHistoryRepository
{
  constructor(private readonly db: Database) {}

  async record(
    entry: NewTelegramHistoryEntry,
  ): Promise<TelegramHistoryEntry> {
    const row: NewTelegramHistoryEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      sentAt: entry.sentAt ?? new Date(),
    };
    await this.db.insert(telegramHistory).values(row);
    return row as TelegramHistoryEntry;
  }

  async findByProject(projectId: string): Promise<TelegramHistoryEntry[]> {
    return this.db
      .select()
      .from(telegramHistory)
      .where(eq(telegramHistory.projectId, projectId));
  }
}
