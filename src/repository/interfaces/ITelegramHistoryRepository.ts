import type {
  NewTelegramHistoryEntry,
  TelegramHistoryEntry,
} from "../../database/schema.js";

export interface ITelegramHistoryRepository {
  record(entry: NewTelegramHistoryEntry): Promise<TelegramHistoryEntry>;
  findByProject(projectId: string): Promise<TelegramHistoryEntry[]>;
}
