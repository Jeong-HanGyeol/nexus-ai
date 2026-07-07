import type { Project } from "../database/schema.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match so "sentinelAI" does NOT match a project named "sentinel". */
export function containsWholeWord(text: string, word: string): boolean {
  if (!word) {
    return false;
  }
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text);
}

/**
 * Finds which known project a natural-language command refers to (e.g.
 * "KDHC 이어서 작업해" -> the project named "kdhc") by whole-word matching
 * against each project's name/slug (not a raw substring - "sentinelAI"
 * must not match a project named "sentinel"). Prefers the longest matching
 * name so a more specific project name wins over a shorter, coincidentally-
 * contained one. Full NLU/intent parsing is future scope (see "자연어 명령
 * 해석" in the roadmap) - this is intentionally simple for V1.
 *
 * Known limitation: if two registered projects share the same name (e.g.
 * a monorepo with two sub-projects both named "kdhc"), the match is
 * ambiguous and this returns whichever appears first - V1 has no
 * disambiguation prompt (no /use-style selection UI).
 */
export function matchProjectFromText(
  text: string,
  projects: Project[],
): Project | undefined {
  const candidates = projects.filter(
    (project) =>
      containsWholeWord(text, project.name) ||
      containsWholeWord(text, project.slug),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((best, candidate) =>
    candidate.name.length > best.name.length ? candidate : best,
  );
}
