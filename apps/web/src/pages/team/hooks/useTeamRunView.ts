// @ts-nocheck
import { ipcBridge } from '@/common';
import type {
  ITeamChildTurnEvent,
  ITeamRunAck,
  ITeamRunEvent,
  ITeamSlotWork,
  TeamRunStatus,
} from '@/common/types/team/teamTypes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type TeamRunViewRun = ITeamRunEvent;
export type TeamRunViewChildTurn = ITeamChildTurnEvent;

const TERMINAL_RUN_STATUSES = new Set<TeamRunStatus>(['completed', 'cancelled', 'failed']);

export type TeamRunViewState = {
  /** Whether an authoritative snapshot or realtime event has been applied. */
  hydrated: boolean;
  activeRun?: TeamRunViewRun;
  childTurnsBySlot: Record<string, TeamRunViewChildTurn | undefined>;
  slotWorkBySlot: Record<string, ITeamSlotWork | undefined>;
  /**
   * True when the team session was reclaimed by idle-cleanup (backend broadcast
   * `sessionStatusChanged` with status `stopped`). Event-driven and independent
   * of `slotWorkBySlot`, which is re-derived/emptied on reconcile and would
   * otherwise lose the stopped signal. Cleared on recovery (`starting`/`ready`)
   * or on any applied active run event (self-heal).
   */
  sessionStopped: boolean;
};

const emptyState: TeamRunViewState = {
  hydrated: false,
  activeRun: undefined,
  childTurnsBySlot: {},
  slotWorkBySlot: {},
  sessionStopped: false,
};

const CONTEXT_RELAY_BUSY_SLOT_STATES = new Set<ITeamSlotWork['state']>(['starting', 'running', 'queued']);

/** Context relay stops the shared team session, so every member must be at a safe boundary. */
export const isTeamContextRelaySafe = (state: TeamRunViewState): boolean =>
  !state.activeRun &&
  !Object.values(state.childTurnsBySlot).some(Boolean) &&
  !Object.values(state.slotWorkBySlot).some(
    (slotWork) => slotWork && CONTEXT_RELAY_BUSY_SLOT_STATES.has(slotWork.state)
  );

const isTeamRunDebugEnabled = process.env.NODE_ENV !== 'production';

const debugTeamRunEvent = (source: string, event: ITeamRunEvent) => {
  if (!isTeamRunDebugEnabled) return;
  console.debug('[Renderer:teamRunView] team_run_event_applied', {
    source,
    team_id: event.team_id,
    team_run_id: event.team_run_id,
    target_slot_id: event.target_slot_id,
    target_role: event.target_role,
    status: event.status,
    queued_intent_count: event.queued_intent_count,
    starting_batch_count: event.starting_batch_count,
    running_batch_count: event.running_batch_count,
    active_enqueue_lease_count: event.active_enqueue_lease_count,
  });
};

const debugTeamChildTurnEvent = (source: string, event: ITeamChildTurnEvent) => {
  if (!isTeamRunDebugEnabled) return;
  console.debug('[Renderer:teamRunView] team_child_turn_event_applied', {
    source,
    team_id: event.team_id,
    team_run_id: event.team_run_id,
    slot_id: event.slot_id,
    role: event.role,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    status: event.status,
  });
};

const indexSlotWork = (slotWork: ITeamSlotWork[]): Record<string, ITeamSlotWork | undefined> => {
  const indexed: Record<string, ITeamSlotWork | undefined> = {};
  for (const work of slotWork) {
    indexed[work.slot_id] = work;
  }
  return indexed;
};

const createInitialStates = (teamIds: string[]): Map<string, TeamRunViewState> =>
  new Map(teamIds.map((teamId) => [teamId, emptyState]));

export const useTeamRunViews = (requestedTeamIds: string[]) => {
  const teamIdsKey = [...new Set(requestedTeamIds)].toSorted().join('\u0000');
  const teamIds = useMemo(() => (teamIdsKey ? teamIdsKey.split('\u0000') : []), [teamIdsKey]);
  const teamIdSet = useMemo(() => new Set(teamIds), [teamIds]);
  const [states, setStates] = useState<Map<string, TeamRunViewState>>(() => createInitialStates(teamIds));
  const reconcileSeq = useRef(new Map<string, number>());
  const realtimeRevision = useRef(new Map<string, number>());

  const bumpRevision = useCallback((teamId: string): number => {
    const next = (realtimeRevision.current.get(teamId) ?? 0) + 1;
    realtimeRevision.current.set(teamId, next);
    return next;
  }, []);

  const updateTeamState = useCallback(
    (teamId: string, updater: (state: TeamRunViewState) => TeamRunViewState): void => {
      if (!teamIdSet.has(teamId)) return;
      setStates((prev) => {
        const current = prev.get(teamId) ?? emptyState;
        const nextState = updater(current);
        if (nextState === current) return prev;
        const next = new Map(prev);
        next.set(teamId, nextState);
        return next;
      });
    },
    [teamIdSet]
  );

  useEffect(() => {
    setStates((prev) => {
      const next = new Map<string, TeamRunViewState>();
      for (const teamId of teamIds) next.set(teamId, prev.get(teamId) ?? emptyState);
      return next;
    });
  }, [teamIds]);

  const applyRunEvent = useCallback(
    (event: ITeamRunEvent, source = 'websocket') => {
      if (!teamIdSet.has(event.team_id)) return;
      bumpRevision(event.team_id);
      debugTeamRunEvent(source, event);
      updateTeamState(event.team_id, (prev) => ({
        hydrated: true,
        activeRun: TERMINAL_RUN_STATUSES.has(event.status) ? undefined : event,
        childTurnsBySlot: prev.childTurnsBySlot,
        slotWorkBySlot: indexSlotWork(event.slot_work),
        sessionStopped: false,
      }));
    },
    [bumpRevision, teamIdSet, updateTeamState]
  );

  const applyAck = useCallback((ack: ITeamRunAck) => applyRunEvent(ack.run, 'ack'), [applyRunEvent]);

  const reconcile = useCallback(
    async (teamId: string, source = 'manual'): Promise<boolean> => {
      if (!teamIdSet.has(teamId)) return false;
      const seq = (reconcileSeq.current.get(teamId) ?? 0) + 1;
      reconcileSeq.current.set(teamId, seq);
      const revision = realtimeRevision.current.get(teamId) ?? 0;
      try {
        const snapshot = await ipcBridge.team.getRunState.invoke({ team_id: teamId });
        if (seq !== reconcileSeq.current.get(teamId) || revision !== (realtimeRevision.current.get(teamId) ?? 0)) {
          return true;
        }
        const activeRun = snapshot.active_run ?? undefined;
        if (activeRun) debugTeamRunEvent(`reconcile:${source}`, activeRun);
        updateTeamState(teamId, (prev) => ({
          hydrated: true,
          activeRun,
          // Keep in-flight child-turn bridges unless a live run snapshot replaces them.
          // Full wipe caused badges/stop UI to lag after structure-event reconciles.
          childTurnsBySlot: activeRun ? {} : prev.childTurnsBySlot,
          slotWorkBySlot: indexSlotWork(snapshot.slot_work),
          // Only clear stopped when we observe a live active run (recovery path).
          // Structure-event reconciles must not hide idle-reclaim UI.
          sessionStopped: activeRun ? false : prev.sessionStopped,
        }));
        return true;
      } catch (error) {
        console.warn('[Renderer:teamRunView] run_state_reconcile_failed', { source, team_id: teamId, error });
        return false;
      }
    },
    [teamIdSet, updateTeamState]
  );

  const reconcileAll = useCallback(
    (source: string) => {
      for (const teamId of teamIds) void reconcile(teamId, source);
    },
    [reconcile, teamIds]
  );

  const applyChildStarted = useCallback(
    (event: ITeamChildTurnEvent) => {
      if (!teamIdSet.has(event.team_id)) return;
      bumpRevision(event.team_id);
      debugTeamChildTurnEvent('websocket', event);
      updateTeamState(event.team_id, (prev) => ({
        ...prev,
        hydrated: true,
        childTurnsBySlot: { ...prev.childTurnsBySlot, [event.slot_id]: event },
      }));
    },
    [bumpRevision, teamIdSet, updateTeamState]
  );

  const applyChildTerminal = useCallback(
    (event: ITeamChildTurnEvent) => {
      if (!teamIdSet.has(event.team_id)) return;
      bumpRevision(event.team_id);
      debugTeamChildTurnEvent('websocket', event);
      updateTeamState(event.team_id, (prev) => {
        if (prev.childTurnsBySlot[event.slot_id]?.turn_id !== event.turn_id) return prev;
        const childTurnsBySlot = { ...prev.childTurnsBySlot };
        delete childTurnsBySlot[event.slot_id];
        return { ...prev, childTurnsBySlot };
      });
    },
    [bumpRevision, teamIdSet, updateTeamState]
  );

  useEffect(() => reconcileAll('load'), [reconcileAll]);

  useEffect(() => {
    const reconcileEventTeam = (event: { team_id: string }, source: string) => {
      if (teamIdSet.has(event.team_id)) void reconcile(event.team_id, source);
    };
    const unsubs = [
      ipcBridge.team.runAccepted.on(applyRunEvent),
      ipcBridge.team.runStarted.on(applyRunEvent),
      ipcBridge.team.runUpdated.on(applyRunEvent),
      ipcBridge.team.runCompleted.on(applyRunEvent),
      ipcBridge.team.runCancelled.on(applyRunEvent),
      ipcBridge.team.runFailed.on(applyRunEvent),
      ipcBridge.team.childTurnStarted.on(applyChildStarted),
      ipcBridge.team.childTurnCompleted.on(applyChildTerminal),
      ipcBridge.team.childTurnCancelled.on(applyChildTerminal),
      ipcBridge.realtime.reconnected.on(() => reconcileAll('realtime.reconnected')),
      ipcBridge.team.listChanged.on((event) => reconcileEventTeam(event, 'team.listChanged')),
      ipcBridge.team.sessionChanged.on((event) => reconcileEventTeam(event, 'team.sessionChanged')),
      ipcBridge.team.agentSpawned.on((event) => reconcileEventTeam(event, 'team.agentSpawned')),
      ipcBridge.team.agentRemoved.on((event) => reconcileEventTeam(event, 'team.agentRemoved')),
      ipcBridge.team.agentRenamed.on((event) => reconcileEventTeam(event, 'team.agentRenamed')),
      ipcBridge.team.sessionStatusChanged.on((event) => {
        if (!teamIdSet.has(event.team_id)) return;
        bumpRevision(event.team_id);
        if (event.status === 'stopped') {
          updateTeamState(event.team_id, (prev) => ({ ...prev, hydrated: true, sessionStopped: true }));
        } else if (event.status === 'starting' || event.status === 'ready') {
          updateTeamState(event.team_id, (prev) => ({ ...prev, hydrated: true, sessionStopped: false }));
        }
      }),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [
    applyChildStarted,
    applyChildTerminal,
    applyRunEvent,
    bumpRevision,
    reconcile,
    reconcileAll,
    teamIdSet,
    updateTeamState,
  ]);

  return useMemo(() => ({ states, applyAck, reconcile }), [applyAck, reconcile, states]);
};

export const useTeamRunView = (team_id: string) => {
  const teamRunViews = useTeamRunViews([team_id]);
  const applyAck = useCallback((ack: ITeamRunAck) => teamRunViews.applyAck(ack), [teamRunViews]);
  const reconcile = useCallback(
    (source = 'manual') => teamRunViews.reconcile(team_id, source),
    [teamRunViews, team_id]
  );

  return useMemo(
    () => ({ state: teamRunViews.states.get(team_id) ?? emptyState, applyAck, reconcile }),
    [applyAck, reconcile, teamRunViews.states, team_id]
  );
};
