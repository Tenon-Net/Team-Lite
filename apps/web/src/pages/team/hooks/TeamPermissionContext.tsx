// @ts-nocheck
import { ipcBridge } from '@/common';
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { findConfigOption, findConfigOptionById } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { createTeamConfigOptionsLoader, type TeamConfigOptionsLoader } from './teamConfigOptions';

export type TeamContextRelayAvailability = 'available' | 'waiting' | 'unsupported';
export type TeamContextRelayMode = 'member_replace' | 'team_rebuild';
export type TeamContextRelayReplacement = {
  mode?: TeamContextRelayMode;
  teamId?: string;
  conversationId: string;
  slotId?: string;
};

type TeamPermissionContextValue = {
  /** Whether we are in team mode */
  isTeamMode: true;
  /** Whether the current active agent is the team leader */
  isLeaderAgent: boolean;
  /** Conversation ID of the leader agent */
  leaderConversationId: string;
  /** All agent conversation IDs in this team (for centralized confirmation listening) */
  allConversationIds: string[];
  /** Propagate a permission mode change from the leader to all member agents */
  propagateMode: (mode: string) => void;
  /** Trigger session warmup (idempotent, returns cached promise) */
  warmupSession: () => Promise<void>;
  /** Load runtime config options through the team-owned session */
  loadConfigOptions: TeamConfigOptionsLoader;
  /** Whether this conversation can be replaced through the safe teammate relay path. */
  canRelayContext: (conversationId: string) => boolean;
  /** Distinguish a temporary team boundary from conversations that can never use team relay. */
  getContextRelayAvailability: (conversationId: string) => TeamContextRelayAvailability;
  /**
   * How relay materializes for this conversation.
   * Auto/forceEmergency may only execute `member_replace`; `team_rebuild` is confirm-only.
   */
  getContextRelayMode: (conversationId: string) => TeamContextRelayMode | null;
  /** Ask the team owner to relay an eligible teammate at a safe runtime boundary. */
  requestContextRelay: (conversationId: string) => Promise<TeamContextRelayReplacement | void>;
  /**
   * Open the confirm UI for relays that must not auto-execute (Leader team_rebuild).
   * Used by overflow / /clear — never performs the rebuild itself.
   */
  requestContextRelayConfirm?: (conversationId: string) => void;
  /** Activate the replacement only after the outgoing conversation has persisted its draft. */
  activateContextRelayReplacement?: (replacement: TeamContextRelayReplacement) => void;
};

const TeamPermissionContext = createContext<TeamPermissionContextValue | null>(null);

export const TeamPermissionProvider: React.FC<{
  children: React.ReactNode;
  team_id: string;
  isLeaderAgent: boolean;
  leaderConversationId: string;
  allConversationIds: string[];
  contextRelayConversationIds?: string[];
  contextRelaySupportedConversationIds?: string[];
  /** Conversations that relay via whole-team rebuild (Leader). Must also be listed as supported. */
  contextRelayRebuildConversationIds?: string[];
  /** Temporary gate for member_replace (includes cron eligibility loading). */
  contextRelayTemporarilyUnavailable?: boolean;
  /**
   * Temporary gate for team_rebuild only (busy / membership).
   * Must NOT include cron eligibility loading — Leader rebuild does not depend on it.
   */
  contextRelayRebuildTemporarilyUnavailable?: boolean;
  requestContextRelay?: (conversationId: string) => Promise<TeamContextRelayReplacement | void>;
  requestContextRelayConfirm?: (conversationId: string) => void;
  activateContextRelayReplacement?: (replacement: TeamContextRelayReplacement) => void;
}> = ({
  children,
  team_id,
  isLeaderAgent,
  leaderConversationId,
  allConversationIds,
  contextRelayConversationIds = [],
  contextRelaySupportedConversationIds,
  contextRelayRebuildConversationIds = [],
  contextRelayTemporarilyUnavailable = false,
  contextRelayRebuildTemporarilyUnavailable,
  requestContextRelay: onRequestContextRelay,
  requestContextRelayConfirm,
  activateContextRelayReplacement,
}) => {
  const warmupPromiseRef = useRef<Promise<void> | null>(null);

  const warmupSession = useCallback((): Promise<void> => {
    if (warmupPromiseRef.current) {
      return warmupPromiseRef.current;
    }

    const promise = ipcBridge.team.ensureSession.invoke({ team_id });
    // Fire-and-forget callers only use warmup as a hint; attach a no-op catch
    // so rejected warmups do not surface as unhandled promise rejections.
    void promise.catch(() => {});
    warmupPromiseRef.current = promise.finally(() => {
      warmupPromiseRef.current = null;
    });
    return warmupPromiseRef.current;
  }, [team_id]);

  const propagateMode = useCallback(
    (mode: string) => {
      // 1) Persist on the team so newly spawned agents inherit it.
      // 2) Fan-out to every live member conversation so approval mode stays consistent.
      void (async () => {
        try {
          await ipcBridge.team.setSessionMode.invoke({ team_id, session_mode: mode });
        } catch {
          // Best-effort persist — still try per-member fan-out.
        }

        const uniqueConversationIds = [...new Set(allConversationIds.filter(Boolean))];
        if (uniqueConversationIds.length === 0) return;

        try {
          await warmupSession();
        } catch {
          // Fan-out may still succeed on already-attached members.
        }

        await Promise.allSettled(
          uniqueConversationIds.map(async (conversation_id) => {
            try {
              const response = await ipcBridge.team.getConfigOptions.invoke({ team_id, conversation_id });
              const approvalOption =
                findConfigOptionById(response.config_options, 'approval_mode') ||
                findConfigOption(response.config_options, 'mode', ['mode', 'approvalMode', 'approval_mode']);
              if (!approvalOption) return;
              if (approvalOption.current_value === mode) return;
              await ipcBridge.acpConversation.setConfigOption.invoke({
                conversation_id,
                option_id: approvalOption.id,
                value: mode,
              });
            } catch (error) {
              console.warn('[TeamPermission] failed to fan-out session mode', { conversation_id, mode, error });
            }
          })
        );
      })();
    },
    [allConversationIds, team_id, warmupSession]
  );

  const loadConfigOptions = useMemo(
    () =>
      createTeamConfigOptionsLoader({
        team_id,
        warmupSession,
        getConfigOptions: (targetTeamId, conversation_id) =>
          ipcBridge.team.getConfigOptions.invoke({ team_id: targetTeamId, conversation_id }),
        getTeamRuntimeModel: async (conversation_id) => {
          const conversation = await getConversationOrNull(conversation_id);
          if (conversation?.type !== 'acp') return undefined;
          return conversation.extra.team_runtime_model_id;
        },
        setConfigOption: (conversation_id, option_id, value) =>
          ipcBridge.acpConversation.setConfigOption.invoke({ conversation_id, option_id, value }),
      }),
    [team_id, warmupSession]
  );

  const contextRelaySupportedConversationIdSet = useMemo(
    () => new Set(contextRelaySupportedConversationIds ?? contextRelayConversationIds),
    [contextRelayConversationIds, contextRelaySupportedConversationIds]
  );
  const contextRelayRebuildConversationIdSet = useMemo(
    () => new Set(contextRelayRebuildConversationIds),
    [contextRelayRebuildConversationIds]
  );
  const getContextRelayAvailability = useCallback(
    (conversationId: string): TeamContextRelayAvailability => {
      if (!contextRelaySupportedConversationIdSet.has(conversationId)) return 'unsupported';
      if (contextRelayRebuildConversationIdSet.has(conversationId)) {
        const rebuildWaiting = contextRelayRebuildTemporarilyUnavailable ?? contextRelayTemporarilyUnavailable;
        return rebuildWaiting ? 'waiting' : 'available';
      }
      return contextRelayTemporarilyUnavailable ? 'waiting' : 'available';
    },
    [
      contextRelayRebuildConversationIdSet,
      contextRelayRebuildTemporarilyUnavailable,
      contextRelaySupportedConversationIdSet,
      contextRelayTemporarilyUnavailable,
    ]
  );
  const getContextRelayMode = useCallback(
    (conversationId: string): TeamContextRelayMode | null => {
      if (!contextRelaySupportedConversationIdSet.has(conversationId)) return null;
      return contextRelayRebuildConversationIdSet.has(conversationId) ? 'team_rebuild' : 'member_replace';
    },
    [contextRelayRebuildConversationIdSet, contextRelaySupportedConversationIdSet]
  );
  const canRelayContext = useCallback(
    (conversationId: string): boolean => getContextRelayAvailability(conversationId) === 'available',
    [getContextRelayAvailability]
  );
  const requestContextRelay = useCallback(
    async (conversationId: string): Promise<TeamContextRelayReplacement | void> => {
      if (!canRelayContext(conversationId) || !onRequestContextRelay) {
        throw new Error('This team conversation cannot be safely relayed');
      }
      return await onRequestContextRelay(conversationId);
    },
    [canRelayContext, onRequestContextRelay]
  );

  const value = useMemo<TeamPermissionContextValue>(
    () => ({
      isTeamMode: true,
      isLeaderAgent,
      leaderConversationId,
      allConversationIds,
      propagateMode,
      warmupSession,
      loadConfigOptions,
      canRelayContext,
      getContextRelayAvailability,
      getContextRelayMode,
      requestContextRelay,
      requestContextRelayConfirm,
      activateContextRelayReplacement,
    }),
    [
      isLeaderAgent,
      leaderConversationId,
      allConversationIds,
      propagateMode,
      warmupSession,
      loadConfigOptions,
      canRelayContext,
      getContextRelayAvailability,
      getContextRelayMode,
      requestContextRelay,
      requestContextRelayConfirm,
      activateContextRelayReplacement,
    ]
  );

  return <TeamPermissionContext.Provider value={value}>{children}</TeamPermissionContext.Provider>;
};

/**
 * Returns team permission context if inside a team, or null for standalone conversations.
 * This ensures all team-only logic is gated behind a null check — no impact on single agent mode.
 */
export const useTeamPermission = (): TeamPermissionContextValue | null => {
  return useContext(TeamPermissionContext);
};
