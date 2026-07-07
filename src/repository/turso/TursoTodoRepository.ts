import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import { todos } from "../../database/schema.js";
import type { NewTodo, Todo } from "../../database/schema.js";
import type { ITodoRepository } from "../interfaces/ITodoRepository.js";

export class TursoTodoRepository implements ITodoRepository {
  constructor(private readonly db: Database) {}

  async create(todo: NewTodo): Promise<Todo> {
    const now = new Date();
    const row: NewTodo = {
      ...todo,
      id: todo.id ?? randomUUID(),
      createdAt: todo.createdAt ?? now,
      updatedAt: todo.updatedAt ?? now,
    };
    await this.db.insert(todos).values(row);
    return row as Todo;
  }

  async findByProject(projectId: string): Promise<Todo[]> {
    return this.db.select().from(todos).where(eq(todos.projectId, projectId));
  }

  async markDone(id: string, done: boolean): Promise<void> {
    await this.db
      .update(todos)
      .set({ done, updatedAt: new Date() })
      .where(eq(todos.id, id));
  }
}
