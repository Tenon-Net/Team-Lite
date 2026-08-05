// @ts-nocheck
import React from 'react';
import { Robot } from '@icon-park/react';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import { resolveAssistantName } from '@renderer/utils/model/assistantDisplay';
import { assistantRuntimeKey, type Assistant } from '@/common/types/agent/assistantTypes';
import type { TeamAssistant } from '@/common/types/team/teamTypes';

/** Team leader selector entry derived from the unified assistant catalog. */
export type TeamAssistantOption = {
  id: string;
  name: string;
  /** Execution backend (claude, gemini, qwen, …). */
  backend?: string;
  /** Avatar token — a backend-resolved URL or an emoji. */
  icon?: string;
  /** Whether this assistant can currently be used in team mode. */
  team_selectable?: boolean;
  /** Why this assistant cannot currently be used in team mode. */
  team_block_reason?: string;
};

export function assistantToOption(assistant: Assistant, localeKey = 'en-US'): TeamAssistantOption {
  return {
    id: assistant.id,
    name: resolveAssistantName(assistant, localeKey, assistant.name),
    backend: assistantRuntimeKey(assistant),
    icon: assistant.avatar,
    team_selectable: assistant.team_selectable,
    team_block_reason: assistant.team_block_reason,
  };
}

export function assistantKey(assistant: TeamAssistantOption): string {
  return assistant.id;
}

export function assistantFromId(
  assistantId: string,
  allAssistants: TeamAssistantOption[]
): TeamAssistantOption | undefined {
  return allAssistants.find((assistant) => assistantKey(assistant) === assistantId);
}

/**
 * Resolve which catalog assistant a team member should sync/copy from.
 *
 * Prefer a unique non-bare assistant that shares the member display name so
 * bare:claude/codex members rebind to system presets (rules/agent/defaults).
 * Do NOT require `team_selectable` for name matching — provisioning validates
 * capability at create time.
 */
export function resolveSyncCatalogAssistantOption(
  sourceMember: Pick<TeamAssistant, 'assistant_id' | 'assistant_name' | 'assistant_backend'>,
  allAssistants: TeamAssistantOption[]
): TeamAssistantOption | undefined {
  if (allAssistants.length === 0) return undefined;

  const normalizedName = sourceMember.assistant_name.trim().toLowerCase();
  const sameName = normalizedName
    ? allAssistants.filter((assistant) => assistant.name.trim().toLowerCase() === normalizedName)
    : [];
  const nonBareNameMatches = sameName.filter((assistant) => !assistant.id.startsWith('bare:'));
  if (nonBareNameMatches.length === 1) return nonBareNameMatches[0];
  const selectableNonBare = nonBareNameMatches.filter((assistant) => assistant.team_selectable !== false);
  if (selectableNonBare.length === 1) return selectableNonBare[0];
  if (nonBareNameMatches.length > 1) return selectableNonBare[0] ?? nonBareNameMatches[0];
  if (sameName.length === 1) return sameName[0];

  const exact = allAssistants.find((assistant) => assistant.id === sourceMember.assistant_id);
  if (exact) return exact;

  const normalizedBackend = sourceMember.assistant_backend.trim().toLowerCase();
  if (!normalizedBackend) return undefined;
  const sameBackend = allAssistants.filter(
    (assistant) => assistant.team_selectable !== false && assistant.backend?.trim().toLowerCase() === normalizedBackend
  );
  return (
    sameBackend.find((assistant) => assistant.id.startsWith('bare:')) ??
    (sameBackend.length === 1 ? sameBackend[0] : undefined)
  );
}

/** Resolve a copied member against the latest selectable assistant catalog. */
export function resolveDuplicateAssistantOption(
  sourceMember: TeamAssistant,
  allAssistants: TeamAssistantOption[]
): TeamAssistantOption | undefined {
  // Prefer system assistant rematch by display name so copying a team that was
  // stuck on bare engines still lands on outsourcing presets when selectable.
  const rematched = resolveSyncCatalogAssistantOption(sourceMember, allAssistants);
  if (rematched && rematched.team_selectable !== false) return rematched;

  const selectable = allAssistants.filter((assistant) => assistant.team_selectable !== false);
  const exact = selectable.find((assistant) => assistant.id === sourceMember.assistant_id);
  if (exact) return exact;

  const normalizedName = sourceMember.assistant_name.trim().toLowerCase();
  const sameName = normalizedName
    ? selectable.filter((assistant) => assistant.name.trim().toLowerCase() === normalizedName)
    : [];
  if (sameName.length === 1) return sameName[0];

  const normalizedBackend = sourceMember.assistant_backend.trim().toLowerCase();
  if (!normalizedBackend) return undefined;
  const sameBackend = selectable.filter((assistant) => assistant.backend?.trim().toLowerCase() === normalizedBackend);
  return (
    sameBackend.find((assistant) => assistant.id.startsWith('bare:')) ??
    (sameBackend.length === 1 ? sameBackend[0] : undefined)
  );
}

/** Filter assistants to only those supported in team mode. */
export function filterTeamSupportedAssistants(assistants: TeamAssistantOption[]): TeamAssistantOption[] {
  return assistants;
}

type AssistantOptionLabelProps = {
  assistant: TeamAssistantOption;
  size?: 'compact' | 'large';
  muted?: boolean;
};

export const AssistantOptionLabel: React.FC<AssistantOptionLabelProps> = ({
  assistant,
  size = 'compact',
  muted = false,
}) => {
  const avatar = resolveAssistantAvatar(assistant.icon);
  const isLarge = size === 'large';
  const iconSize = isLarge ? 18 : 16;
  const avatarToneClass = muted ? 'bg-fill-1 text-t-tertiary opacity-75' : 'bg-fill-2 text-t-primary';
  const avatarClass = isLarge
    ? `flex h-30px w-30px shrink-0 items-center justify-center rounded-8px ${avatarToneClass}`
    : `flex h-32px w-32px shrink-0 items-center justify-center rounded-8px ${avatarToneClass}`;
  const nameClass = muted ? 'text-t-tertiary' : 'text-t-primary';
  const avatarNode =
    avatar.kind === 'image' ? (
      <img
        src={avatar.value}
        alt={assistant.name}
        style={{ width: iconSize, height: iconSize, objectFit: 'contain' }}
      />
    ) : avatar.kind === 'emoji' ? (
      <span style={{ fontSize: isLarge ? 18 : 14, lineHeight: `${iconSize}px` }}>{avatar.value}</span>
    ) : (
      <Robot size={String(iconSize)} />
    );

  return (
    <div className={isLarge ? 'flex min-w-0 items-center gap-12px' : 'flex min-w-0 items-center gap-8px'}>
      <span className={avatarClass} data-testid='assistant-avatar'>
        {avatarNode}
      </span>
      <span
        data-testid='assistant-option-name'
        className={
          isLarge ? `min-w-0 truncate text-14px font-500 leading-21px ${nameClass}` : `min-w-0 truncate ${nameClass}`
        }
      >
        {assistant.name}
      </span>
    </div>
  );
};
