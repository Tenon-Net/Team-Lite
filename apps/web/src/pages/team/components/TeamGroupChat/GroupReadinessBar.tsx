// @ts-nocheck
/**
 * @license
 * Copyright 2026 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamWarmupPhase } from '../../hooks/useTeamWarmup';

type Props = {
  phase: TeamWarmupPhase;
  sessionStopped?: boolean;
  onRetry?: () => void;
};

/** Compact readiness strip for group chat (full overlay is skipped in group view). */
const GroupReadinessBar: React.FC<Props> = ({ phase, sessionStopped = false, onRetry }) => {
  const { t } = useTranslation();
  if (phase === 'ready' && !sessionStopped) return null;

  const isError = phase === 'error';
  const isWarming = phase === 'warming';

  return (
    <div
      className='flex items-center justify-between gap-10px border-b border-solid border-[color:var(--border-base)] bg-2 px-16px py-8px'
      data-testid='team-group-readiness-bar'
      data-phase={isWarming ? 'warming' : isError ? 'error' : sessionStopped ? 'stopped' : 'ready'}
    >
      <div className='min-w-0 text-12px text-t-secondary'>
        {isWarming
          ? t('team.groupChat.readiness.warming', {
              defaultValue: 'Team session is starting. Messages may queue until members are ready.',
            })
          : isError
            ? t('team.groupChat.readiness.error', {
                defaultValue: 'Team session failed to start. Retry, or open a member and switch model.',
              })
            : t('team.groupChat.readiness.stopped', {
                defaultValue: 'Team session stopped. The next send will try to recover automatically.',
              })}
      </div>
      {(isError || sessionStopped) && onRetry ? (
        <Button
          type='primary'
          size='mini'
          icon={<Refresh theme='outline' size='12' />}
          onClick={onRetry}
          data-testid='team-group-readiness-retry'
        >
          {t('team.warmup.retry', { defaultValue: 'Retry' })}
        </Button>
      ) : null}
    </div>
  );
};

export default GroupReadinessBar;
