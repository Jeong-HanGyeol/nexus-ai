import type { Agent, NewAgent } from "../../database/schema.js";

export interface IAgentRepository {
  register(agent: NewAgent): Promise<Agent>;
  findById(id: string): Promise<Agent | undefined>;
  findByHostname(hostname: string): Promise<Agent | undefined>;
  findAll(): Promise<Agent[]>;
  recordHeartbeat(id: string, heartbeatAt: Date): Promise<void>;
  updateStatus(id: string, status: string): Promise<void>;
}
