import { containsWholeWord, escapeRegExp } from "./matchProjectFromText.js";

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

/**
 * Removes the opt-in trigger word from the message before it becomes the
 * actual task text sent to headless Claude. Without this, a message like
 * "sentinelAI 맥에서 사용할 프로젝트는 어떻게 등록하지?" hands Claude the raw
 * keyword as part of its prompt, and a one-shot headless run has no way to
 * tell "routing signal" apart from "the actual instruction" - it ends up
 * treating the keyword itself as the task (e.g. grepping the codebase for
 * "sentinelAI") instead of answering the real question that followed it.
 */
export function stripSelfModificationTrigger(text: string): string {
  let result = text;
  for (const word of SELF_MODIFICATION_TRIGGER_WORDS) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"), "");
  }
  return result
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}
