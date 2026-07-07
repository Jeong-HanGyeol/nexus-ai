import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { agents } from "../../database/schema.js";
import type { Agent, NewAgent } from "../../database/schema.js";
import type { IAgentRepository } from "../interfaces/IAgentRepository.js";

export class TursoAgentRepository implements IAgentRepository {
  constructor(private readonly db: Database) {}

  async register(agent: NewAgent): Promise<Agent> {
    const now = new Date();
    const row: NewAgent = {
      ...agent,
      id: agent.id ?? randomUUID(),
      createdAt: agent.createdAt ?? now,
    };
    await this.db.insert(agents).values(row);
    return row as Agent;
  }

  async findById(id: string): Promise<Agent | undefined> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);
    return rows[0];
  }

  async findByHostname(hostname: string): Promise<Agent | undefined> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.hostname, hostname))
      .limit(1);
    return rows[0];
  }

  async findAll(): Promise<Agent[]> {
    return this.db.select().from(agents);
  }

  async recordHeartbeat(id: string, heartbeatAt: Date): Promise<void> {
    await this.db
      .update(agents)
      .set({ lastHeartbeat: heartbeatAt, status: "online" })
      .where(eq(agents.id, id));
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.db.update(agents).set({ status }).where(eq(agents.id, id));
  }
}
