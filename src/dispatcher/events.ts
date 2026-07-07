/**
 * Shared event contract for the event-driven pipeline:
 * REPORT_CREATED -> GPT_SUMMARY -> DATABASE_SAVE -> TELEGRAM_SEND
 *
 * Each phase adds its own event type here as it's implemented, so listeners
 * stay strongly typed instead of passing around loosely-shaped objects.
 */

export interface ReportCreatedEvent {
  type: "REPORT_CREATED";
  payload: {
    filePath: string;
    fileName: string;
    content: string;
    detectedAt: Date;
  };
}

export interface GptSummaryEvent {
  type: "GPT_SUMMARY";
  payload: {
    filePath: string;
    fileName: string;
    content: string;
    summary: string;
    summarizedAt: Date;
  };
}

export interface DatabaseSaveEvent {
  type: "DATABASE_SAVE";
  payload: {
    reportId: string;
    fileName: string;
    summary: string;
    savedAt: Date;
  };
}

export interface SentinelErrorEvent {
  type: "SENTINEL_ERROR";
  payload: {
    sourceEventType: string;
    message: string;
    occurredAt: Date;
  };
}

export interface TelegramSendEvent {
  type: "TELEGRAM_SEND";
  payload: {
    messageType:
      | "report_summary"
      | "error"
      | "command_ack"
      | "agent_started"
      | "agent_stopped"
      | "jira_daily_report";
    text: string;
    sentAt: Date;
  };
}

export interface TelegramCommandReceivedEvent {
  type: "TELEGRAM_COMMAND_RECEIVED";
  payload: {
    chatId: string;
    text: string;
    messageId: number;
    receivedAt: Date;
    /** Forum topic this message was sent in, if any (see ensureProjectTopic.ts). */
    threadId?: string;
  };
}

export interface AgentStartedEvent {
  type: "AGENT_STARTED";
  payload: {
    agentId: string;
    hostname: string;
    platform: string;
    startedAt: Date;
  };
}

export interface AgentStoppedEvent {
  type: "AGENT_STOPPED";
  payload: {
    agentId: string;
    hostname: string;
    stoppedAt: Date;
  };
}

export type SentinelEvent =
  | ReportCreatedEvent
  | GptSummaryEvent
  | DatabaseSaveEvent
  | SentinelErrorEvent
  | TelegramSendEvent
  | TelegramCommandReceivedEvent
  | AgentStartedEvent
  | AgentStoppedEvent;

export type SentinelEventType = SentinelEvent["type"];
