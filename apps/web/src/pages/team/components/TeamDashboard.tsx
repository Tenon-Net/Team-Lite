// @ts-nocheck
/**
 * @license
 * Copyright 2026 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { TeamAssistant } from '@/common/types/team/teamTypes';
import type { useTeamRunView } from '../hooks/useTeamRunView';
import { type TeamRunViewState } from '../hooks/useTeamRunView';
import AssistantChatSlot from './AssistantChatSlot';
import styles from './TeamDashboard.module.css';

type TeamRunViewApi = ReturnType<typeof useTeamRunView>;

type Props = {
  assistants: TeamAssistant[];
  team_id: string;
  /** 返回指定 slot 的身份色。 */
  colorOf: (slot_id: string) => string;
  leadAssistant: TeamAssistant | undefined;
  /** 切到某成员的单聊视图（卡片全屏按钮用）。 */
  onFocusSlot: (slot_id: string) => void;
  teamRunView: TeamRunViewState;
  onTeamRunAck: TeamRunViewApi['applyAck'];
  onRunStateStale: TeamRunViewApi['reconcile'];
};

/**
 * 驾驶舱视图：响应式网格一屏展示所有成员的聊天窗口。
 * 每个卡片直接复用 AssistantChatSlot（抬头 + 聊天区），外层只包装卡片容器与网格布局。
 */
const TeamDashboard: React.FC<Props> = ({
  assistants,
  team_id,
  colorOf,
  leadAssistant,
  onFocusSlot,
  teamRunView,
  onTeamRunAck,
  onRunStateStale,
}) => {
  return (
    <div className={styles.grid}>
      {assistants.map((assistant) => {
        const isLeaderSlot = assistant.slot_id === leadAssistant?.slot_id;
        const color = colorOf(assistant.slot_id);
        return (
          <div key={assistant.slot_id} className={styles.card} data-slot-id={assistant.slot_id}>
            <div className={styles.accentBar} style={{ background: color }} />
            <div className={styles.cardBody}>
              <AssistantChatSlot
                assistant={assistant}
                team_id={team_id}
                isLeader={isLeaderSlot}
                color={color}
                onToggleFullscreen={() => onFocusSlot(assistant.slot_id)}
                teamRunView={teamRunView}
                onTeamRunAck={onTeamRunAck}
                onRunStateStale={onRunStateStale}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TeamDashboard;
