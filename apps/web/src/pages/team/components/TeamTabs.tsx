// @ts-nocheck
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Tooltip } from '@arco-design/web-react';
import { CloseSmall, Drag, Edit, Peoples, Plus, Refresh, Sync } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TeammateStatus } from '@/common/types/team/teamTypes';
import AgentStatusBadge from './AgentStatusBadge';
import TeamAgentIdentity from './TeamAgentIdentity';
import { useTeamTabs } from '../hooks/TeamTabsContext';
import TeamAddMemberPopover from './memberPicker/TeamAddMemberPopover';

const STATUS_COLORS: Record<TeammateStatus, string> = {
  pending: 'var(--warning)',
  idle: 'var(--text-tertiary)',
  active: 'var(--success)',
  completed: 'var(--brand)',
  failed: 'var(--danger)',
};

const STATUS_KEYS = {
  pending: 'team.commandCenter.status.pending',
  idle: 'team.commandCenter.status.idle',
  active: 'team.commandCenter.status.active',
  completed: 'team.commandCenter.status.completed',
  failed: 'team.commandCenter.status.failed',
} as const;

const EMPTY_TASK_KEYS = {
  pending: 'team.commandCenter.task.pending',
  idle: 'team.commandCenter.task.idle',
  active: 'team.commandCenter.task.active',
  completed: 'team.commandCenter.task.completed',
  failed: 'team.commandCenter.task.failed',
} as const;

type TeamTabViewProps = {
  slot_id: string;
  assistant_name: string;
  assistant_backend: string;
  icon?: string;
  conversation_id?: string;
  isActive: boolean;
  status: TeammateStatus;
  lastMessage?: string;
  isLeader: boolean;
  /** warmup 失败：头像加红环 + 感叹角标提示。 */
  warmupFailed?: boolean;
  /** 成员身份色 CSS 值（胶囊底色 / 选中描边）。 */
  color: string;
  /** Number of pending permission confirmations for this agent */
  pendingCount?: number;
  /** A drag is in progress somewhere in the bar: freeze hover affordances so pills don't reflow mid-drag. */
  dragActive: boolean;
  /** 该成员正在同步中：hover 区的 Sync 按钮替换为「同步中…」内联提示。 */
  syncing?: boolean;
  relaying?: boolean;
  operationsDisabled: boolean;
  onSwitch: (slot_id: string) => void;
  onRename?: (slot_id: string, new_name: string) => void;
  onRemove?: (slot_id: string) => void;
  onSync?: (slot_id: string) => void;
  onRelay?: (slot_id: string) => void;
};

const TeamTabView: React.FC<TeamTabViewProps> = ({
  slot_id,
  assistant_name,
  assistant_backend,
  icon,
  conversation_id,
  isActive,
  status,
  lastMessage,
  isLeader,
  warmupFailed = false,
  color,
  pendingCount = 0,
  dragActive,
  syncing = false,
  relaying = false,
  operationsDisabled,
  onSwitch,
  onRename,
  onRemove,
  onSync,
  onRelay,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(assistant_name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Leader stays fixed at index 0 and never takes part in sorting.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: slot_id,
    disabled: isLeader || operationsDisabled,
  });

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (operationsDisabled) setEditing(false);
  }, [operationsDisabled]);

  const commitRename = useCallback(() => {
    const nextValue = inputRef.current?.value ?? editValue;
    const trimmed = nextValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== assistant_name && onRename) {
      setEditValue(trimmed);
      onRename(slot_id, trimmed);
    } else {
      setEditValue(assistant_name);
    }
  }, [editValue, assistant_name, slot_id, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitRename();
      } else if (e.key === 'Escape') {
        setEditValue(assistant_name);
        setEditing(false);
      }
    },
    [commitRename, assistant_name]
  );

  const startEditing = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditValue(assistant_name);
      setEditing(true);
    },
    [assistant_name]
  );

  // 胶囊底色恒定浅灰（hover / 选中都不改底色，避免压低彩色名字可读性）；
  // 选中态用一圈成员自己的身份色边框表示（与彩色名字呼应，明显但不脏）。身份色只落在名字与边框上。
  // 拖拽走 dnd-kit sortable：hover 时手柄内联出现在头像前（同改名/移除按钮的「hover 增宽」语言，
  // 不遮头像和状态点），拖动时兄弟胶囊实时让位（transform 平移），松手原位落地。
  // dragActive 期间冻结其他胶囊的 hover 增宽（拖动经过时布局不能跳）；正被拖动的胶囊则保持
  // 手柄和按钮可见，宽度全程恒定。
  const showDragHandle = !isLeader && !editing && !operationsDisabled && ((hovered && !dragActive) || isDragging);
  const showHoverActions = !editing && ((hovered && !dragActive) || isDragging);
  const statusLabel = t(STATUS_KEYS[status]);
  const taskSummary = lastMessage?.trim() || t(EMPTY_TASK_KEYS[status]);
  return (
    <div
      ref={setNodeRef}
      data-testid={`team-tab-${slot_id}`}
      data-team-tab-role={isLeader ? 'leader' : 'teammate'}
      data-active={isActive ? 'true' : 'false'}
      data-status={status}
      className='relative flex items-center gap-8px box-border w-full h-72px px-10px cursor-pointer rounded-8px border border-solid transition-colors duration-150 bg-[color:var(--bg-2)] hover:bg-[color:var(--bg-3)]'
      style={{
        ['--mc' as string]: color,
        borderColor: isActive ? color : 'transparent',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.72 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !editing && onSwitch(slot_id)}
      onDoubleClick={onRename ? startEditing : undefined}
    >
      {showDragHandle && (
        <span
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          role='button'
          aria-label={t('team.reorderMember', { defaultValue: 'Drag to reorder member' })}
          data-testid={`team-tab-drag-${slot_id}`}
          className={`shrink-0 flex items-center justify-center w-14px h-20px text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)] ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{ touchAction: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Drag theme='outline' size='13' fill='currentColor' />
        </span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          className='text-15px flex-1 min-w-0 bg-transparent border-none outline-none text-[color:var(--color-text-1)] p-0'
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className='min-w-0 flex-1 flex flex-col gap-6px'>
          <div className='min-w-0 flex items-center gap-6px'>
            {pendingCount > 0 && (
              <span
                className='shrink-0 text-14px leading-none animate-wiggle'
                title={t('team.commandCenter.pendingApprovals', { count: pendingCount })}
              >
                ‼️
              </span>
            )}
            <TeamAgentIdentity
              assistant_name={assistant_name}
              assistant_backend={assistant_backend}
              icon={icon}
              conversation_id={conversation_id}
              isLeader={isLeader}
              className='min-w-0 flex-1 !gap-7px'
              logoClassName={`w-22px h-22px object-cover rounded-full ${warmupFailed ? 'grayscale' : ''}`}
              avatarClassName={`w-22px h-22px rounded-full flex items-center justify-center text-12px leading-none bg-fill-2 shrink-0 ${warmupFailed ? 'grayscale' : ''}`}
              nameClassName='text-13px font-600 whitespace-nowrap overflow-hidden text-ellipsis select-none'
              nameStyle={{ color }}
              nameTestId={`team-tab-name-${slot_id}`}
              avatarOverlay={
                warmupFailed ? (
                  <span
                    data-testid={`team-tab-failed-${slot_id}`}
                    className='absolute -right-2px -bottom-2px w-12px h-12px rounded-full flex items-center justify-center text-9px font-700 text-white'
                    style={{ background: 'var(--danger)', border: '1.5px solid var(--bg-base)' }}
                  >
                    !
                  </span>
                ) : (
                  <AgentStatusBadge status={status} testId={`team-tab-status-${slot_id}`} />
                )
              }
            />
            <span
              className='shrink-0 inline-flex items-center gap-4px text-11px font-600'
              style={{ color: STATUS_COLORS[status] }}
            >
              <span className='w-6px h-6px rounded-full' style={{ background: STATUS_COLORS[status] }} />
              {statusLabel}
            </span>
          </div>
          <div className='pl-29px flex items-center gap-5px min-w-0 text-11px text-t-tertiary'>
            <span className='shrink-0'>{isLeader ? t('team.create.teamLeader') : t('team.create.teammate')}</span>
            <span className='text-[color:var(--border-base)]'>/</span>
            <span className='truncate text-t-secondary' title={taskSummary}>
              {taskSummary}
            </span>
          </div>
        </div>
      )}
      {/* hover 时胶囊变宽、露出操作按钮；失焦则收起（胶囊变窄，只剩头像+文字）。拖拽期间冻结，避免布局跳动。 */}
      {showHoverActions && onRename && (
        <span
          data-testid={`team-tab-edit-${slot_id}`}
          className='shrink-0 flex items-center justify-center w-20px h-20px rounded-6px text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--text-primary)] transition-colors duration-150'
          onClick={startEditing}
        >
          <Edit theme='outline' size='13' fill='currentColor' />
        </span>
      )}
      {syncing && (
        <span
          data-testid={`team-tab-syncing-${slot_id}`}
          className='shrink-0 inline-flex items-center gap-4px text-11px font-500 text-[color:var(--brand)]'
        >
          <Sync
            theme='outline'
            size='12'
            fill='currentColor'
            aria-hidden='true'
            className='animate-spin motion-reduce:animate-none'
          />
          {t('team.commandCenter.syncing', { defaultValue: 'Syncing…' })}
        </span>
      )}
      <span
        data-testid={`team-tab-relaying-${slot_id}`}
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className={relaying ? 'shrink-0 inline-flex items-center gap-4px text-11px font-500 text-primary' : 'sr-only'}
      >
        {relaying && (
          <>
            <Refresh
              theme='outline'
              size='12'
              fill='currentColor'
              aria-hidden='true'
              className='animate-spin motion-reduce:animate-none'
            />
            {t('team.contextRelay.relaying')}
          </>
        )}
      </span>
      {!relaying && !syncing && onRelay && (
        <Tooltip
          content={
            isLeader
              ? t('team.contextRelay.leaderTooltip', {
                  defaultValue:
                    'Rebuild the team sessions and keep a compressed leader handoff (new team id; old team archived)',
                })
              : t('team.contextRelay.tooltip')
          }
        >
          <Button
            type='text'
            size='mini'
            icon={<Refresh theme='outline' size='13' fill='currentColor' aria-hidden='true' />}
            aria-label={
              isLeader
                ? t('team.contextRelay.leaderAction', { defaultValue: 'Relay leader context' })
                : t('team.contextRelay.action')
            }
            data-testid={`team-tab-relay-${slot_id}`}
            className='!h-20px !w-20px !min-w-0 !shrink-0 !rounded-6px !p-0 !text-t-secondary hover:!bg-3 hover:!text-primary'
            onClick={(event) => {
              event.stopPropagation();
              onRelay(slot_id);
            }}
          />
        </Tooltip>
      )}
      {showHoverActions && !isLeader && !syncing && onSync && (
        <Tooltip content={t('team.syncAgent.tooltip', { defaultValue: 'Sync assistant configuration' })}>
          <Button
            type='text'
            size='mini'
            icon={<Sync theme='outline' size='13' fill='currentColor' />}
            aria-label={t('team.syncAgent.tooltip', { defaultValue: 'Sync assistant configuration' })}
            data-testid={`team-tab-sync-${slot_id}`}
            className='!h-20px !w-20px !min-w-0 !shrink-0 !rounded-6px !p-0 !text-[color:var(--text-secondary)] hover:!bg-[color:var(--bg-3)] hover:!text-[color:var(--brand)]'
            onClick={(event) => {
              event.stopPropagation();
              onSync(slot_id);
            }}
          />
        </Tooltip>
      )}
      {showHoverActions && !isLeader && onRemove && (
        <span
          data-testid={`team-tab-remove-${slot_id}`}
          className='shrink-0 flex items-center justify-center w-20px h-20px rounded-6px text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--color-danger-6)] transition-colors duration-150'
          onClick={(e) => {
            e.stopPropagation();
            onRemove(slot_id);
          }}
        >
          <CloseSmall theme='outline' size='14' fill='currentColor' />
        </span>
      )}
    </div>
  );
};

type TeamTabsProps = {
  onTabClick?: (slot_id: string) => void;
  /** Pending permission confirmation counts per assistant slot ID */
  pendingCounts?: Map<string, number>;
  /** 团队 warmup 进行中：禁用改成员（添加/移除/重命名）——PRD 第 7 节要求。 */
  warmingUp?: boolean;
  /** warmup 失败的成员 slot：胶囊头像标红提示，引导用户移除/换模型自救。 */
  failedSlotIds?: Set<string>;
};

/**
 * Tab bar for team mode showing assistant tabs with status badges.
 * Supports scroll overflow with fade indicators.
 */
const TeamTabs: React.FC<TeamTabsProps> = ({ onTabClick, pendingCounts, warmingUp = false, failedSlotIds }) => {
  const { t } = useTranslation();
  const {
    assistants,
    activeSlotId,
    statusMap,
    syncingSlotIds,
    relayingSlotIds,
    membershipMutationBusy,
    switchTab,
    renameAssistant,
    removeAssistant,
    syncAssistant,
    relayAssistant,
    syncAllAssistants,
    reorderAssistants,
    addAssistant,
    colorOf,
  } = useTeamTabs();
  // Membership changes, sync, relay, and sorting all affect the same slot topology.
  // Keep them locked while warmup, a membership mutation, or a context relay owns it.
  const relayBusy = relayingSlotIds.size > 0;
  const memberOpsDisabled = warmingUp || membershipMutationBusy || relayBusy;
  // 拖拽进行中：冻结所有胶囊的 hover 增宽（改名/移除按钮），否则拖动经过时
  // 目标胶囊变宽→布局跳→hover 丢失→又变窄，形成闪烁循环。
  const [dragActive, setDragActive] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  // Only teammates are sortable; the leader pill is rendered outside the sortable id list.
  const sortableIds = useMemo(
    () => assistants.filter((assistant) => assistant.role !== 'leader').map((assistant) => assistant.slot_id),
    [assistants]
  );
  const statusSummary = useMemo(() => {
    let active = 0;
    let attention = 0;
    for (const assistant of assistants) {
      const status = statusMap.get(assistant.slot_id)?.status ?? assistant.status;
      if (status === 'active') active += 1;
      if (status === 'failed' || (pendingCounts?.get(assistant.slot_id) ?? 0) > 0) attention += 1;
    }
    return { active, attention };
  }, [assistants, pendingCounts, statusMap]);

  const handleDragStart = useCallback(() => setDragActive(true), []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setDragActive(false);
      if (memberOpsDisabled) return;
      if (!over || active.id === over.id) return;
      reorderAssistants(String(active.id), String(over.id));
    },
    [memberOpsDisabled, reorderAssistants]
  );

  const handleDragCancel = useCallback(() => setDragActive(false), []);

  if (assistants.length === 0) return null;

  return (
    <div
      data-testid='team-tab-bar'
      data-command-center='true'
      className='relative shrink-0 bg-1 border-t border-x border-b border-solid border-[color:var(--border-base)]'
    >
      <div className='h-42px flex items-center justify-between gap-12px px-12px overflow-x-auto [scrollbar-width:none] border-b border-solid border-[color:var(--border-base)]'>
        <div className='min-w-max flex items-center gap-14px'>
          <div className='flex items-center gap-7px min-w-0'>
            <Peoples theme='outline' size='16' fill='currentColor' className='shrink-0 text-primary' />
            <span className='truncate text-13px font-600 text-t-primary'>{t('team.commandCenter.title')}</span>
          </div>
          <div className='flex items-center gap-12px text-11px text-t-tertiary whitespace-nowrap'>
            <span>{t('team.commandCenter.members', { count: assistants.length })}</span>
            <span className='inline-flex items-center gap-5px'>
              <span className='w-6px h-6px rounded-full bg-success' />
              {t('team.commandCenter.working', { count: statusSummary.active })}
            </span>
            {statusSummary.attention > 0 && (
              <span className='inline-flex items-center gap-5px text-danger'>
                <span className='w-6px h-6px rounded-full bg-danger' />
                {t('team.commandCenter.attention', { count: statusSummary.attention })}
              </span>
            )}
          </div>
        </div>
        {syncAllAssistants || addAssistant ? (
          <div className='flex items-center gap-4px shrink-0'>
            {syncAllAssistants ? (
              <Button
                type='text'
                size='small'
                icon={<Sync theme='outline' size='15' fill='currentColor' />}
                disabled={memberOpsDisabled}
                data-testid='team-tab-sync-all'
                className='!h-30px !rounded-6px !px-8px !text-12px !font-500 !text-t-secondary hover:!bg-2 hover:!text-primary'
                onClick={() => syncAllAssistants()}
              >
                {t('team.syncAll.stopAndSyncLabel', { defaultValue: 'Stop all & rebuild' })}
              </Button>
            ) : null}
            {addAssistant ? (
              <TeamAddMemberPopover disabled={memberOpsDisabled}>
                <Button
                  type='text'
                  size='small'
                  icon={<Plus theme='outline' size='15' fill='currentColor' />}
                  disabled={memberOpsDisabled}
                  data-testid='team-tab-add-member'
                  className='!h-30px !rounded-6px !px-8px !text-12px !font-500 !text-t-secondary hover:!bg-2 hover:!text-primary'
                >
                  {t('team.addMember.title', { defaultValue: 'Add member' })}
                </Button>
              </TeamAddMemberPopover>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className='relative'>
        <div className='relative min-w-0'>
          {/* PC 中控台使用自适应工位网格，让常见规模的团队无需横向滚动即可一眼看全。 */}
          <div
            className='grid gap-8px w-full box-border py-8px px-12px'
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                {assistants.map((assistant) => {
                  const statusInfo = statusMap.get(assistant.slot_id);
                  return (
                    <TeamTabView
                      key={assistant.slot_id}
                      slot_id={assistant.slot_id}
                      assistant_name={assistant.assistant_name}
                      assistant_backend={assistant.assistant_backend}
                      icon={assistant.icon}
                      conversation_id={assistant.conversation_id}
                      isActive={assistant.slot_id === activeSlotId}
                      status={statusInfo?.status ?? assistant.status}
                      lastMessage={statusInfo?.last_message}
                      isLeader={assistant.role === 'leader'}
                      warmupFailed={failedSlotIds?.has(assistant.slot_id) ?? false}
                      color={colorOf(assistant.slot_id)}
                      pendingCount={pendingCounts?.get(assistant.slot_id) ?? 0}
                      dragActive={dragActive}
                      syncing={syncingSlotIds.has(assistant.slot_id)}
                      relaying={relayingSlotIds.has(assistant.slot_id)}
                      operationsDisabled={memberOpsDisabled}
                      onSwitch={(slot_id) => {
                        switchTab(slot_id);
                        onTabClick?.(slot_id);
                      }}
                      onRename={
                        renameAssistant && !memberOpsDisabled
                          ? (sid, name) => void renameAssistant(sid, name)
                          : undefined
                      }
                      onRemove={removeAssistant && !memberOpsDisabled ? (sid) => void removeAssistant(sid) : undefined}
                      onSync={syncAssistant && !memberOpsDisabled ? (sid) => syncAssistant(sid) : undefined}
                      onRelay={relayAssistant && !memberOpsDisabled ? (sid) => relayAssistant(sid) : undefined}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamTabs;
