// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { GridFour, MessageOne, Peoples } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamViewMode } from '../hooks/useTeamViewMode';

type Props = {
  value: TeamViewMode;
  onChange: (mode: TeamViewMode) => void;
};

/**
 * Layout switch only — not a second copy of contacts navigation.
 *
 * Contacts rail already switches Group chat ↔ single member ("中控台").
 * Header only offers:
 * - 对话: contacts-driven (group | single)
 * - 团队会议: multi-column
 * - 驾驶舱: grid
 */
const TeamViewToggle: React.FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const isConversation = value === 'group' || value === 'single';

  const options: Array<{
    key: 'conversation' | 'parallel' | 'dashboard';
    mode: TeamViewMode;
    icon: React.ReactNode;
    label: string;
    selected: boolean;
  }> = [
    {
      key: 'conversation',
      // Entering conversation from multi-layout lands on group; contacts pick member.
      mode: 'group',
      icon: <MessageOne theme='outline' size='15' fill='currentColor' />,
      label: t('team.view.conversation', { defaultValue: 'Chat' }),
      selected: isConversation,
    },
    {
      key: 'parallel',
      mode: 'parallel',
      icon: <Peoples theme='outline' size='15' fill='currentColor' />,
      label: t('team.view.parallel', { defaultValue: 'Team meeting' }),
      selected: value === 'parallel',
    },
    {
      key: 'dashboard',
      mode: 'dashboard',
      icon: <GridFour theme='outline' size='15' fill='currentColor' />,
      label: t('team.view.dashboard', { defaultValue: 'Dashboard' }),
      selected: value === 'dashboard',
    },
  ];

  return (
    <div className='flex items-center gap-6px' data-testid='team-view-toggle'>
      <span className='text-12px text-[color:var(--color-text-3)] whitespace-nowrap select-none'>
        {t('team.view.layout', { defaultValue: 'Layout' })}
      </span>
      <div className='flex items-center gap-2px p-2px rounded-8px bg-2'>
        {options.map((opt) => (
          <Button
            key={opt.key}
            type='text'
            htmlType='button'
            data-testid={`team-view-toggle-${opt.key}`}
            data-selected={opt.selected ? 'true' : 'false'}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => {
              // Already in contacts-driven chat: don't thrash group/single selection.
              if (opt.key === 'conversation' && isConversation) return;
              onChange(opt.mode);
            }}
            className={`!flex !items-center !justify-center !h-28px !w-auto !min-w-0 !px-9px !rounded-6px !border-none !text-12px !gap-5px transition-colors duration-150 ${
              opt.selected
                ? '!bg-[color:var(--brand)] !text-white shadow-sm'
                : '!bg-transparent !text-[color:var(--color-text-3)] hover:!text-[color:var(--color-text-1)] hover:!bg-[color:var(--bg-3)]'
            }`}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};

export default TeamViewToggle;
