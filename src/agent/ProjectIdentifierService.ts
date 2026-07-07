import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  IProjectIdentifier,
  ProjectIdentification,
  ProjectIdentificationSignal,
  ProjectSignalSource,
} from "./IProjectIdentifier.js";

const UNKNOWN_PROJECT_NAME = "Unknown Project";

/** Fallback order when signals disagree and no majority exists. */
const PRIORITY: ProjectSignalSource[] = [
  "package_json",
  "git_origin",
  "folder_name",
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class ProjectIdentifierService implements IProjectIdentifier {
  async identify(
    targetPath: string = process.cwd(),
  ): Promise<ProjectIdentification> {
    const resolvedPath = path.resolve(targetPath);
    const signals: ProjectIdentificationSignal[] = [];

    const packageJsonName = await this.readPackageJsonName(resolvedPath);
    if (packageJsonName) {
      signals.push({ source: "package_json", value: packageJsonName });
    }

    const gitOriginName = await this.readGitOriginRepoName(resolvedPath);
    if (gitOriginName) {
      signals.push({ source: "git_origin", value: gitOriginName });
    }

    const folderName = path.basename(resolvedPath);
    if (folderName) {
      signals.push({ source: "folder_name", value: folderName });
    }

    if (signals.length === 0) {
      return { name: UNKNOWN_PROJECT_NAME, confidence: "low", signals };
    }

    const groups = new Map<string, ProjectIdentificationSignal[]>();
    for (const signal of signals) {
      const key = normalize(signal.value);
      const group = groups.get(key) ?? [];
      group.push(signal);
      groups.set(key, group);
    }

    let bestGroup: ProjectIdentificationSignal[] = [];
    for (const group of groups.values()) {
      if (group.length > bestGroup.length) {
        bestGroup = group;
      }
    }

    const firstOfBestGroup = bestGroup[0];
    if (bestGroup.length >= 2 && firstOfBestGroup) {
      const preferred =
        bestGroup.find((signal) => signal.source === "package_json") ??
        firstOfBestGroup;
      return { name: preferred.value, confidence: "high", signals };
    }

    for (const source of PRIORITY) {
      const found = signals.find((signal) => signal.source === source);
      if (found) {
        return { name: found.value, confidence: "low", signals };
      }
    }

    return { name: UNKNOWN_PROJECT_NAME, confidence: "low", signals };
  }

  private async readPackageJsonName(
    targetPath: string,
  ): Promise<string | undefined> {
    try {
      const raw = await readFile(
        path.join(targetPath, "package.json"),
        "utf-8",
      );
      const parsed = JSON.parse(raw) as { name?: unknown };
      return typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async readGitOriginRepoName(
    targetPath: string,
  ): Promise<string | undefined> {
    const gitRoot = await this.findGitRoot(targetPath);
    if (!gitRoot) {
      return undefined;
    }

    try {
      const configRaw = await readFile(
        path.join(gitRoot, ".git", "config"),
        "utf-8",
      );
      const match = /\[remote "origin"\][^[]*url\s*=\s*(.+)/.exec(configRaw);
      if (!match?.[1]) {
        return undefined;
      }
      return this.repoNameFromUrl(match[1].trim());
    } catch {
      return undefined;
    }
  }

  private repoNameFromUrl(url: string): string | undefined {
    const cleaned = url.replace(/\.git$/, "");
    const segments = cleaned.split(/[/:]/).filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
  }

  /** Walks up from targetPath looking for a .git entry, like git itself does. */
  private async findGitRoot(startPath: string): Promise<string | undefined> {
    let current = path.resolve(startPath);

    for (;;) {
      try {
        await stat(path.join(current, ".git"));
        return current;
      } catch {
        // not found here, keep walking up
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      current = parent;
    }
  }
}
