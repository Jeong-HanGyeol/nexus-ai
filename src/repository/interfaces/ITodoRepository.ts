import type { NewTodo, Todo } from "../../database/schema.js";

export interface ITodoRepository {
  create(todo: NewTodo): Promise<Todo>;
  findByProject(projectId: string): Promise<Todo[]>;
  markDone(id: string, done: boolean): Promise<void>;
}
