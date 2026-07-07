import type { Database } from "../database/client.js";
import { TursoAgentRepository } from "./turso/TursoAgentRepository.js";
import { TursoAiResponseCacheRepository } from "./turso/TursoAiResponseCacheRepository.js";
import { TursoEventLogRepository } from "./turso/TursoEventLogRepository.js";
import { TursoProjectRepository } from "./turso/TursoProjectRepository.js";
import { TursoReportRepository } from "./turso/TursoReportRepository.js";
import { TursoStatisticsRepository } from "./turso/TursoStatisticsRepository.js";
import { TursoTaskRepository } from "./turso/TursoTaskRepository.js";
import { TursoTelegramHistoryRepository } from "./turso/TursoTelegramHistoryRepository.js";
import { TursoTodoRepository } from "./turso/TursoTodoRepository.js";

/**
 * Single composition point that wires every repository to one Database
 * instance. Services depend on this container (or the individual interfaces)
 * instead of constructing repositories themselves - keeps them swappable
 * for tests or for a future non-Turso backend.
 */
export class RepositoryContainer {
  readonly projects: TursoProjectRepository;
  readonly agents: TursoAgentRepository;
  readonly reports: TursoReportRepository;
  readonly tasks: TursoTaskRepository;
  readonly todos: TursoTodoRepository;
  readonly statistics: TursoStatisticsRepository;
  readonly telegramHistory: TursoTelegramHistoryRepository;
  readonly eventLogs: TursoEventLogRepository;
  readonly aiResponseCache: TursoAiResponseCacheRepository;

  constructor(db: Database) {
    this.projects = new TursoProjectRepository(db);
    this.agents = new TursoAgentRepository(db);
    this.reports = new TursoReportRepository(db);
    this.tasks = new TursoTaskRepository(db);
    this.todos = new TursoTodoRepository(db);
    this.statistics = new TursoStatisticsRepository(db);
    this.telegramHistory = new TursoTelegramHistoryRepository(db);
    this.eventLogs = new TursoEventLogRepository(db);
    this.aiResponseCache = new TursoAiResponseCacheRepository(db);
  }
}
