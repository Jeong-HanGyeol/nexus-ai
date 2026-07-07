export type LogMeta = Record<string, unknown>;

/**
 * Logger abstraction so call sites depend on an interface, not a concrete
 * implementation (console today, file/remote sink later) - keeps the
 * codebase DI-friendly and testable.
 */
export interface ILogger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}
