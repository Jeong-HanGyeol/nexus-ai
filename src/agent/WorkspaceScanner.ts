import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { IProjectIdentifier } from "./IProjectIdentifier.js";
import type {
  DiscoveredProject,
  IWorkspaceScanner,
} from "./IWorkspaceScanner.js";

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
]);

const PROJECT_MARKERS = ["package.json", ".git"];

export interface WorkspaceScannerOptions {
  /** How many levels below workspaceRoot to search. Defaults to 1 (direct children only). */
  maxDepth?: number;
}

/**
 * Scans a workspace directory for manageable projects (anything containing
 * package.json or .git) instead of relying on a manually maintained project
 * list. Each match is run through IProjectIdentifier so discovered projects
 * follow the exact same naming rules as a single-project Agent.
 */
export class WorkspaceScanner implements IWorkspaceScanner {
  private readonly maxDepth: number;

  constructor(
    private readonly identifier: IProjectIdentifier,
    options: WorkspaceScannerOptions = {},
  ) {
    this.maxDepth = options.maxDepth ?? 1;
  }

  async scan(workspaceRoot: string): Promise<DiscoveredProject[]> {
    const projectDirs = await this.findProjectDirs(
      path.resolve(workspaceRoot),
      this.maxDepth,
    );

    const discovered: DiscoveredProject[] = [];
    for (const dir of projectDirs) {
      const identification = await this.identifier.identify(dir);
      discovered.push({ path: dir, identification });
    }

    return discovered;
  }

  private async findProjectDirs(
    root: string,
    depth: number,
  ): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }

    const projectDirs: string[] = [];
    for (const entry of entries) {
      const isIgnored =
        !entry.isDirectory() ||
        IGNORED_DIR_NAMES.has(entry.name) ||
        entry.name.startsWith(".");
      if (isIgnored) {
        continue;
      }

      const fullPath = path.join(root, entry.name);
      if (await this.hasProjectMarker(fullPath)) {
        projectDirs.push(fullPath);
        continue; // don't descend into an already-identified project
      }

      if (depth > 0) {
        const nested = await this.findProjectDirs(fullPath, depth - 1);
        projectDirs.push(...nested);
      }
    }

    return projectDirs;
  }

  private async hasProjectMarker(dir: string): Promise<boolean> {
    for (const marker of PROJECT_MARKERS) {
      try {
        await stat(path.join(dir, marker));
        return true;
      } catch {
        // marker not present here, try the next one
      }
    }
    return false;
  }
}
