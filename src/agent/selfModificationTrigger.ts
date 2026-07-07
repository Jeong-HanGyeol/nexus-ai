import { containsWholeWord } from "./matchProjectFromText.js";

/**
 * "sentinelAI"/"sentinel" are legacy internal codenames for this project,
 * never used in normal conversation (the operator addresses the AI as
 * "NEXUS"/"넥서스"). Requiring one of these words as an explicit opt-in
 * keyword lets the operator deliberately target Sentinel/NEXUS's own
 * codebase for a dev task, without every casual "넥서스야 ~~" message
 * risking an unintended self-modifying Claude run.
 */
const SELF_MODIFICATION_TRIGGER_WORDS = ["sentinelai", "sentinel"];

export function isSelfModificationRequested(text: string): boolean {
  return SELF_MODIFICATION_TRIGGER_WORDS.some((word) =>
    containsWholeWord(text, word),
  );
}
