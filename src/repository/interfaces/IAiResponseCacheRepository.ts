import type {
  AiResponseCacheEntry,
  NewAiResponseCacheEntry,
} from "../../database/schema.js";

export interface IAiResponseCacheRepository {
  findByKey(cacheKey: string): Promise<AiResponseCacheEntry | undefined>;
  save(entry: NewAiResponseCacheEntry): Promise<AiResponseCacheEntry>;
}
