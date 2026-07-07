import "dotenv/config";

/**
 * Centralized environment configuration.
 *
 * Only variables required by the current phase (Turso/Drizzle connection)
 * are validated eagerly. Variables owned by future modules (OpenAI, Telegram)
 * stay optional here - each module validates what it needs when it is built.
 */

export interface AppEnv {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  OPENAI_API_KEY: string | undefined;
  TELEGRAM_BOT_TOKEN: string | undefined;
  TELEGRAM_CHAT_ID: string | undefined;
  /** Soft monthly cap on OpenAI spend (USD). Unset = no limit. */
  OPENAI_MONTHLY_BUDGET_USD: number | undefined;
  /** Human-readable label for this PC's Agent (e.g. "Windows Desktop"). Unset = derived from platform. */
  AGENT_NAME: string | undefined;
  /** Jira daily backlog report - all four required together, feature is skipped if unset. */
  JIRA_BASE_URL: string | undefined;
  JIRA_EMAIL: string | undefined;
  JIRA_API_TOKEN: string | undefined;
  JIRA_PROJECT_KEY: string | undefined;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Check your .env file (see .env.example).`,
    );
  }
  return value;
}

export function loadEnv(): AppEnv {
  const budgetRaw = process.env.OPENAI_MONTHLY_BUDGET_USD;
  const budget = budgetRaw ? Number(budgetRaw) : undefined;
  if (budgetRaw && Number.isNaN(budget)) {
    throw new Error(
      `OPENAI_MONTHLY_BUDGET_USD must be a number, got: "${budgetRaw}"`,
    );
  }

  return {
    TURSO_DATABASE_URL: requireEnv("TURSO_DATABASE_URL"),
    TURSO_AUTH_TOKEN: requireEnv("TURSO_AUTH_TOKEN"),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    OPENAI_MONTHLY_BUDGET_USD: budget,
    AGENT_NAME: process.env.AGENT_NAME,
    JIRA_BASE_URL: process.env.JIRA_BASE_URL,
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY,
  };
}
