import { randomUUID } from "node:crypto";
import type { Agent } from "../database/schema.js";
import type { ILogger } from "../logger/ILogger.js";
import type { IAgentRepository } from "../repository/interfaces/IAgentRepository.js";

export interface AgentLifecycleOptions {
  name: string;
  platform: string;
  hostname: string;
  version: string;
  heartbeatIntervalMs?: number;
}

/**
 * Registers this PC's Sentinel Agent in the `agents` table (or reuses the
 * existing row for this hostname across restarts) and sends a heartbeat
 * every 30s so other Agents/dashboards can see online status, last contact
 * time, and current state - per the spec's Agent registration/heartbeat
 * design.
 */
export class AgentLifecycle {
  private agent: Agent | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: AgentLifecycleOptions,
    private readonly agentRepository: IAgentRepository,
    private readonly logger: ILogger,
  ) {}

  async start(): Promise<Agent> {
    const existing = await this.agentRepository.findByHostname(
      this.options.hostname,
    );

    if (existing) {
      await this.agentRepository.recordHeartbeat(existing.id, new Date());
      this.agent = existing;
    } else {
      this.agent = await this.agentRepository.register({
        id: randomUUID(),
        name: this.options.name,
        platform: this.options.platform,
        hostname: this.options.hostname,
        version: this.options.version,
        status: "online",
        lastHeartbeat: new Date(),
        createdAt: new Date(),
      });
    }

    const intervalMs = this.options.heartbeatIntervalMs ?? 30_000;
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, intervalMs);
    this.heartbeatTimer.unref();

    this.logger.info("Agent registered", {
      id: this.agent.id,
      hostname: this.options.hostname,
      reused: Boolean(existing),
    });

    return this.agent;
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.agent) {
      await this.agentRepository.updateStatus(this.agent.id, "offline");
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.agent) {
      return;
    }
    try {
      await this.agentRepository.recordHeartbeat(this.agent.id, new Date());
    } catch (error) {
      this.logger.error("Heartbeat failed", { error: String(error) });
    }
  }
}
