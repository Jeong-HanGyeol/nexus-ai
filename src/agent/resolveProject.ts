import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Project } from "../database/schema.js";
import type { IProjectRepository } from "../repository/interfaces/IProjectRepository.js";
import type {
  IProjectIdentifier,
  ProjectIdentification,
  ProjectIdentificationConfidence,
} from "./IProjectIdentifier.js";
import { slugify } from "./slugify.js";

export interface ResolvedProject {
  project: Project;
  confidence: ProjectIdentificationConfidence;
}

/**
 * Upserts an already-computed identification into the `projects` table, keyed
 * by filesystem path (the true identity of a project instance - two
 * different paths may legitimately share the same display name/slug, e.g.
 * a monorepo with two sub-projects both named "kdhc"). Split out from
 * resolveProject so callers who already ran IProjectIdentifier themselves
 * (e.g. WorkspaceScanner) don't pay for a redundant re-identification.
 */
export async function upsertProject(
  identification: ProjectIdentification,
  projectRepository: IProjectRepository,
  projectPath: string,
): Promise<ResolvedProject> {
  const resolvedPath = path.resolve(projectPath);

  const existing = await projectRepository.findByPath(resolvedPath);
  if (existing) {
    return { project: existing, confidence: identification.confidence };
  }

  const now = new Date();
  const created = await projectRepository.create({
    id: randomUUID(),
    name: identification.name,
    slug: slugify(identification.name),
    path: resolvedPath,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return { project: created, confidence: identification.confidence };
}

/**
 * Auto-identifies the project at targetPath and upserts it into the
 * `projects` table - no manual project registration file needed.
 */
export async function resolveProject(
  identifier: IProjectIdentifier,
  projectRepository: IProjectRepository,
  targetPath: string = process.cwd(),
): Promise<ResolvedProject> {
  const identification = await identifier.identify(targetPath);
  return upsertProject(identification, projectRepository, targetPath);
}
