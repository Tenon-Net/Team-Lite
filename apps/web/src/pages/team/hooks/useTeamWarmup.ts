// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  ITeamAgentRuntimeStatusEvent,
  ITeamSessionStatusChangedEvent,
  TeamAgentRuntimeStatus,
} from '@/common/types/team/teamTypes';

/**
 * Team-level readiness state.
 *
 * Opening a team is intentionally passive. Sending a message starts the
 * session through TeamPermissionProvider, while retry explicitly requests a
 * new session here. The team status stream remains authoritative for
 * ready/failed transitions, and member runtime events provide per-slot
 * diagnostic detail only.
 */
export type TeamWarmupPhase = 'warming' | 'ready' | 'error';

/** Runtime state and optional failure reason for one member. */
export type TeamWarmupMemberState = {
  status: TeamAgentRuntimeStatus;
  error?: string;
};

export type TeamWarmupState = {
  phase: TeamWarmupPhase;
  /** Runtime state by slot id. A missing entry means warmup has not started for that member. */
  runtimeStatus: Map<string, TeamWarmupMemberState>;
  retry: () => void;
};

export function useTeamWarmup(team_id: string): TeamWarmupState {
  const [phase, setPhase] = useState<TeamWarmupPhase>('ready');
  const [runtimeStatus, setRuntimeStatus] = useState<Map<string, TeamWarmupMemberState>>(() => new Map());
  const [ensureRequest, setEnsureRequest] = useState<{ team_id: string; attempt: number } | null>(null);

  useEffect(() => {
    if (!team_id) {
      setPhase('ready');
      setRuntimeStatus(new Map());
      return;
    }

    let cancelled = false;
    setPhase('ready');
    setRuntimeStatus(new Map<string, TeamWarmupMemberState>());

    const unsubRuntime = ipcBridge.team.agentRuntimeStatusChanged.on((event: ITeamAgentRuntimeStatusEvent) => {
      if (event.team_id !== team_id || cancelled) return;
      setRuntimeStatus((prev) => {
        const next = new Map(prev);
        next.set(event.slot_id, { status: event.status, error: event.error });
        return next;
      });
    });

    const unsubSessionStatus = ipcBridge.team.sessionStatusChanged.on((event: ITeamSessionStatusChangedEvent) => {
      if (event.team_id !== team_id || cancelled) return;
      if (event.status === 'starting') {
        setPhase((current) => {
          // An already-running team emits `attaching_agents` while lazily
          // starting one member. Keep that slot-level work non-blocking; a
          // full session startup reaches an earlier phase first and is
          // already warming by the time agents attach.
          if (current === 'ready' && event.phase === 'attaching_agents') return current;
          return 'warming';
        });
      } else if (event.status === 'ready') {
        setPhase('ready');
      } else if (event.status === 'failed') {
        // A team page can be opened long after a previous warmup failed. Do
        // not restore that historical failure as a blocking overlay unless
        // this page is currently tracking a warmup attempt.
        setPhase((current) => (current === 'warming' ? 'error' : current));
      } else if (event.status === 'stopped') {
        // Idle-reclaim stop: keep the current warmup phase. The stopped state is
        // surfaced by the send box as a recoverable prompt, not as a page-level
        // warming/error overlay, and lazy recovery fires on the next send.
      }
    });

    return () => {
      cancelled = true;
      unsubRuntime();
      unsubSessionStatus();
    };
  }, [team_id]);

  useEffect(() => {
    if (!team_id || ensureRequest?.team_id !== team_id) return;

    let cancelled = false;
    setPhase('warming');
    ipcBridge.team.ensureSession
      .invoke({ team_id })
      .then(() => {
        if (!cancelled) setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, [ensureRequest, team_id]);

  useEffect(() => {
    // A lazy team page has no current warmup work to block on. This also
    // clears an error retained by a hot-reloaded page after an older attempt.
    if (phase === 'error' && ensureRequest?.team_id !== team_id) {
      setPhase('ready');
    }
  }, [ensureRequest, phase, team_id]);

  const retry = useCallback(() => {
    if (!team_id) return;
    setPhase('warming');
    setEnsureRequest((request) => ({
      team_id,
      attempt: request?.team_id === team_id ? request.attempt + 1 : 1,
    }));
  }, [team_id]);

  return { phase, runtimeStatus, retry };
}
