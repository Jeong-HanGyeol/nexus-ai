import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Sentinel Database Schema (Drizzle ORM / Turso)
 *
 * Sentinel is stateless on the GPT side - all long-term project memory
 * (reports, tasks, statistics, todos, telegram history, agent/project state)
 * lives here so it can be shared across every Sentinel Agent / PC.
 */

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(), // display/lookup name - not unique, two paths can share a name
  path: text("path").notNull().unique(), // filesystem location - the true identity of a project instance
  status: text("status").notNull().default("active"), // active | archived
  // last headless Claude session for this project - present -> --resume, absent -> fresh session
  claudeSessionId: text("claude_session_id"),
  // Telegram forum topic (message_thread_id) this project's messages go to -
  // absent until the first message is sent (see ensureProjectTopic.ts).
  telegramThreadId: text("telegram_thread_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull(), // windows | macos | linux
  hostname: text("hostname").notNull(),
  version: text("version").notNull(),
  status: text("status").notNull().default("offline"), // online | offline
  lastHeartbeat: integer("last_heartbeat", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  filePath: text("file_path").notNull(),
  rawContent: text("raw_content").notNull(),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  reportId: text("report_id").references(() => reports.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | done
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  content: text("content").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const statistics = sqliteTable("statistics", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  metricName: text("metric_name").notNull(),
  metricValue: text("metric_value").notNull(),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
});

export const telegramHistory = sqliteTable("telegram_history", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  chatId: text("chat_id").notNull(),
  direction: text("direction").notNull(), // inbound | outbound
  messageType: text("message_type").notNull(), // report_summary | error | command | ...
  content: text("content").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
});

export const eventLogs = sqliteTable("event_logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  agentId: text("agent_id").references(() => agents.id),
  // agent_start | agent_stop | heartbeat | report_detected | gpt_call | telegram_sent | db_saved | error
  eventType: text("event_type").notNull(),
  payload: text("payload"), // JSON-encoded details
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const aiResponseCache = sqliteTable("ai_response_cache", {
  id: text("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(), // `${kind}:${sha256(content)}`
  responseText: text("response_text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;

export type Statistic = typeof statistics.$inferSelect;
export type NewStatistic = typeof statistics.$inferInsert;

export type TelegramHistoryEntry = typeof telegramHistory.$inferSelect;
export type NewTelegramHistoryEntry = typeof telegramHistory.$inferInsert;

export type EventLog = typeof eventLogs.$inferSelect;
export type NewEventLog = typeof eventLogs.$inferInsert;

export type AiResponseCacheEntry = typeof aiResponseCache.$inferSelect;
export type NewAiResponseCacheEntry = typeof aiResponseCache.$inferInsert;
