import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { aiResponseCache } from "../../database/schema.js";
import type {
  AiResponseCacheEntry,
  NewAiResponseCacheEntry,
} from "../../database/schema.js";
import type { IAiResponseCacheRepository } from "../interfaces/IAiResponseCacheRepository.js";

export class TursoAiResponseCacheRepository
  implements IAiResponseCacheRepository
{
  constructor(private readonly db: Database) {}

  async findByKey(
    cacheKey: string,
  ): Promise<AiResponseCacheEntry | undefined> {
    const rows = await this.db
      .select()
      .from(aiResponseCache)
      .where(eq(aiResponseCache.cacheKey, cacheKey))
      .limit(1);
    return rows[0];
  }

  async save(
    entry: NewAiResponseCacheEntry,
  ): Promise<AiResponseCacheEntry> {
    const row: NewAiResponseCacheEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      createdAt: entry.createdAt ?? new Date(),
    };
    await this.db.insert(aiResponseCache).values(row);
    return row as AiResponseCacheEntry;
  }
}
