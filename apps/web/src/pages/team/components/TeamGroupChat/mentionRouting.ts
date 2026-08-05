// @ts-nocheck
import type { TeamAssistant } from '@/common/types/team/teamTypes';

/** Resolves mention selections in roster order and drops stale or duplicate slot ids. */
export const resolveMentionTargets = (
  assistants: TeamAssistant[],
  selectedSlotIds: Iterable<string>,
  mentionEveryone: boolean
): string[] => {
  const selected = new Set(selectedSlotIds);
  return assistants
    .filter((assistant) => mentionEveryone || selected.has(assistant.slot_id))
    .map((assistant) => assistant.slot_id);
};
