// @ts-nocheck
// src/renderer/pages/team/hooks/useTeamSession.ts
import { ipcBridge } from '@/common';
import { normalizeTeamStatus } from '@/common/adapter/teamMapper';
import type { TeamAssistantInput } from '@/common/adapter/teamMapper';
import type {
  ITeamAgentRemovedEvent,
  ITeamAgentRenamedEvent,
  ITeamAgentRuntimeStatusEvent,
  ITeamAgentSpawnedEvent,
  ITeamAgentStatusEvent,
  ITeamSessionChangedEvent,
  ITeamSessionStatusChangedEvent,
  ITeamTaskChangedEvent,
  TeamAssistant,
  TeammateStatus,
  TTeam,
} from '@/common/types/team/teamTypes';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { mutate as mutateSWR } from 'swr';
import {
  findConfigOption,
  hasObservedValue,
  revalidateAcpConfigOptions,
} from '@/renderer/hooks/agent/useAcpConfigOptions';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';
import {
  assistantToOption,
  resolveSyncCatalogAssistantOption,
  type TeamAssistantOption,
} from '../components/assistantSelectUtils';
import { resolveTeamAssistantSyncTarget, type TeamAssistantSyncTarget } from '../components/teamCreateModelResolver';
import {
  archiveTeamWithCronPause,
  removeTeamAssistantWithCronCleanup,
} from '../utils/removeTeamAssistantWithCronCleanup';
import { rebindTeamMemberCron } from '../utils/rebindTeamMemberCron';
import { captureTeamContextCheckpoint, restoreTeamContextCheckpoint } from '../utils/teamContextCheckpoint';
import { collectSettledSyncTargets } from '../utils/collectSettledSyncTargets';
import {
  applyTeamRuntimeStatusToMembershipMutationState,
  applyTeamSessionStatusToMembershipMutationState,
  createTeamMembershipMutationState,
  isTeamMembershipMutationBusy,
} from './teamMembershipMutationBusy';
import type { TeamWarmupPhase } from './useTeamWarmup';

type AgentStatusInfo = {
  slot_id: string;
  status: TeammateStatus;
  last_message?: string;
};

export type SyncAllTeamAssistantsResult = {
  synchronized: number;
  failed: number;
  /** First target-resolution or member-sync failure, when any failed. */
  firstError?: unknown;
  /** Present when the whole team was rebuilt to apply system assistant configs. */
  replacementTeam?: TTeam;
};

export type TeamAssistantSyncOptions = {
  preserveContext?: boolean;
  restartAll?: boolean;
};

/** How team context relay materializes for a conversation. */
export type TeamContextRelayMode = 'member_replace' | 'team_rebuild';

export type TeamContextRelayIntent =
  | { kind: 'member'; slotId: string }
  | { kind: 'leader' }
  | { kind: 'conversation'; conversationId: string };

export type TeamContextRelayResult = {
  mode: TeamContextRelayMode;
  teamId: string;
  conversationId: string;
  slotId?: string;
  replacementTeam?: TTeam;
};

/** One member of a full-team rebuild: the current record plus its create input. */
type TeamRebuildMember = {
  assistant: TeamAssistant;
  input: TeamAssistantInput;
  connectionProfile?: TeamAssistantSyncTarget['connectionProfile'];
  runtimeModel?: string;
};

const reapplyAgentConnectionProfile = async (
  connectionProfile: NonNullable<TeamAssistantSyncTarget['connectionProfile']>
): Promise<void> => {
  const { agentId, config } = connectionProfile;
  await ipcBridge.acpConversation.setAgentConnectionProfiles.invoke({
    id: agentId,
    command_override: config.command_override,
    active_profile_id: config.active_profile_id,
    profiles: config.profiles
      .filter((profile) => !profile.is_builtin)
      .map(({ id, name, provider_id, model_id, env_override }) => ({
        id,
        name,
        provider_id,
        model_id,
        env_override,
      })),
  });
};

const reapplyRebuiltTeamConnectionProfiles = async (members: TeamRebuildMember[]): Promise<void> => {
  const profilesByAgentId = new Map<string, NonNullable<TeamAssistantSyncTarget['connectionProfile']>>();
  for (const { connectionProfile } of members) {
    if (connectionProfile && !profilesByAgentId.has(connectionProfile.agentId)) {
      profilesByAgentId.set(connectionProfile.agentId, connectionProfile);
    }
  }
  await Promise.all(Array.from(profilesByAgentId.values(), reapplyAgentConnectionProfile));
};

type TeamContextRelayJournal = {
  version: 1;
  team_id: string;
  phase: 'prepared' | 'replacement_created';
  source_assistant: TeamAssistant;
  checkpoint: string;
  known_slot_ids: string[];
  replacement?: Pick<TeamAssistant, 'slot_id' | 'conversation_id'>;
  updated_at: number;
};

const TEAM_CONTEXT_RELAY_JOURNAL_PREFIX = 'aionui_team_context_relay_';

const teamContextRelayJournalKey = (teamId: string): string => `${TEAM_CONTEXT_RELAY_JOURNAL_PREFIX}${teamId}`;

const readTeamContextRelayJournal = (teamId: string): TeamContextRelayJournal | undefined => {
  if (typeof localStorage === 'undefined') return undefined;
  const stored = localStorage.getItem(teamContextRelayJournalKey(teamId));
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored) as Partial<TeamContextRelayJournal>;
    if (
      parsed.version !== 1 ||
      parsed.team_id !== teamId ||
      (parsed.phase !== 'prepared' && parsed.phase !== 'replacement_created') ||
      typeof parsed.checkpoint !== 'string' ||
      !parsed.source_assistant ||
      typeof parsed.source_assistant.slot_id !== 'string' ||
      typeof parsed.source_assistant.conversation_id !== 'string' ||
      !Array.isArray(parsed.known_slot_ids)
    ) {
      return undefined;
    }
    return parsed as TeamContextRelayJournal;
  } catch {
    return undefined;
  }
};

const writeTeamContextRelayJournal = (journal: TeamContextRelayJournal): void => {
  if (typeof localStorage === 'undefined') throw new Error('Durable team relay storage is unavailable');
  localStorage.setItem(teamContextRelayJournalKey(journal.team_id), JSON.stringify(journal));
};

const clearTeamContextRelayJournal = (teamId: string): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(teamContextRelayJournalKey(teamId));
};

const relayAssistantInput = (assistant: TeamAssistant): TeamAssistantInput => ({
  role: 'teammate',
  assistant_name: assistant.assistant_name,
  assistant_id: assistant.assistant_id,
  model: assistant.model,
});

/**
 * Error fragments that clearly indicate the member runtime is unavailable or
 * the agent could not observe the config change. Only these justify escalating
 * an in-place model sync into a destroy + recreate of the member.
 */
const RUNTIME_UNAVAILABLE_ERROR_PATTERNS = [
  'runtime not ready',
  'runtime not available',
  'runtime unavailable',
  'runtime failed',
  'not confirmed by the agent',
  'session not found',
  'no active session',
  'session stopped',
  'session closed',
  'session is not running',
  'not attached',
];

/**
 * When in-place model sync fails because the member runtime is dead or the agent
 * cannot confirm config options, fall back to remove+recreate (same path as an
 * Agent change). Keep hard config errors as hard failures so we do not thrash,
 * and treat unknown/transient errors (e.g. a network blip) as hard failures too
 * so a model-only sync never silently destroys and recreates the whole member.
 */
export function shouldFallbackToMemberReplace(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim().toLowerCase();
  if (!message) return false;
  if (message.includes('cannot be synchronized')) return false;
  if (message.includes('not available for this team member')) return false;
  if (message.includes('old member removal failed')) return false;
  return RUNTIME_UNAVAILABLE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function settleSequentially<TItem, TResult>(
  items: TItem[],
  operation: (item: TItem) => Promise<TResult>
): Promise<PromiseSettledResult<TResult>[]> {
  return items.reduce<Promise<PromiseSettledResult<TResult>[]>>(async (resultsPromise, item) => {
    const results = await resultsPromise;
    try {
      const value = await operation(item);
      return [...results, { status: 'fulfilled', value }];
    } catch (reason) {
      return [...results, { status: 'rejected', reason }];
    }
  }, Promise.resolve([]));
}

export function useTeamSession(team: TTeam, warmupPhase?: TeamWarmupPhase, contextRelaySafe = false) {
  const { mutate: mutateTeam } = useSWR(team.id ? `team/${team.id}` : null, () =>
    ipcBridge.team.get.invoke({ id: team.id })
  );

  const [statusMap, setStatusMap] = useState<Map<string, AgentStatusInfo>>(() => {
    return new Map(
      team.assistants.map((a) => [a.slot_id, { slot_id: a.slot_id, status: a.status, last_message: a.last_message }])
    );
  });
  const [syncingSlotIds, setSyncingSlotIds] = useState<Set<string>>(() => new Set());
  const [relayingSlotIds, setRelayingSlotIds] = useState<Set<string>>(() => new Set());
  const structuralOperationRef = useRef<symbol | null>(null);
  const [structuralOperationBusy, setStructuralOperationBusy] = useState(false);
  const contextRelaySafeRef = useRef(contextRelaySafe);
  contextRelaySafeRef.current = contextRelaySafe;
  const [membershipMutationState, setMembershipMutationState] = useState(createTeamMembershipMutationState);
  const externalMembershipMutationBusy = isTeamMembershipMutationBusy(membershipMutationState);
  const externalMembershipMutationBusyRef = useRef(externalMembershipMutationBusy);
  externalMembershipMutationBusyRef.current = externalMembershipMutationBusy;
  const membershipMutationBusy = externalMembershipMutationBusy || structuralOperationBusy;

  /**
   * Hard ceiling for membership ops so a hung IPC cannot freeze add/remove/sync forever.
   * The underlying request may still complete later; we only release the UI lock.
   */
  const STRUCTURAL_OPERATION_TIMEOUT_MS = 120_000;

  const acquireStructuralOperation = useCallback((operation: string): (() => void) => {
    if (externalMembershipMutationBusyRef.current || structuralOperationRef.current) {
      throw new Error(`A team membership operation is already in progress (${operation})`);
    }
    const token = Symbol(operation);
    structuralOperationRef.current = token;
    setStructuralOperationBusy(true);
    const timeoutId = window.setTimeout(() => {
      if (structuralOperationRef.current !== token) return;
      structuralOperationRef.current = null;
      setStructuralOperationBusy(false);
      console.error(
        `[useTeamSession] structural operation timed out after ${STRUCTURAL_OPERATION_TIMEOUT_MS}ms: ${operation}`
      );
    }, STRUCTURAL_OPERATION_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeoutId);
      if (structuralOperationRef.current !== token) return;
      structuralOperationRef.current = null;
      setStructuralOperationBusy(false);
    };
  }, []);

  useEffect(() => {
    if (warmupPhase === 'ready' || warmupPhase === 'error') {
      setMembershipMutationState(createTeamMembershipMutationState());
    }
  }, [team.id, warmupPhase]);

  useEffect(() => {
    const journal = readTeamContextRelayJournal(team.id);
    if (!journal) return;

    void (async () => {
      let releaseOperation: (() => void) | undefined;
      try {
        releaseOperation = acquireStructuralOperation('recover context relay');
        setRelayingSlotIds((previous) => new Set(previous).add(journal.source_assistant.slot_id));
        const latestTeam = await ipcBridge.team.get.invoke({ id: team.id });
        const sourceStillPresent = latestTeam.assistants.some(
          (assistant) => assistant.conversation_id === journal.source_assistant.conversation_id
        );
        if (sourceStillPresent) {
          clearTeamContextRelayJournal(team.id);
          return;
        }

        let recoveredAssistant = journal.replacement
          ? latestTeam.assistants.find(
              (assistant) =>
                assistant.slot_id === journal.replacement?.slot_id &&
                assistant.conversation_id === journal.replacement.conversation_id
            )
          : undefined;
        recoveredAssistant ??= latestTeam.assistants.find(
          (assistant) =>
            !journal.known_slot_ids.includes(assistant.slot_id) &&
            assistant.role === 'teammate' &&
            assistant.assistant_id === journal.source_assistant.assistant_id &&
            assistant.assistant_name === journal.source_assistant.assistant_name
        );
        recoveredAssistant ??= await ipcBridge.team.addAgent.invoke({
          team_id: team.id,
          assistant: relayAssistantInput(journal.source_assistant),
        });
        await restoreTeamContextCheckpoint(
          recoveredAssistant.conversation_id,
          journal.checkpoint,
          journal.source_assistant.conversation_id
        );
        clearTeamContextRelayJournal(team.id);
        await mutateTeam();
      } catch (error) {
        console.error('[useTeamSession] failed to recover interrupted context relay', error);
      } finally {
        setRelayingSlotIds((previous) => {
          const next = new Set(previous);
          next.delete(journal.source_assistant.slot_id);
          return next;
        });
        releaseOperation?.();
      }
    })();
  }, [acquireStructuralOperation, mutateTeam, team.id]);

  useEffect(() => {
    const unsubStatus = ipcBridge.team.agentStatusChanged.on((event: ITeamAgentStatusEvent) => {
      if (event.team_id !== team.id) return;
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.set(event.slot_id, {
          slot_id: event.slot_id,
          status: normalizeTeamStatus(event.status),
          last_message: event.last_message,
        });
        return next;
      });
    });

    const unsubSpawned = ipcBridge.team.agentSpawned.on((event: ITeamAgentSpawnedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubRemoved = ipcBridge.team.agentRemoved.on((event: ITeamAgentRemovedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubRenamed = ipcBridge.team.agentRenamed.on((event: ITeamAgentRenamedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubRuntimeStatus = ipcBridge.team.agentRuntimeStatusChanged.on((event: ITeamAgentRuntimeStatusEvent) => {
      if (event.team_id !== team.id) return;
      setMembershipMutationState((prev) =>
        applyTeamRuntimeStatusToMembershipMutationState(prev, event.slot_id, event.status)
      );
      if (event.status !== 'ready') return;
      void revalidateAcpConfigOptions(event.conversation_id);
    });

    const unsubSessionStatus = ipcBridge.team.sessionStatusChanged.on((event: ITeamSessionStatusChangedEvent) => {
      if (event.team_id !== team.id) return;
      setMembershipMutationState((prev) => applyTeamSessionStatusToMembershipMutationState(prev, event.status));
    });

    const unsubTaskChanged = ipcBridge.team.taskChanged.on((event: ITeamTaskChangedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    const unsubSessionChanged = ipcBridge.team.sessionChanged.on((event: ITeamSessionChangedEvent) => {
      if (event.team_id !== team.id) return;
      void mutateTeam();
    });

    return () => {
      unsubStatus();
      unsubSpawned();
      unsubRemoved();
      unsubRenamed();
      unsubRuntimeStatus();
      unsubSessionStatus();
      unsubTaskChanged();
      unsubSessionChanged();
    };
  }, [team.id, mutateTeam]);

  const addAssistant = useCallback(
    async (assistant: TeamAssistantInput): Promise<TeamAssistant> => {
      const releaseOperation = acquireStructuralOperation('add member');
      try {
        const created = await ipcBridge.team.addAgent.invoke({ team_id: team.id, assistant });
        await mutateTeam();
        return created;
      } finally {
        releaseOperation();
      }
    },
    [acquireStructuralOperation, team.id, mutateTeam]
  );

  const renameAssistant = useCallback(
    async (slot_id: string, new_name: string) => {
      await ipcBridge.team.renameAgent.invoke({ team_id: team.id, slot_id, new_name });
      await mutateTeam();
    },
    [team.id, mutateTeam]
  );

  const removeAssistant = useCallback(
    async (slot_id: string) => {
      const releaseOperation = acquireStructuralOperation('remove member');
      try {
        await removeTeamAssistantWithCronCleanup({
          team,
          slot_id,
          getConversation: getConversationOrNull,
          removeCronJob: (job_id) => ipcBridge.cron.removeJob.invoke({ job_id }),
          removeAgent: (params) => ipcBridge.team.removeAgent.invoke(params),
        });
        await mutateTeam();
      } finally {
        releaseOperation();
      }
    },
    [acquireStructuralOperation, team, mutateTeam]
  );

  const loadSyncCatalog = useCallback(async (): Promise<TeamAssistantOption[]> => {
    try {
      const assistants = (await ipcBridge.assistants.list.invoke()) ?? [];
      if (!Array.isArray(assistants)) {
        console.error('[useTeamSession] assistants.list returned non-array', assistants);
        return [];
      }
      return assistants.map((assistant) => assistantToOption(assistant));
    } catch (error) {
      console.error('[useTeamSession] failed to load assistant catalog for sync', error);
      return [];
    }
  }, []);

  const resolveMemberSyncTarget = useCallback(
    async (assistant: TeamAssistant, catalog: TeamAssistantOption[]): Promise<TeamAssistantSyncTarget> => {
      const matched = resolveSyncCatalogAssistantOption(assistant, catalog);
      const matchedCanProvision = matched?.team_selectable !== false;
      const assistantId = matchedCanProvision
        ? matched?.id || assistant.assistant_id || ''
        : assistant.assistant_id || '';
      return resolveTeamAssistantSyncTarget({
        assistant_id: assistantId,
        assistant_backend: matchedCanProvision
          ? matched?.backend || assistant.assistant_backend
          : assistant.assistant_backend,
        useRememberedModel: true,
        useConnectionProfileModel: true,
      });
    },
    []
  );

  const removeRelayAssistantSafely = useCallback(
    async (assistant: TeamAssistant): Promise<void> => {
      const conversation = await getConversationOrNull(assistant.conversation_id);
      if (resolveCronJobId(conversation?.extra)) {
        throw new Error('A team member with a scheduled task cannot be safely relayed');
      }
      await ipcBridge.team.removeAgent.invoke({ team_id: team.id, slot_id: assistant.slot_id });
      const conversationAfterRemoval = await getConversationOrNull(assistant.conversation_id);
      const lateCronJobId = resolveCronJobId(conversationAfterRemoval?.extra);
      if (lateCronJobId) {
        await ipcBridge.cron.removeJob.invoke({ job_id: lateCronJobId });
      }
    },
    [team.id]
  );

  const replaceAssistant = useCallback(
    async (
      assistant: TeamAssistant,
      target: TeamAssistantSyncTarget,
      contextCheckpoint?: string,
      options: {
        rejectCron?: boolean;
        preserveContext?: boolean;
        onReplacementCreated?: (replacement: TeamAssistant) => void;
      } = {}
    ): Promise<TeamAssistant> => {
      const shouldRestoreContext = options.preserveContext || Boolean(contextCheckpoint);
      // Remove first so the backend can await the old ACP process terminating
      // before the replacement is persisted. Adding first leaves both
      // processes resident and can exhaust the ACP resident limit on the next
      // session warmup.
      let preservedCronJobId: string | undefined;
      if (options.rejectCron) {
        await removeRelayAssistantSafely(assistant);
      } else {
        preservedCronJobId = await removeTeamAssistantWithCronCleanup({
          team,
          slot_id: assistant.slot_id,
          getConversation: getConversationOrNull,
          removeCronJob: (job_id) => ipcBridge.cron.removeJob.invoke({ job_id }),
          removeAgent: (params) => ipcBridge.team.removeAgent.invoke(params),
          // Sync replace should rebind schedules onto the new conversation (audit P1-21).
          preserveCron: true,
        });
      }

      const restoreOriginalAssistant = async (): Promise<void> => {
        const rollback = await ipcBridge.team.addAgent.invoke({
          team_id: team.id,
          assistant: {
            role: 'teammate',
            assistant_name: assistant.assistant_name,
            assistant_id: assistant.assistant_id,
            model: assistant.model,
          },
        });
        if (shouldRestoreContext) {
          await restoreTeamContextCheckpoint(rollback.conversation_id, contextCheckpoint, assistant.conversation_id);
        }
      };

      let replacement: TeamAssistant;
      try {
        replacement = await ipcBridge.team.addAgent.invoke({
          team_id: team.id,
          assistant: {
            role: 'teammate',
            assistant_name: assistant.assistant_name,
            // Rematched catalog id so recreate applies system assistant rules /
            // agent / defaults instead of re-seeding a bare engine.
            assistant_id: target.assistantId || assistant.assistant_id,
            model: target.model,
          },
        });
      } catch (replacementError) {
        try {
          await restoreOriginalAssistant();
        } catch (rollbackError) {
          throw new Error('The replacement failed and the previous team member could not be restored', {
            cause: rollbackError,
          });
        }
        throw replacementError;
      }

      if (target.connectionProfile) {
        try {
          await reapplyAgentConnectionProfile(target.connectionProfile);
        } catch (profileError) {
          try {
            if (options.rejectCron) {
              await removeRelayAssistantSafely(replacement);
            } else {
              await ipcBridge.team.removeAgent.invoke({ team_id: team.id, slot_id: replacement.slot_id });
            }
            await restoreOriginalAssistant();
          } catch (rollbackError) {
            throw new Error('The replacement model sync failed and the previous team member could not be restored', {
              cause: rollbackError,
            });
          }
          throw profileError;
        }
      }
      options.onReplacementCreated?.(replacement);

      if (shouldRestoreContext) {
        try {
          await restoreTeamContextCheckpoint(replacement.conversation_id, contextCheckpoint, assistant.conversation_id);
        } catch (restoreError) {
          try {
            if (options.rejectCron) {
              await removeRelayAssistantSafely(replacement);
            } else {
              await ipcBridge.team.removeAgent.invoke({ team_id: team.id, slot_id: replacement.slot_id });
            }
            await restoreOriginalAssistant();
          } catch (rollbackError) {
            throw new Error('The replacement handoff failed and the previous team member could not be restored', {
              cause: rollbackError,
            });
          }
          throw restoreError;
        }
      }

      if (preservedCronJobId && !options.rejectCron) {
        try {
          await rebindTeamMemberCron({
            previousJobId: preservedCronJobId,
            nextConversationId: replacement.conversation_id,
            deps: {
              getJob: (job_id) => ipcBridge.cron.getJob.invoke({ job_id }),
              addJob: (params) => ipcBridge.cron.addJob.invoke(params),
              removeJob: (job_id) => ipcBridge.cron.removeJob.invoke({ job_id }),
              stampConversationCron: (conversation_id, cron_job_id) =>
                ipcBridge.conversation.update.invoke({
                  id: conversation_id,
                  merge_extra: true,
                  updates: { extra: { cron_job_id } as never },
                }),
            },
          });
        } catch (cronError) {
          console.warn('[useTeamSession] failed to rebind scheduled task after member replace', cronError);
        }
      }

      return replacement;
    },
    [removeRelayAssistantSafely, team]
  );

  const syncModelInPlace = useCallback(
    async (assistant: TeamAssistant, target: TeamAssistantSyncTarget): Promise<TeamAssistant> => {
      const targetModel = target.runtimeModel ?? target.model;
      const targetModelMode = target.runtimeModel ? 'auto' : target.modelMode;
      const response = await ipcBridge.team.getConfigOptions.invoke({
        team_id: team.id,
        conversation_id: assistant.conversation_id,
      });
      const modelOption = findConfigOption(response.config_options, 'model', ['model']);
      const modelAvailable =
        Boolean(modelOption) && modelOption!.options.some((option) => option.value === targetModel);

      // Fixed defaults must be applied or the sync is a hard failure. Auto-mode
      // seeds are best-effort and cannot override an unavailable runtime option.
      if (!modelAvailable) {
        if (targetModelMode === 'fixed') {
          throw new Error('The configured model is not available for this team member');
        }
        return assistant;
      }

      if (modelOption!.current_value !== targetModel) {
        const updated = await ipcBridge.acpConversation.setConfigOption.invoke({
          conversation_id: assistant.conversation_id,
          option_id: modelOption!.id,
          value: targetModel,
        });
        if (!hasObservedValue(updated, modelOption!.id, targetModel)) {
          throw new Error('The model change was not confirmed by the agent');
        }
      }

      await ipcBridge.conversation.update.invoke({
        id: assistant.conversation_id,
        merge_extra: true,
        updates: { extra: { team_runtime_model_id: targetModel } as never },
      });
      void revalidateAcpConfigOptions(assistant.conversation_id);
      // Refresh roster so dashboard/group initial model chips leave the stale value.
      await mutateTeam();
      return { ...assistant, model: targetModel };
    },
    [mutateTeam, team.id]
  );

  const syncAssistant = useCallback(
    async (slot_id: string, options: TeamAssistantSyncOptions = {}): Promise<TeamAssistant> => {
      const assistant = team.assistants.find((item) => item.slot_id === slot_id);
      if (!assistant || assistant.role === 'leader' || !assistant.assistant_id) {
        throw new Error('This team member cannot be synchronized');
      }
      const releaseOperation = acquireStructuralOperation('sync member');

      setSyncingSlotIds((prev) => {
        const next = new Set(prev);
        next.add(slot_id);
        return next;
      });
      try {
        const catalog = await loadSyncCatalog();
        const target = await resolveMemberSyncTarget(assistant, catalog);
        const sameAssistant = (assistant.assistant_id || '') === target.assistantId;
        const sameBackend = assistant.assistant_backend === target.assistantBackend;
        if (sameAssistant && sameBackend) {
          try {
            return await syncModelInPlace(assistant, target);
          } catch (error) {
            // Runtime-failed members cannot answer getConfigOptions/setConfigOption.
            // Rebuild the slot the same way "sync all" does so single-member sync
            // matches whole-team success for custom agents + Grok.
            if (!shouldFallbackToMemberReplace(error)) {
              throw error;
            }
            console.warn('[useTeamSession] in-place sync failed; falling back to member replace', error);
          }
        }

        const contextCheckpoint = options.preserveContext
          ? await captureTeamContextCheckpoint(assistant.conversation_id)
          : undefined;
        await ipcBridge.team.stop.invoke({ team_id: team.id });
        const replacement = await replaceAssistant(assistant, target, contextCheckpoint, {
          preserveContext: options.preserveContext,
        });
        await mutateTeam();
        return replacement;
      } finally {
        setSyncingSlotIds((prev) => {
          const next = new Set(prev);
          next.delete(slot_id);
          return next;
        });
        releaseOperation();
      }
    },
    [
      acquireStructuralOperation,
      loadSyncCatalog,
      mutateTeam,
      replaceAssistant,
      resolveMemberSyncTarget,
      syncModelInPlace,
      team,
    ]
  );

  const relayAssistant = useCallback(
    async (slot_id: string): Promise<TeamAssistant> => {
      const assistant = team.assistants.find((item) => item.slot_id === slot_id);
      if (!assistant) throw new Error('This team member could not be found');
      if (assistant.role === 'leader') {
        throw new Error('The team leader cannot be safely relayed with the current team API');
      }
      if (!assistant.assistant_id) throw new Error('This team member cannot be relayed');
      if (!contextRelaySafeRef.current) throw new Error('The team must be idle before relaying a member');
      const releaseOperation = acquireStructuralOperation('relay member');

      try {
        const conversation = await getConversationOrNull(assistant.conversation_id);
        if (resolveCronJobId(conversation?.extra)) {
          throw new Error('A team member with a scheduled task cannot be safely relayed');
        }

        setRelayingSlotIds((previous) => new Set(previous).add(slot_id));
        try {
          await ipcBridge.team.stop.invoke({ team_id: team.id });
          const contextCheckpoint = await captureTeamContextCheckpoint(assistant.conversation_id);
          if (!contextCheckpoint) throw new Error('No reusable context was available for this team member');
          if (externalMembershipMutationBusyRef.current) {
            throw new Error('A team membership mutation started before context relay could continue');
          }
          if (!contextRelaySafeRef.current) throw new Error('The team became busy before context relay could start');

          const latestTeam = await ipcBridge.team.get.invoke({ id: team.id });
          const latestAssistant = latestTeam.assistants.find((item) => item.slot_id === slot_id);
          if (
            !latestAssistant ||
            latestAssistant.role !== 'teammate' ||
            latestAssistant.conversation_id !== assistant.conversation_id ||
            latestAssistant.assistant_id !== assistant.assistant_id ||
            latestAssistant.assistant_backend !== assistant.assistant_backend ||
            latestAssistant.assistant_name !== assistant.assistant_name ||
            latestAssistant.model !== assistant.model
          ) {
            throw new Error('The team member changed while context relay was being prepared');
          }

          const latestConversation = await getConversationOrNull(latestAssistant.conversation_id);
          if (resolveCronJobId(latestConversation?.extra)) {
            throw new Error('A team member with a scheduled task cannot be safely relayed');
          }
          if (externalMembershipMutationBusyRef.current) {
            throw new Error('A team membership mutation started before context relay could continue');
          }
          if (!contextRelaySafeRef.current) throw new Error('The team became busy before context relay could start');

          const journal: TeamContextRelayJournal = {
            version: 1,
            team_id: team.id,
            phase: 'prepared',
            source_assistant: latestAssistant,
            checkpoint: contextCheckpoint,
            known_slot_ids: latestTeam.assistants.map((item) => item.slot_id),
            updated_at: Date.now(),
          };
          writeTeamContextRelayJournal(journal);
          const replacement = await replaceAssistant(
            latestAssistant,
            {
              assistantId: latestAssistant.assistant_id,
              assistantBackend: latestAssistant.assistant_backend,
              model: latestAssistant.model || 'default',
              modelMode: 'auto',
            },
            contextCheckpoint,
            {
              rejectCron: true,
              preserveContext: true,
              onReplacementCreated: (createdReplacement) => {
                writeTeamContextRelayJournal({
                  ...journal,
                  phase: 'replacement_created',
                  replacement: {
                    slot_id: createdReplacement.slot_id,
                    conversation_id: createdReplacement.conversation_id,
                  },
                  updated_at: Date.now(),
                });
              },
            }
          );
          clearTeamContextRelayJournal(team.id);
          await mutateTeam();
          return replacement;
        } finally {
          setRelayingSlotIds((previous) => {
            const next = new Set(previous);
            next.delete(slot_id);
            return next;
          });
        }
      } finally {
        releaseOperation();
      }
    },
    [acquireStructuralOperation, mutateTeam, replaceAssistant, team]
  );

  const rebuildTeamFromSystemAssistants = useCallback(
    async (members: TeamRebuildMember[], options: TeamAssistantSyncOptions): Promise<TTeam> => {
      // Preserve leader first so the backend receives exactly one lead role.
      // The submitted agent order matches `created.assistants`, so context
      // checkpoints are mapped by position — duplicate member names (the create
      // modal allows adding the same assistant twice) must not cross-restore.
      const ordered = [
        ...members.filter(({ assistant }) => assistant.role === 'leader'),
        ...members.filter(({ assistant }) => assistant.role !== 'leader'),
      ];

      const checkpoints = new Map<number, string>();
      if (options.preserveContext) {
        const checkpointResults = await Promise.allSettled(
          ordered.map(({ assistant }) => captureTeamContextCheckpoint(assistant.conversation_id))
        );
        checkpointResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            checkpoints.set(index, result.value);
          }
        });
      }

      try {
        await ipcBridge.team.stop.invoke({ team_id: team.id });
      } catch {
        // Best-effort: create/delete still proceeds if the session is already gone.
      }

      const created = await ipcBridge.team.create.invoke({
        user_id: team.user_id,
        name: team.name,
        workspace: team.workspace,
        workspace_mode: team.workspace_mode,
        agents: ordered.map(({ input }) => input),
      });
      const bridgeError = created as unknown as { __bridgeError?: boolean; message?: string };
      if (bridgeError.__bridgeError) {
        throw new Error(bridgeError.message || 'Failed to rebuild team from system assistants');
      }

      try {
        await reapplyRebuiltTeamConnectionProfiles(ordered);
      } catch (profileError) {
        try {
          await ipcBridge.team.remove.invoke({ id: created.id });
        } catch (cleanupError) {
          throw new Error('The rebuilt team model sync failed and the incomplete team could not be removed', {
            cause: cleanupError,
          });
        }
        throw profileError;
      }

      // team.create does not carry session_mode, so re-apply the previous
      // permission mode on the rebuilt team. Best-effort: the rebuilt team
      // stays usable with the default mode when this fails.
      if (team.session_mode) {
        try {
          await ipcBridge.team.setSessionMode.invoke({ team_id: created.id, session_mode: team.session_mode });
        } catch (error) {
          console.warn('[useTeamSession] failed to restore session_mode on rebuilt team', error);
        }
      }

      if (options.preserveContext) {
        const restoreResults = await Promise.allSettled(
          created.assistants.map(async (member, index) => {
            const checkpoint = checkpoints.get(index);
            await restoreTeamContextCheckpoint(
              member.conversation_id,
              checkpoint,
              ordered[index].assistant.conversation_id
            );
          })
        );
        const restoreFailure = restoreResults.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (restoreFailure) {
          try {
            await ipcBridge.team.remove.invoke({ id: created.id });
          } catch (cleanupError) {
            console.warn('[useTeamSession] failed to remove incomplete rebuilt team', cleanupError);
          }
          throw restoreFailure.reason;
        }
      }

      const runtimeTargets = created.assistants
        .map((member, index) => ({ member, runtimeModel: ordered[index]?.runtimeModel }))
        .filter((item): item is { member: TeamAssistant; runtimeModel: string } => Boolean(item.runtimeModel));
      const runtimeModelsByConversationId = new Map(
        runtimeTargets.map(({ member, runtimeModel }) => [member.conversation_id, runtimeModel])
      );
      if (runtimeTargets.length > 0) {
        const runtimeStampResults = await Promise.allSettled(
          runtimeTargets.map(async ({ member, runtimeModel }) => {
            try {
              const response = await ipcBridge.team.getConfigOptions.invoke({
                team_id: created.id,
                conversation_id: member.conversation_id,
              });
              const modelOption = findConfigOption(response.config_options, 'model', ['model']);
              const modelAvailable =
                Boolean(modelOption) && modelOption!.options.some((option) => option.value === runtimeModel);
              if (modelAvailable && modelOption!.current_value !== runtimeModel) {
                const updated = await ipcBridge.acpConversation.setConfigOption.invoke({
                  conversation_id: member.conversation_id,
                  option_id: modelOption!.id,
                  value: runtimeModel,
                });
                if (!hasObservedValue(updated, modelOption!.id, runtimeModel)) {
                  console.warn('[useTeamSession] rebuilt team runtime model was not confirmed by the agent', {
                    conversationId: member.conversation_id,
                    runtimeModel,
                  });
                }
              }
            } catch (error) {
              console.warn('[useTeamSession] rebuilt team runtime config was not ready for model sync', error);
            }

            await ipcBridge.conversation.update.invoke({
              id: member.conversation_id,
              merge_extra: true,
              updates: { extra: { team_runtime_model_id: runtimeModel } as never },
            });
            void revalidateAcpConfigOptions(member.conversation_id);
          })
        );
        runtimeStampResults.forEach((result) => {
          if (result.status === 'rejected') {
            console.warn('[useTeamSession] failed to stamp rebuilt team runtime model snapshot', result.reason);
          }
        });
      }

      try {
        // Keep the old team and all of its conversations/tasks as an archived
        // snapshot. Its schedules are paused so the historical team cannot
        // continue running after the rebuilt team becomes active.
        await archiveTeamWithCronPause({
          team,
          getConversation: getConversationOrNull,
          pauseCronJob: async (job_id) => {
            await ipcBridge.cron.updateJob.invoke({ job_id, updates: { enabled: false } });
          },
          resumeCronJob: async (job_id) => {
            await ipcBridge.cron.updateJob.invoke({ job_id, updates: { enabled: true } });
          },
          archiveTeam: (params) => ipcBridge.team.archive.invoke(params),
        });
      } catch (archiveError) {
        // Fail closed: never leave old + new teams both live after a "rebuild".
        // Roll back the newly created team when archive of the previous snapshot fails.
        try {
          await ipcBridge.team.remove.invoke({ id: created.id });
        } catch (cleanupError) {
          console.error('[useTeamSession] archive failed and rollback of rebuilt team also failed — dual-active risk', {
            archiveError,
            cleanupError,
            oldTeamId: team.id,
            newTeamId: created.id,
          });
          throw new Error(
            'Team rebuild created a new team but could not archive the previous one, and rollback of the new team failed. Resolve dual teams manually.',
            { cause: cleanupError }
          );
        }
        const detail =
          archiveError instanceof Error && archiveError.message.trim()
            ? archiveError.message.trim()
            : 'unknown archive error';
        throw new Error(`Team rebuild was rolled back because the previous team could not be archived (${detail}).`, {
          cause: archiveError,
        });
      }

      if (runtimeModelsByConversationId.size === 0) return created;
      const applyRuntimeModelSnapshot = (assistant: TeamAssistant): TeamAssistant => {
        const runtimeModel = runtimeModelsByConversationId.get(assistant.conversation_id);
        return runtimeModel ? { ...assistant, model: runtimeModel } : assistant;
      };
      const patchedCreated = {
        ...created,
        assistants: created.assistants.map(applyRuntimeModelSnapshot),
        agents: created.agents?.map(applyRuntimeModelSnapshot),
      };
      await mutateSWR(`team/${created.id}`, patchedCreated, false);
      return patchedCreated;
    },
    [team]
  );

  const syncAllAssistants = useCallback(
    async (options: TeamAssistantSyncOptions = {}): Promise<SyncAllTeamAssistantsResult> => {
      const teammates = team.assistants.filter(
        (assistant) => assistant.role !== 'leader' && Boolean(assistant.assistant_id)
      );
      const leader = team.assistants.find(
        (assistant) => assistant.role === 'leader' && Boolean(assistant.assistant_id)
      );
      const candidates = leader ? [...teammates, leader] : teammates;
      const releaseOperation = acquireStructuralOperation('sync all members');

      setSyncingSlotIds((prev) => new Set([...prev, ...candidates.map((assistant) => assistant.slot_id)]));
      try {
        const summary: SyncAllTeamAssistantsResult = { synchronized: 0, failed: 0 };
        const catalog = await loadSyncCatalog();
        const targetResults = await Promise.allSettled(
          candidates.map((assistant) => resolveMemberSyncTarget(assistant, catalog))
        );
        const { plans, failed: targetFailures, firstError: targetFirstError } = collectSettledSyncTargets(
          candidates,
          targetResults
        );
        summary.failed += targetFailures;
        if (targetFirstError !== undefined) {
          summary.firstError = targetFirstError;
        }

        if (plans.length === 0) return summary;

        // Full restart must rebind EVERY member (including the lead) to the system
        // assistant catalog. The lead slot cannot be remove/add'd, so rebuild the
        // whole team when restart is requested.
        if (options.restartAll) {
          const plannedSlotIds = new Set(plans.map(({ assistant }) => assistant.slot_id));
          const rebuildMembers: TeamRebuildMember[] = plans.map(({ assistant, target }) => ({
            assistant,
            connectionProfile: target.connectionProfile,
            runtimeModel: target.runtimeModel,
            input: {
              role: assistant.role === 'leader' ? 'leader' : 'teammate',
              assistant_name: assistant.assistant_name,
              assistant_id: target.assistantId,
              model: target.model,
            },
          }));
          // Members without a sync plan (runtime-spawned without an assistant_id,
          // or whose target could not be resolved) must survive the rebuild with
          // their original identity — a full restart never drops teammates.
          for (const assistant of team.assistants) {
            if (plannedSlotIds.has(assistant.slot_id)) continue;
            const matched = resolveSyncCatalogAssistantOption(assistant, catalog);
            const assistantId =
              assistant.assistant_id || (matched?.team_selectable !== false ? matched?.id : undefined) || '';
            if (!assistantId) {
              summary.failed += 1;
              continue;
            }
            rebuildMembers.push({
              assistant,
              input: {
                role: assistant.role === 'leader' ? 'leader' : 'teammate',
                assistant_name: assistant.assistant_name,
                assistant_id: assistantId,
                model: assistant.model,
              },
            });
          }
          try {
            const replacementTeam = await rebuildTeamFromSystemAssistants(rebuildMembers, options);
            return {
              synchronized: plans.length,
              failed: summary.failed,
              replacementTeam,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[useTeamSession] rebuildTeamFromSystemAssistants failed:', message, error);
            throw new Error(message || 'Failed to rebuild the team from system assistant configuration', {
              cause: error,
            });
          }
        }

        const teammatePlans = plans.filter(({ assistant }) => assistant.role !== 'leader');
        const leaderPlans = plans.filter(({ assistant }) => assistant.role === 'leader');

        const inPlaceTeammatePlans = teammatePlans.filter(
          ({ assistant, target }) =>
            (assistant.assistant_id || '') === target.assistantId &&
            assistant.assistant_backend === target.assistantBackend
        );
        const replacementPlans = teammatePlans.filter(
          ({ assistant, target }) =>
            (assistant.assistant_id || '') !== target.assistantId ||
            assistant.assistant_backend !== target.assistantBackend
        );

        const rememberFirstError = (results: ReadonlyArray<PromiseSettledResult<unknown>>) => {
          if (summary.firstError !== undefined) return;
          const rejected = results.find((result) => result.status === 'rejected');
          if (rejected && rejected.status === 'rejected') {
            summary.firstError = rejected.reason;
          }
        };

        const inPlaceResults = await Promise.allSettled(
          inPlaceTeammatePlans.map(({ assistant, target }) => syncModelInPlace(assistant, target))
        );
        summary.synchronized += inPlaceResults.filter((result) => result.status === 'fulfilled').length;
        summary.failed += inPlaceResults.filter((result) => result.status === 'rejected').length;
        rememberFirstError(inPlaceResults);

        if (replacementPlans.length > 0) {
          const checkpoints = new Map<string, string>();
          const checkpointFailures = new Set<string>();
          if (options.preserveContext) {
            const checkpointResults = await Promise.allSettled(
              replacementPlans.map(({ assistant }) => captureTeamContextCheckpoint(assistant.conversation_id))
            );
            checkpointResults.forEach((result, index) => {
              if (result.status === 'fulfilled' && result.value) {
                checkpoints.set(replacementPlans[index].assistant.slot_id, result.value);
              } else if (result.status === 'rejected') {
                checkpointFailures.add(replacementPlans[index].assistant.slot_id);
                if (summary.firstError === undefined) {
                  summary.firstError = result.reason;
                }
              }
            });
          }

          const restorablePlans = replacementPlans.filter(
            ({ assistant }) => !checkpointFailures.has(assistant.slot_id)
          );
          summary.failed += checkpointFailures.size;

          if (restorablePlans.length > 0) {
            let stopped = false;
            try {
              await ipcBridge.team.stop.invoke({ team_id: team.id });
              stopped = true;
            } catch (stopError) {
              summary.failed += restorablePlans.length;
              if (summary.firstError === undefined) {
                summary.firstError = stopError;
              }
            }

            if (stopped) {
              const replacementResults = await settleSequentially(restorablePlans, ({ assistant, target }) =>
                replaceAssistant(assistant, target, checkpoints.get(assistant.slot_id), {
                  preserveContext: options.preserveContext,
                })
              );
              summary.synchronized += replacementResults.filter((result) => result.status === 'fulfilled').length;
              summary.failed += replacementResults.filter((result) => result.status === 'rejected').length;
              rememberFirstError(replacementResults);
              await mutateTeam();
            }
          }
        }

        if (leaderPlans.length > 0) {
          const leaderResults = await Promise.allSettled(
            leaderPlans.map(({ assistant, target }) => syncModelInPlace(assistant, target))
          );
          summary.synchronized += leaderResults.filter((result) => result.status === 'fulfilled').length;
          summary.failed += leaderResults.filter((result) => result.status === 'rejected').length;
          rememberFirstError(leaderResults);
        }

        return summary;
      } finally {
        setSyncingSlotIds((prev) => {
          const next = new Set(prev);
          candidates.forEach((assistant) => next.delete(assistant.slot_id));
          return next;
        });
        releaseOperation();
      }
    },
    [
      acquireStructuralOperation,
      loadSyncCatalog,
      mutateTeam,
      rebuildTeamFromSystemAssistants,
      replaceAssistant,
      resolveMemberSyncTarget,
      syncModelInPlace,
      team,
    ]
  );

  const relayTeamContext = useCallback(
    async (
      intent: TeamContextRelayIntent,
      options: { preserveContext?: boolean } = {}
    ): Promise<TeamContextRelayResult> => {
      const preserveContext = options.preserveContext ?? true;

      let resolved: { kind: 'member'; slotId: string } | { kind: 'leader' };
      if (intent.kind === 'conversation') {
        const assistant = team.assistants.find((item) => item.conversation_id === intent.conversationId);
        if (!assistant) throw new Error('This team conversation could not be found');
        resolved = assistant.role === 'leader' ? { kind: 'leader' } : { kind: 'member', slotId: assistant.slot_id };
      } else {
        resolved = intent;
      }

      if (resolved.kind === 'member') {
        const replacement = await relayAssistant(resolved.slotId);
        return {
          mode: 'member_replace',
          teamId: team.id,
          conversationId: replacement.conversation_id,
          slotId: replacement.slot_id,
        };
      }

      const leader = team.assistants.find(
        (assistant) => assistant.role === 'leader' && Boolean(assistant.assistant_id)
      );
      if (!leader) throw new Error('The team leader cannot be relayed without a system assistant mapping');

      const result = await syncAllAssistants({ preserveContext, restartAll: true });
      const replacementTeam = result.replacementTeam;
      if (!replacementTeam) {
        throw new Error('Team context relay did not produce a rebuilt team');
      }
      const nextLeader =
        replacementTeam.assistants.find((assistant) => assistant.role === 'leader') ?? replacementTeam.assistants[0];
      if (!nextLeader) throw new Error('The rebuilt team has no leader conversation');

      return {
        mode: 'team_rebuild',
        teamId: replacementTeam.id,
        conversationId: nextLeader.conversation_id,
        slotId: nextLeader.slot_id,
        replacementTeam,
      };
    },
    [relayAssistant, syncAllAssistants, team.assistants, team.id]
  );

  return {
    statusMap,
    syncingSlotIds,
    relayingSlotIds,
    membershipMutationBusy,
    addAssistant,
    renameAssistant,
    removeAssistant,
    syncAssistant,
    relayAssistant,
    relayTeamContext,
    syncAllAssistants,
    mutateTeam,
  };
}
