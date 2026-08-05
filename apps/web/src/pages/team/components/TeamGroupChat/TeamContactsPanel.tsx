// @ts-nocheck
import type { TeamAssistant, TeammateStatus } from '@/common/types/team/teamTypes';
import { Avatar, Button, Input } from '@arco-design/web-react';
import { MessageOne, Plus, Search, User } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AgentStatusBadge from '../AgentStatusBadge';
import TeamAddMemberPopover from '../memberPicker/TeamAddMemberPopover';

type ContactStatus = {
  status: TeammateStatus;
  last_message?: string;
};

type Props = {
  assistants: TeamAssistant[];
  activeSlotId: string;
  groupSelected: boolean;
  statusMap: Map<string, ContactStatus>;
  warmingUp: boolean;
  /** Same gate as TeamTabs: membership/sync/relay busy. */
  membershipMutationBusy?: boolean;
  colorOf: (slot_id: string | undefined) => string;
  onSelectGroup: () => void;
  onSelectMember: (slot_id: string) => void;
};

const TeamContactsPanel: React.FC<Props> = ({
  assistants,
  activeSlotId,
  groupSelected,
  statusMap,
  warmingUp,
  membershipMutationBusy = false,
  colorOf,
  onSelectGroup,
  onSelectMember,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const memberOpsDisabled = warmingUp || membershipMutationBusy;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleAssistants = useMemo(
    () =>
      normalizedQuery
        ? assistants.filter((assistant) => assistant.assistant_name.toLocaleLowerCase().includes(normalizedQuery))
        : assistants,
    [assistants, normalizedQuery]
  );

  return (
    <aside
      className='flex h-full w-260px min-w-220px max-w-[34%] shrink-0 flex-col border-r border-solid border-[color:var(--border-base)] bg-2'
      data-testid='team-contacts-panel'
    >
      <div className='border-b border-solid border-[color:var(--border-base)] px-12px pb-10px pt-12px'>
        <div className='mb-10px flex items-center justify-between gap-8px'>
          <div className='min-w-0'>
            <div className='truncate text-14px font-600 text-t-primary'>{t('team.contacts.title')}</div>
            <div className='mt-2px text-11px text-t-tertiary'>
              {t('team.commandCenter.members', { count: assistants.length })}
            </div>
          </div>
          <TeamAddMemberPopover disabled={memberOpsDisabled}>
            <Button
              type='text'
              shape='circle'
              size='small'
              disabled={memberOpsDisabled}
              icon={<Plus theme='outline' size='16' fill='currentColor' />}
              aria-label={t('team.addMember.title')}
              title={
                memberOpsDisabled
                  ? t('team.ops.busy', {
                      defaultValue: 'A team membership operation is already in progress. Please wait.',
                    })
                  : t('team.addMember.title')
              }
              data-testid='team-contacts-add-member'
            />
          </TeamAddMemberPopover>
        </div>
        <Input
          value={query}
          onChange={setQuery}
          allowClear
          prefix={<Search theme='outline' size='14' fill='currentColor' />}
          placeholder={t('team.contacts.searchPlaceholder')}
          data-testid='team-contacts-search'
        />
      </div>

      <div className='flex-1 overflow-y-auto px-8px py-8px'>
        <Button
          type='text'
          long
          onClick={onSelectGroup}
          data-testid='team-contact-group'
          data-selected={groupSelected ? 'true' : 'false'}
          className={`!mb-8px !flex !h-52px !items-center !justify-start !rounded-6px !px-8px ${
            groupSelected ? '!bg-[color:var(--brand)] !text-white' : '!text-t-primary hover:!bg-3'
          }`}
        >
          <span
            className={`mr-10px inline-flex h-34px w-34px shrink-0 items-center justify-center rounded-6px ${
              groupSelected ? 'bg-[color:var(--color-white)]/15' : 'bg-brand text-white'
            }`}
          >
            <MessageOne theme='outline' size='19' fill='currentColor' />
          </span>
          <span className='min-w-0 flex-1 text-left'>
            <span className='block truncate text-13px font-600'>{t('team.groupChat.title')}</span>
            <span className={`mt-2px block truncate text-11px ${groupSelected ? 'opacity-75' : 'text-t-tertiary'}`}>
              {t('team.groupChat.emptyHint')}
            </span>
          </span>
        </Button>

        <div className='mb-5px mt-6px px-8px text-11px font-500 text-t-tertiary'>{t('team.contacts.members')}</div>
        {visibleAssistants.length === 0 ? (
          <div className='flex flex-col items-center justify-center px-12px py-32px text-t-tertiary'>
            <User theme='outline' size='28' fill='currentColor' />
            <span className='mt-8px text-12px'>{t('team.contacts.noResults')}</span>
          </div>
        ) : (
          <div className='flex flex-col gap-2px'>
            {visibleAssistants.map((assistant) => {
              const statusInfo = statusMap.get(assistant.slot_id);
              const status = statusInfo?.status ?? assistant.status;
              const selected = !groupSelected && assistant.slot_id === activeSlotId;
              return (
                <Button
                  key={assistant.slot_id}
                  type='text'
                  long
                  onClick={() => onSelectMember(assistant.slot_id)}
                  data-testid={`team-contact-${assistant.slot_id}`}
                  data-selected={selected ? 'true' : 'false'}
                  className={`!flex !h-56px !items-center !justify-start !rounded-6px !px-8px ${
                    selected ? '!bg-3 !text-t-primary' : '!text-t-primary hover:!bg-3'
                  }`}
                >
                  <span className='relative mr-10px inline-flex shrink-0'>
                    <Avatar size={36} style={{ backgroundColor: colorOf(assistant.slot_id) }} className='!text-white'>
                      {assistant.assistant_name.slice(0, 1).toLocaleUpperCase()}
                    </Avatar>
                    <AgentStatusBadge status={status} />
                  </span>
                  <span className='min-w-0 flex-1 text-left'>
                    <span className='flex items-center gap-6px'>
                      <span className='min-w-0 flex-1 truncate text-13px font-500'>{assistant.assistant_name}</span>
                      {assistant.role === 'leader' && (
                        <span className='shrink-0 text-10px text-warning'>{t('team.create.currentLeader')}</span>
                      )}
                    </span>
                    <span className='mt-2px block truncate text-11px text-t-tertiary'>
                      {statusInfo?.last_message || t(`team.commandCenter.status.${status}`)}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};

export default TeamContactsPanel;
