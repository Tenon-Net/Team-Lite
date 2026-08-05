// @ts-nocheck
/**
 * @license
 * Copyright 2026 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITeamGroupDelivery, TeamAssistant } from '@/common/types/team/teamTypes';
import type { TeamRunViewState } from '../../hooks/useTeamRunView';
import { getTeamWorkQueuedCount, hasActiveTeamWork } from '../teamSendRuntime';
import { Button, Tag } from '@arco-design/web-react';
import { PauseOne } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type DispatchTargetStatus = 'failed' | 'running' | 'queued' | 'starting' | 'accepted' | 'unknown';

export const resolveDispatchTargetStatus = (
  delivery: ITeamGroupDelivery | undefined,
  runView: TeamRunViewState,
  slotId: string
): DispatchTargetStatus => {
  if (delivery?.delivered === false || delivery?.error) return 'failed';
  const work = runView.slotWorkBySlot[slotId];
  if (hasActiveTeamWork(work)) return 'running';
  if (work?.state === 'queued' || getTeamWorkQueuedCount(work) > 0) return 'queued';
  if (work?.blocked_reason === 'runtime_starting') return 'starting';
  const enqueue = delivery?.enqueue_status ?? delivery?.ack?.enqueue_status;
  if (enqueue === 'queued') return 'queued';
  if (enqueue === 'blocked_runtime_starting') return 'starting';
  if (enqueue === 'accepted' || delivery?.delivered) return 'accepted';
  return 'unknown';
};

type Props = {
  messageId: string;
  targetSlotIds: string[];
  deliveries?: ITeamGroupDelivery[];
  assistantsBySlot: Map<string, TeamAssistant>;
  runView: TeamRunViewState;
  sentAt: number;
  stuckAfterMs?: number;
  onOpenPrivateChat: (slot_id: string) => void;
  onStopTarget?: (params: { slot_id: string; team_run_id: string }) => Promise<void>;
  onRetryWarmup?: () => void;
};

const statusTone = (status: DispatchTargetStatus): string | undefined => {
  switch (status) {
    case 'failed':
      return 'orangered';
    case 'running':
      return 'green';
    case 'queued':
    case 'starting':
      return 'arcoblue';
    case 'accepted':
      return 'green';
    default:
      return undefined;
  }
};

const GroupDispatchBoard: React.FC<Props> = ({
  messageId,
  targetSlotIds,
  deliveries,
  assistantsBySlot,
  runView,
  sentAt,
  stuckAfterMs = 45_000,
  onOpenPrivateChat,
  onStopTarget,
  onRetryWarmup,
}) => {
  const { t } = useTranslation();
  const [stopping, setStopping] = useState<string | null>(null);
  const now = Date.now();
  const stuck = now - sentAt >= stuckAfterMs;

  const rows = useMemo(
    () =>
      targetSlotIds.map((slotId) => {
        const delivery = deliveries?.find((item) => item.slot_id === slotId);
        const status = resolveDispatchTargetStatus(delivery, runView, slotId);
        const teamRunId = delivery?.team_run_id ?? delivery?.ack?.run.team_run_id ?? runView.activeRun?.team_run_id;
        return {
          slotId,
          name: assistantsBySlot.get(slotId)?.assistant_name ?? slotId,
          status,
          error: delivery?.error,
          teamRunId,
        };
      }),
    [assistantsBySlot, deliveries, runView, targetSlotIds]
  );

  const hasActive = rows.some(
    (row) => row.status === 'running' || row.status === 'queued' || row.status === 'starting'
  );
  const hasStuckQueue = stuck && rows.some((row) => row.status === 'queued' || row.status === 'starting');

  if (!targetSlotIds.length) return null;

  return (
    <div
      className='mt-8px w-full rounded-6px border border-solid border-[color:var(--border-base)] bg-2 px-10px py-8px'
      data-testid={`team-group-dispatch-${messageId}`}
    >
      <div className='mb-6px flex items-center justify-between gap-8px'>
        <span className='text-12px font-500 text-t-secondary'>
          {t('team.groupChat.dispatch.title', { defaultValue: 'Dispatch progress' })}
        </span>
        {hasActive && onStopTarget ? (
          <Button
            type='text'
            size='mini'
            status='danger'
            loading={stopping === '*'}
            icon={<PauseOne theme='outline' size='12' />}
            data-testid={`team-group-dispatch-stop-all-${messageId}`}
            onClick={() => {
              void (async () => {
                setStopping('*');
                try {
                  await Promise.allSettled(
                    rows
                      .filter((row) => row.teamRunId && (row.status === 'running' || row.status === 'queued'))
                      .map((row) => onStopTarget({ slot_id: row.slotId, team_run_id: row.teamRunId! }))
                  );
                } finally {
                  setStopping(null);
                }
              })();
            }}
          >
            {t('team.groupChat.dispatch.stopAll', { defaultValue: 'Stop all' })}
          </Button>
        ) : null}
      </div>
      <div className='flex flex-col gap-4px'>
        {rows.map((row) => (
          <div
            key={row.slotId}
            className='flex items-center justify-between gap-8px rounded-4px px-4px py-3px'
            data-testid={`team-group-dispatch-row-${messageId}-${row.slotId}`}
            data-status={row.status}
          >
            <button
              type='button'
              className='min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-12px text-t-primary cursor-pointer'
              onClick={() => onOpenPrivateChat(row.slotId)}
            >
              {row.name}
              {row.error ? <span className='ml-6px text-t-secondary'>{row.error}</span> : null}
            </button>
            <Tag size='small' color={statusTone(row.status)} className='!m-0 shrink-0'>
              {t(`team.groupChat.dispatch.status.${row.status}`, {
                defaultValue: row.status,
              })}
            </Tag>
            {onStopTarget && row.teamRunId && (row.status === 'running' || row.status === 'queued') ? (
              <Button
                type='text'
                size='mini'
                status='danger'
                loading={stopping === row.slotId}
                data-testid={`team-group-dispatch-stop-${messageId}-${row.slotId}`}
                onClick={() => {
                  void (async () => {
                    setStopping(row.slotId);
                    try {
                      await onStopTarget({ slot_id: row.slotId, team_run_id: row.teamRunId! });
                    } finally {
                      setStopping(null);
                    }
                  })();
                }}
              >
                {t('team.groupChat.dispatch.stop', { defaultValue: 'Stop' })}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {hasStuckQueue ? (
        <div
          className='mt-8px rounded-4px bg-fill-2 px-8px py-6px text-11px text-t-secondary'
          data-testid={`team-group-dispatch-stuck-${messageId}`}
        >
          {t('team.groupChat.dispatch.stuckHint', {
            defaultValue:
              'Still queued after a while. Runtime may still be starting — retry session warmup or open the member chat.',
          })}
          {onRetryWarmup ? (
            <Button type='text' size='mini' className='!ml-4px' onClick={onRetryWarmup}>
              {t('team.warmup.retry', { defaultValue: 'Retry' })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default GroupDispatchBoard;
