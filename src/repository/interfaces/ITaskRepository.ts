import type { NewTask, Task } from "../../database/schema.js";

export interface ITaskRepository {
  create(task: NewTask): Promise<Task>;
  findByProject(projectId: string): Promise<Task[]>;
  updateStatus(id: string, status: string): Promise<void>;
}
