import type { ILogger, LogMeta } from "./ILogger.js";

export class ConsoleLogger implements ILogger {
  info(message: string, meta?: LogMeta): void {
    this.write("INFO", message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.write("WARN", message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.write("ERROR", message, meta);
  }

  private write(level: string, message: string, meta?: LogMeta): void {
    const timestamp = new Date().toISOString();
    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`[${timestamp}] [${level}] ${message}${suffix}`);
  }
}
