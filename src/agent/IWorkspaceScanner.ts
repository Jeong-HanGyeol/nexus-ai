import type { ProjectIdentification } from "./IProjectIdentifier.js";

export interface DiscoveredProject {
  path: string;
  identification: ProjectIdentification;
}

/**
 * Discovers manageable projects under a workspace root instead of relying
 * on a manually maintained project list/config file. Adding a new project
 * to the workspace makes it show up automatically on the next scan.
 */
export interface IWorkspaceScanner {
  scan(workspaceRoot: string): Promise<DiscoveredProject[]>;
}
