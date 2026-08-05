// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

/**
 * 团队协作视图模式，按团队记忆（localStorage）。
 * - group：团队群聊，按 @ 目标唤醒成员。
 * - single：中控台模式，默认只显示负责人或主动选中的成员。
 * - parallel：会议模式，所有成员对话列并排。
 * - dashboard：驾驶舱模式，响应式网格一屏看全所有成员。
 */
export type TeamViewMode = 'group' | 'parallel' | 'single' | 'dashboard';

const storageKey = (team_id: string): string => `team-view-mode-v2-${team_id}`;

export const readTeamViewMode = (team_id: string): TeamViewMode => {
  try {
    const stored = localStorage.getItem(storageKey(team_id));
    if (stored === 'group' || stored === 'parallel' || stored === 'single' || stored === 'dashboard') return stored;
    return 'group';
  } catch {
    return 'group';
  }
};

export function useTeamViewMode(team_id: string): [TeamViewMode, (mode: TeamViewMode) => void] {
  const [viewMode, setViewModeState] = useState<TeamViewMode>(() => readTeamViewMode(team_id));

  const setViewMode = useCallback(
    (mode: TeamViewMode) => {
      setViewModeState(mode);
      try {
        localStorage.setItem(storageKey(team_id), mode);
      } catch {
        // storage unavailable — 视图仍在内存生效
      }
    },
    [team_id]
  );

  return [viewMode, setViewMode];
}
