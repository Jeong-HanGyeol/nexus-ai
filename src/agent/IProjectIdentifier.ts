export type ProjectSignalSource = "package_json" | "git_origin" | "folder_name";

export interface ProjectIdentificationSignal {
  source: ProjectSignalSource;
  value: string;
}

export type ProjectIdentificationConfidence = "high" | "low";

export interface ProjectIdentification {
  name: string;
  /** "high" when 2+ signals agree (cross-validated), "low" for a single/fallback signal. */
  confidence: ProjectIdentificationConfidence;
  signals: ProjectIdentificationSignal[];
}

/**
 * Auto-detects "what project is this" from the environment instead of a
 * config file, so Sentinel never needs a project registry to be manually
 * maintained. Falls back to "Unknown Project" rather than throwing, since
 * detection failing must never stop the Agent from working.
 */
export interface IProjectIdentifier {
  identify(targetPath?: string): Promise<ProjectIdentification>;
}
