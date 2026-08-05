// @ts-nocheck
import { ipcBridge } from '@/common';
import {
  buildContextRelaySuccessorPrompt,
  createContextRelayFallback,
  redactContextRelayEvidence,
  type TMessage,
} from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { loadLatestConversationMessages } from '@/renderer/utils/chat/messagePagination';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

export const TEAM_CONTEXT_CHECKPOINT_MAX_CHARS = 24_000;
/** Cap messages loaded for preserve-context so sync/rebuild cannot page entire history under the membership lock. */
export const TEAM_CONTEXT_CHECKPOINT_MAX_MESSAGES = 80;
const TEAM_CONTEXT_CHECKPOINT_MAX_ESTIMATED_TOKENS = 6_000;
const TEAM_CONTEXT_STATE_MAX_ESTIMATED_TOKENS = 4_000;
const TEAM_CONTEXT_SECTION_MAX_ESTIMATED_TOKENS = 1_200;
const TEAM_CONTEXT_CHECKPOINT_BEGIN = '[AIONUI_TEAM_CONTEXT_CHECKPOINT_BEGIN]';
const TEAM_CONTEXT_CHECKPOINT_END = '[AIONUI_TEAM_CONTEXT_CHECKPOINT_END]';
const LEGACY_TEAM_CONTEXT_CHECKPOINT_MARKER = '[AionUi team context checkpoint]';

type CheckpointSection = {
  index: number;
  isToolEvidence: boolean;
  value: string;
};

const messageRole = (message: TMessage): string => {
  if (message.position === 'right') return 'User';
  if (message.position === 'left') return 'Assistant';
  return 'Context';
};

const estimateTokens = (value: string): number => {
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
    else nonAsciiCharacters += 1;
  }
  return Math.ceil(asciiCharacters / 4) + nonAsciiCharacters;
};

const takeStartWithinTokenBudget = (value: string, budget: number): string => {
  if (estimateTokens(value) <= budget) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(characters.slice(0, middle).join('')) <= budget) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('');
};

const takeEndWithinTokenBudget = (value: string, budget: number): string => {
  if (estimateTokens(value) <= budget) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(characters.slice(characters.length - middle).join('')) <= budget) low = middle;
    else high = middle - 1;
  }
  return characters.slice(characters.length - low).join('');
};

const compactEvidenceValue = (value: unknown, maxCharacters = 800): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
  const compact = redactContextRelayEvidence(String(value)).replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length <= maxCharacters ? compact : `${compact.slice(0, maxCharacters - 1)}…`;
};

const toolCallSection = (message: Extract<TMessage, { type: 'tool_call' }>, index: number): CheckpointSection => {
  const details = [`Tool: ${compactEvidenceValue(message.content.name, 200) ?? 'unknown'}`];
  details.push(`status=${message.content.status ?? message.status ?? 'unknown'}`);
  const description = compactEvidenceValue(message.content.description);
  const output = compactEvidenceValue(message.content.output);
  const error = compactEvidenceValue(message.content.error);
  if (description) details.push(`description=${description}`);
  if (output) details.push(`output=${output}`);
  if (error) details.push(`error=${error}`);
  return {
    index,
    isToolEvidence: true,
    value: `Provenance: persisted tool evidence\n${details.join(' | ')}`,
  };
};

const acpToolCallSection = (
  message: Extract<TMessage, { type: 'acp_tool_call' }>,
  index: number
): CheckpointSection => {
  const { update } = message.content;
  const rawOutput = update.rawOutput ?? update.raw_output;
  const details = [`ACP tool: ${compactEvidenceValue(update.title, 200) ?? 'unknown'}`];
  details.push(`kind=${update.kind}`);
  details.push(`status=${update.status}`);
  const savedPath = compactEvidenceValue(rawOutput?.saved_path);
  const rawStatus = compactEvidenceValue(rawOutput?.status);
  const omittedReason = compactEvidenceValue(rawOutput?.result_omitted_reason);
  if (savedPath) details.push(`saved_path=${savedPath}`);
  if (rawStatus) details.push(`result_status=${rawStatus}`);
  if (rawOutput?.result_omitted !== undefined) details.push(`result_omitted=${rawOutput.result_omitted}`);
  if (omittedReason) details.push(`result_omitted_reason=${omittedReason}`);
  if (typeof rawOutput?.result_bytes === 'number') details.push(`result_bytes=${rawOutput.result_bytes}`);

  const locations = update.locations
    ?.map((location) => compactEvidenceValue(location.path, 300))
    .filter((path): path is string => Boolean(path));
  if (locations?.length) details.push(`locations=${locations.join(',')}`);

  const contentEvidence = update.content
    ?.map((item) => compactEvidenceValue(item.path, 300))
    .filter((path): path is string => Boolean(path))
    .map((path) => `diff_path=${path}`)
    .slice(0, 3);
  if (contentEvidence?.length) details.push(...contentEvidence);

  return {
    index,
    isToolEvidence: true,
    value: `Provenance: persisted tool evidence\n${details.join(' | ')}`,
  };
};

const checkpointSections = (messages: TMessage[]): CheckpointSection[] =>
  messages.flatMap((message, index) => {
    if (message.hidden) return [];
    if (message.type === 'text') {
      const content = redactContextRelayEvidence(message.content.content).trim();
      return content
        ? [
            {
              index,
              isToolEvidence: false,
              value: `Provenance: persisted conversation text\n${messageRole(message)}: ${content}`,
            },
          ]
        : [];
    }
    if (message.type === 'tool_call') return [toolCallSection(message, index)];
    if (message.type === 'acp_tool_call') return [acpToolCallSection(message, index)];
    return [];
  });

const truncateSection = (value: string, budget: number): string => {
  if (estimateTokens(value) <= budget) return value;
  const newlineIndex = value.indexOf('\n');
  const provenance = newlineIndex >= 0 ? value.slice(0, newlineIndex) : '';
  const provenanceTokens = estimateTokens(provenance) + 1;
  if (!provenance || provenanceTokens >= budget) return takeEndWithinTokenBudget(value, budget);
  const evidence = takeEndWithinTokenBudget(value.slice(newlineIndex + 1), budget - provenanceTokens);
  return `${provenance}\n${evidence}`;
};

const takeSectionsWithinTokenBudget = (sections: CheckpointSection[], budget: number): string[] => {
  if (sections.length === 0 || budget <= 0) return [];
  const candidateIndices = [
    sections.length - 1,
    ...sections
      .map((section, index) => ({ index, isToolEvidence: section.isToolEvidence }))
      .filter(({ isToolEvidence }) => isToolEvidence)
      .map(({ index }) => index)
      .toReversed(),
    ...sections.map((_section, index) => index).toReversed(),
  ];
  const selected = new Map<number, string>();
  let remaining = budget;

  for (const index of candidateIndices) {
    if (selected.has(index)) continue;
    const separatorTokens = selected.size > 0 ? 1 : 0;
    const available = Math.min(remaining - separatorTokens, TEAM_CONTEXT_SECTION_MAX_ESTIMATED_TOKENS);
    if (available <= 0) break;
    const value = truncateSection(sections[index].value, available);
    const tokenCount = estimateTokens(value) + separatorTokens;
    if (!value || tokenCount > remaining) continue;
    selected.set(index, value);
    remaining -= tokenCount;
  }

  return [...selected.entries()]
    .toSorted(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, value]) => value);
};

export function buildTeamContextCheckpoint(
  messages: TMessage[],
  presetContext?: string,
  previousCheckpoint?: string
): string | undefined {
  const messageSections = checkpointSections(messages);
  const previous = previousCheckpoint ? redactContextRelayEvidence(previousCheckpoint).trim() : undefined;
  const sections: CheckpointSection[] = previous
    ? [
        {
          index: -1,
          isToolEvidence: false,
          value: `Provenance: previously preserved team context\n${previous}`,
        },
        ...messageSections,
      ]
    : messageSections;
  const trimmedPreset = redactContextRelayEvidence(removeMarkedTeamContextCheckpoint(presetContext ?? '')).trim();
  if (sections.length === 0 && !trimmedPreset) return undefined;

  const latestUserMessage = messages
    .toReversed()
    .find((message) => message.type === 'text' && !message.hidden && message.position === 'right');
  const latestUserGoal =
    latestUserMessage?.type === 'text'
      ? redactContextRelayEvidence(latestUserMessage.content.content).trim()
      : undefined;
  const goal = takeStartWithinTokenBudget(
    latestUserGoal || 'Continue the team member task from its verified persisted state',
    600
  );
  const presetConstraint = trimmedPreset ? takeStartWithinTokenBudget(trimmedPreset, 800) : undefined;

  const buildCheckpoint = (state: string): string =>
    buildContextRelaySuccessorPrompt(
      createContextRelayFallback({
        goal,
        user_constraints: presetConstraint ? [presetConstraint] : [],
        current_state: `Recent persisted team conversation:\n${state}`,
        remaining: [
          {
            priority: 1,
            item: goal,
            next_action: 'Verify the workspace and resume the unfinished team-member work from this handoff.',
          },
        ],
        risks_and_unknowns: [
          'This fallback handoff was built from persisted conversation text and bounded persisted tool evidence.',
        ],
        continuation: 'continue',
      })
    );

  let stateBudget = TEAM_CONTEXT_STATE_MAX_ESTIMATED_TOKENS;
  let currentState = takeSectionsWithinTokenBudget(sections, stateBudget).join('\n\n');
  if (!currentState) currentState = 'No visible persisted conversation or tool evidence was available.';
  let checkpoint = buildCheckpoint(currentState);
  while (
    (checkpoint.length > TEAM_CONTEXT_CHECKPOINT_MAX_CHARS ||
      estimateTokens(checkpoint) > TEAM_CONTEXT_CHECKPOINT_MAX_ESTIMATED_TOKENS) &&
    stateBudget > 0
  ) {
    const tokenOverflow = Math.max(0, estimateTokens(checkpoint) - TEAM_CONTEXT_CHECKPOINT_MAX_ESTIMATED_TOKENS);
    stateBudget = Math.max(0, stateBudget - Math.max(64, tokenOverflow));
    currentState = takeSectionsWithinTokenBudget(sections, stateBudget).join('\n\n');
    if (!currentState) currentState = 'Persisted evidence was omitted to stay within the checkpoint token budget.';
    checkpoint = buildCheckpoint(currentState);
  }
  return checkpoint;
}

const presetContextOf = (conversation: TChatConversation | null): string | undefined => {
  const extra = conversation?.extra as Record<string, unknown> | undefined;
  return typeof extra?.preset_context === 'string' ? extra.preset_context : undefined;
};

const removeMarkedTeamContextCheckpoint = (presetContext: string): string => {
  let value = presetContext;
  let beginIndex = value.indexOf(TEAM_CONTEXT_CHECKPOINT_BEGIN);
  while (beginIndex >= 0) {
    let cursor = beginIndex + TEAM_CONTEXT_CHECKPOINT_BEGIN.length;
    let depth = 1;
    while (depth > 0) {
      const nestedBeginIndex = value.indexOf(TEAM_CONTEXT_CHECKPOINT_BEGIN, cursor);
      const endIndex = value.indexOf(TEAM_CONTEXT_CHECKPOINT_END, cursor);
      if (endIndex < 0) {
        cursor = value.length;
        break;
      }
      if (nestedBeginIndex >= 0 && nestedBeginIndex < endIndex) {
        depth += 1;
        cursor = nestedBeginIndex + TEAM_CONTEXT_CHECKPOINT_BEGIN.length;
      } else {
        depth -= 1;
        cursor = endIndex + TEAM_CONTEXT_CHECKPOINT_END.length;
      }
    }
    value = `${value.slice(0, beginIndex)}${value.slice(cursor)}`;
    beginIndex = value.indexOf(TEAM_CONTEXT_CHECKPOINT_BEGIN);
  }
  const legacyMarkerIndex = value.indexOf(LEGACY_TEAM_CONTEXT_CHECKPOINT_MARKER);
  if (legacyMarkerIndex >= 0) value = value.slice(0, legacyMarkerIndex);
  return value.replace(/\n{3,}/g, '\n\n').trim();
};

const extractMarkedTeamContextCheckpoint = (presetContext: string): string | undefined => {
  const beginIndex = presetContext.indexOf(TEAM_CONTEXT_CHECKPOINT_BEGIN);
  if (beginIndex >= 0) {
    const contentStart = beginIndex + TEAM_CONTEXT_CHECKPOINT_BEGIN.length;
    const endIndex = presetContext.indexOf(TEAM_CONTEXT_CHECKPOINT_END, contentStart);
    if (endIndex >= 0) {
      const checkpoint = presetContext.slice(contentStart, endIndex).trim();
      return checkpoint || undefined;
    }
  }

  const legacyMarkerIndex = presetContext.indexOf(LEGACY_TEAM_CONTEXT_CHECKPOINT_MARKER);
  if (legacyMarkerIndex < 0) return undefined;
  const checkpoint = presetContext.slice(legacyMarkerIndex + LEGACY_TEAM_CONTEXT_CHECKPOINT_MARKER.length).trim();
  return checkpoint || undefined;
};

export async function captureTeamContextCheckpoint(conversationId: string): Promise<string | undefined> {
  const [conversation, latestPage] = await Promise.all([
    getConversationOrNull(conversationId),
    loadLatestConversationMessages(conversationId, {
      limit: TEAM_CONTEXT_CHECKPOINT_MAX_MESSAGES,
      // Compact content is enough for handoff; full tool payloads blow up lock hold time.
      contentMode: 'compact',
    }),
  ]);
  const presetContext = presetContextOf(conversation);
  return buildTeamContextCheckpoint(
    latestPage.items,
    presetContext,
    extractMarkedTeamContextCheckpoint(presetContext ?? '')
  );
}

export async function restoreTeamContextCheckpoint(
  conversationId: string,
  checkpoint: string | undefined,
  sourceConversationId: string
): Promise<void> {
  const conversation = await getConversationOrNull(conversationId);
  if (!conversation) throw new Error('The replacement conversation could not be loaded');

  const currentPreset = removeMarkedTeamContextCheckpoint(presetContextOf(conversation) ?? '');
  const checkpointBlock = checkpoint
    ? [TEAM_CONTEXT_CHECKPOINT_BEGIN, checkpoint.trim(), TEAM_CONTEXT_CHECKPOINT_END].join('\n')
    : undefined;
  const preset_context = checkpointBlock
    ? currentPreset
      ? `${currentPreset}\n\n${checkpointBlock}`
      : checkpointBlock
    : currentPreset;
  const updates = {
    extra: {
      ...conversation.extra,
      context_relay_source_id: sourceConversationId,
      preset_context,
    },
  } as Partial<TChatConversation>;

  const updated = await ipcBridge.conversation.update.invoke({
    id: conversationId,
    updates,
    merge_extra: true,
  });
  if (!updated) throw new Error('The preserved context could not be attached to the replacement conversation');
}
