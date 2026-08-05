// @ts-nocheck
/**
 * @license
 * Copyright 2026 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { TeamAssistant } from '@/common/types/team/teamTypes';
import type { TeamRunViewState } from '../../hooks/useTeamRunView';
import { getTeamWorkQueuedCount, hasActiveTeamWork } from '../teamSendRuntime';
import { Button, Tag, Trigger } from '@arco-design/web-react';
import { Down, List, Up } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type TeamWorkOverviewProps = {
  assistants: TeamAssistant[];
  runView: TeamRunViewState;
  pendingCounts: Map<string, number>;
  scheduledJobs: ICronJob[];
  membershipMutationBusy?: boolean;
  onFocusSlot: (slot_id: string) => void;
  compact?: boolean;
};

type WorkRow = {
  key: string;
  kind: 'run' | 'queue' | 'approval' | 'schedule' | 'busy';
  label: string;
  detail?: string;
  slotId?: string;
  tone: 'default' | 'arcoblue' | 'orangered' | 'green' | 'gold';
};

/**
 * Compact status strip + expandable work list.
 * Uses live run-state + pending approvals + scheduled jobs (formal team_tasks board still needs API).
 */
const TeamWorkOverview: React.FC<TeamWorkOverviewProps> = ({
  assistants,
  runView,
  pendingCounts,
  scheduledJobs,
  membershipMutationBusy = false,
  onFocusSlot,
  compact = true,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const assistantByConversation = useMemo(() => {
    const map = new Map<string, TeamAssistant>();
    for (const assistant of assistants) {
      if (assistant.conversation_id) map.set(assistant.conversation_id, assistant);
    }
    return map;
  }, [assistants]);

  const rows = useMemo(() => {
    const next: WorkRow[] = [];

    if (membershipMutationBusy) {
      next.push({
        key: 'membership-busy',
        kind: 'busy',
        label: t('team.ops.busy', {
          defaultValue: 'A team membership operation is already in progress. Please wait.',
        }),
        tone: 'orangered',
      });
    }

    if (runView.sessionStopped) {
      next.push({
        key: 'session-stopped',
        kind: 'run',
        label: t('team.work.sessionStopped', { defaultValue: 'The team session has stopped.' }),
        tone: 'gold',
      });
    }

    for (const assistant of assistants) {
      const work = runView.slotWorkBySlot[assistant.slot_id];
      const queued = getTeamWorkQueuedCount(work);
      const pending = pendingCounts.get(assistant.slot_id) ?? 0;
      if (hasActiveTeamWork(work)) {
        next.push({
          key: `run-${assistant.slot_id}`,
          kind: 'run',
          slotId: assistant.slot_id,
          label: assistant.assistant_name,
          detail: t('team.workOverview.running', { defaultValue: 'Running' }),
          tone: 'green',
        });
      } else if (queued > 0 || work?.state === 'queued') {
        next.push({
          key: `queue-${assistant.slot_id}`,
          kind: 'queue',
          slotId: assistant.slot_id,
          label: assistant.assistant_name,
          detail: t('team.workOverview.queuedCount', {
            count: Math.max(queued, 1),
            defaultValue: '{{count}} queued',
          }),
          tone: 'arcoblue',
        });
      }
      if (pending > 0) {
        next.push({
          key: `approval-${assistant.slot_id}`,
          kind: 'approval',
          slotId: assistant.slot_id,
          label: assistant.assistant_name,
          detail: t('team.commandCenter.pendingApprovals', { count: pending }),
          tone: 'orangered',
        });
      }
    }

    for (const job of scheduledJobs) {
      const owner = assistantByConversation.get(job.metadata.conversation_id);
      next.push({
        key: `cron-${job.id}`,
        kind: 'schedule',
        slotId: owner?.slot_id,
        label: job.name,
        detail: owner
          ? t('team.workOverview.scheduledFor', {
              name: owner.assistant_name,
              defaultValue: 'Scheduled · {{name}}',
            })
          : t('team.workOverview.scheduled', { defaultValue: 'Scheduled task' }),
        tone: job.enabled ? 'arcoblue' : 'default',
      });
    }

    return next;
  }, [assistantByConversation, assistants, membershipMutationBusy, pendingCounts, runView, scheduledJobs, t]);

  const summary = useMemo(() => {
    let running = 0;
    let queued = 0;
    let approvals = 0;
    for (const assistant of assistants) {
      const work = runView.slotWorkBySlot[assistant.slot_id];
      if (hasActiveTeamWork(work)) running += 1;
      queued += getTeamWorkQueuedCount(work);
      if (work?.state === 'queued' && getTeamWorkQueuedCount(work) === 0) queued += 1;
      approvals += pendingCounts.get(assistant.slot_id) ?? 0;
    }
    return {
      running,
      queued,
      approvals,
      schedules: scheduledJobs.length,
      busy: membershipMutationBusy,
      stopped: runView.sessionStopped,
    };
  }, [assistants, membershipMutationBusy, pendingCounts, runView, scheduledJobs.length]);

  const chips: Array<{ key: string; text: string; color?: string }> = [];
  if (summary.busy) {
    chips.push({
      key: 'busy',
      text: t('team.workOverview.chipBusy', { defaultValue: 'Membership busy' }),
      color: 'orangered',
    });
  }
  if (summary.stopped) {
    chips.push({
      key: 'stopped',
      text: t('team.workOverview.chipStopped', { defaultValue: 'Session stopped' }),
      color: 'gold',
    });
  }
  chips.push({
    key: 'running',
    text: t('team.workOverview.chipRunning', {
      count: summary.running,
      defaultValue: '{{count}} running',
    }),
    color: summary.running > 0 ? 'green' : undefined,
  });
  chips.push({
    key: 'queued',
    text: t('team.workOverview.chipQueued', {
      count: summary.queued,
      defaultValue: '{{count}} queued',
    }),
    color: summary.queued > 0 ? 'arcoblue' : undefined,
  });
  if (summary.approvals > 0) {
    chips.push({
      key: 'approvals',
      text: t('team.workOverview.chipApprovals', {
        count: summary.approvals,
        defaultValue: '{{count}} approvals',
      }),
      color: 'orangered',
    });
  }
  if (summary.schedules > 0) {
    chips.push({
      key: 'schedules',
      text: t('team.workOverview.chipSchedules', {
        count: summary.schedules,
        defaultValue: '{{count}} scheduled',
      }),
    });
  }

  return (
    <div
      className={compact ? 'flex items-center gap-6px min-w-0' : 'flex flex-col gap-8px w-full min-w-0'}
      data-testid='team-work-overview'
    >
      <div className='flex items-center gap-6px min-w-0 flex-wrap'>
        {chips.map((chip) => (
          <Tag key={chip.key} size='small' color={chip.color} className='!m-0'>
            {chip.text}
          </Tag>
        ))}
        <Trigger
          popupVisible={expanded}
          onVisibleChange={setExpanded}
          trigger='click'
          position='br'
          popupAlign={{ bottom: 8 }}
          getPopupContainer={() => document.body}
          classNames='team-work-overview-dropdown'
          popup={() => (
            <div
              className='w-320px max-w-[calc(100vw-24px)] max-h-[min(280px,calc(100vh-80px))] overflow-y-auto rounded-8px border border-solid border-[color:var(--border-base)] bg-1 p-10px shadow-md'
              data-testid='team-work-overview-panel'
              style={{ zIndex: 10020 }}
            >
              <div className='mb-8px text-12px text-t-secondary'>
                {t('team.workOverview.panelHint', {
                  defaultValue:
                    'Live queue, approvals, and scheduled jobs. Formal task-board items need a backend list API.',
                })}
              </div>
              {rows.length === 0 ? (
                <div className='py-16px text-center text-12px text-t-tertiary'>
                  {t('team.workOverview.empty', { defaultValue: 'No active work right now' })}
                </div>
              ) : (
                <div className='flex flex-col gap-6px'>
                  {rows.map((row) => (
                    <button
                      key={row.key}
                      type='button'
                      className='flex items-center justify-between gap-8px rounded-6px border-none bg-2 px-8px py-6px text-left cursor-pointer hover:bg-3'
                      data-testid={`team-work-row-${row.key}`}
                      onClick={() => {
                        if (row.slotId) onFocusSlot(row.slotId);
                      }}
                    >
                      <span className='min-w-0 flex-1 truncate text-12px text-t-primary'>{row.label}</span>
                      {row.detail ? (
                        <Tag size='small' color={row.tone} className='!m-0 shrink-0'>
                          {row.detail}
                        </Tag>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        >
          <Button
            type='text'
            size='mini'
            icon={expanded ? <Up theme='outline' size='12' /> : <Down theme='outline' size='12' />}
            data-testid='team-work-overview-toggle'
            aria-expanded={expanded}
            className='!px-4px'
          >
            <span className='inline-flex items-center gap-4px text-12px'>
              <List theme='outline' size='12' />
              {t('team.workOverview.details', { defaultValue: 'Work' })}
            </span>
          </Button>
        </Trigger>
      </div>
    </div>
  );
};

export default TeamWorkOverview;
