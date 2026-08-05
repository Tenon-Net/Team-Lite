// @ts-nocheck
import { Checkbox, Message, Modal } from '@arco-design/web-react';
import { Left, Peoples, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';
import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';
import ChatSlider from '@renderer/pages/conversation/components/ChatSlider.tsx';
import { useTeamPendingPermissions } from './hooks/useTeamPendingPermissions';
import TeamTabs from './components/TeamTabs';
import AssistantChatSlot from './components/AssistantChatSlot';
import TeamViewToggle from './components/TeamViewToggle';
import TeamDashboard from './components/TeamDashboard';
import TeamWarmupOverlay from './components/TeamWarmupOverlay';
import TeamGroupChat, { TeamContactsPanel } from './components/TeamGroupChat';
import TeamWorkOverview from './components/TeamWorkOverview';
import { useTeamViewMode } from './hooks/useTeamViewMode';
import { useTeamWarmup, type TeamWarmupMemberState, type TeamWarmupPhase } from './hooks/useTeamWarmup';
import { TeamTabsProvider, useTeamTabs } from './hooks/TeamTabsContext';
import { TeamIdentityProvider } from './identity/TeamIdentityContext';
import { TeamPermissionProvider, type TeamContextRelayReplacement } from './hooks/TeamPermissionContext';
import { useTeamSession } from './hooks/useTeamSession';
import { isTeamContextRelaySafe, useTeamRunView, type TeamRunViewState } from './hooks/useTeamRunView';
import { resolveTeamMemberRuntimeStatus } from './components/teamSendRuntime';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { getTeamMembershipErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { useActiveLease } from '@/renderer/pages/conversation/hooks/useActiveLease';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';
import { peekSendBoxDraft, seedSendBoxDraft } from '@/renderer/hooks/chat/useSendBoxDraft';
import { resolveTeamWorkspaceView } from './utils/teamWorkspaceView';
import type { WorkspaceOverviewAgent } from '@/renderer/pages/conversation/Workspace/types';
import type { ICronJob } from '@/common/adapter/ipcBridge';

const CONTEXT_RELAY_DRAFT_KEY = (conversationId: string) => `context_relay_draft_${conversationId}`;

/** Copy unsent send-box content onto the rebuilt Leader conversation before navigation. */
const handoffLeaderSendBoxDraft = (sourceConversationId: string, targetConversationId: string): void => {
  const source = peekSendBoxDraft('acp', sourceConversationId) ?? peekSendBoxDraft('aionrs', sourceConversationId);
  if (!source) return;
  const hasContent =
    Boolean(source.content?.trim()) ||
    (Array.isArray(source.atPath) && source.atPath.length > 0) ||
    (Array.isArray(source.uploadFile) && source.uploadFile.length > 0);
  if (!hasContent) return;

  const draftPayload = {
    content: source.content,
    atPath: source.atPath,
    uploadFile: source.uploadFile,
  };
  try {
    sessionStorage.setItem(CONTEXT_RELAY_DRAFT_KEY(targetConversationId), JSON.stringify(draftPayload));
  } catch {
    // Best-effort: in-memory seed still helps when sessionStorage is unavailable.
  }
  if (source._type === 'aionrs') {
    seedSendBoxDraft('aionrs', targetConversationId, { ...source, _type: 'aionrs' });
  } else {
    seedSendBoxDraft('acp', targetConversationId, { ...source, _type: 'acp' });
  }
};

type Props = {
  team: TTeam;
};

export const isTeamContextRelayTemporarilyUnavailable = (
  teamRunState: TeamRunViewState,
  membershipMutationBusy: boolean
): boolean => membershipMutationBusy || !isTeamContextRelaySafe(teamRunState);

type TeamPageContentProps = {
  team: TTeam;
  teamRun: ReturnType<typeof useTeamRunView>;
  onRenameTeam: (new_name: string) => Promise<boolean>;
  onContextRelay: (conversationId: string) => Promise<TeamContextRelayReplacement>;
  onContextRelayConfirm: (conversationId: string) => void;
  onActivateContextRelayReplacement: (replacement: TeamContextRelayReplacement) => void;
  warmupPhase: TeamWarmupPhase;
  warmupRuntimeStatus: Map<string, TeamWarmupMemberState>;
  onRetryWarmup: () => void;
};

type CronRelayEligibilityState = {
  checkedCandidateKey: string | null;
  safeConversationIds: Set<string>;
};

/** Inner component that reads active tab from context and renders the chat layout */
const TeamPageContent: React.FC<TeamPageContentProps> = ({
  team,
  teamRun,
  onRenameTeam,
  onContextRelay,
  onContextRelayConfirm,
  onActivateContextRelayReplacement,
  warmupPhase,
  warmupRuntimeStatus,
  onRetryWarmup,
}) => {
  const { t } = useTranslation();
  useActiveLease({ type: 'team', id: team.id });
  const { assistants, activeSlotId, statusMap, switchTab, colorOf, colorOfConversation, membershipMutationBusy } =
    useTeamTabs();
  const [, messageContext] = Message.useMessage({ maxCount: 1 });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const assistantRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const initializedTeamRef = useRef<string | undefined>(undefined);
  // Cron eligibility only matters for member_replace; Leader rebuild archives the whole team.
  const contextRelayCandidates = useMemo(
    () =>
      assistants.filter(
        (assistant) =>
          assistant.role !== 'leader' && Boolean(assistant.assistant_id) && Boolean(assistant.conversation_id)
      ),
    [assistants]
  );
  const contextRelayCandidateKey = useMemo(
    () => contextRelayCandidates.map((assistant) => assistant.conversation_id).join('\u0000'),
    [contextRelayCandidates]
  );
  const [cronRelayEligibility, setCronRelayEligibility] = useState<CronRelayEligibilityState>(() => ({
    checkedCandidateKey: null,
    safeConversationIds: new Set(),
  }));
  const cronRelayEligibilityLoading = cronRelayEligibility.checkedCandidateKey !== contextRelayCandidateKey;
  const cronSafeRelayConversationIds = cronRelayEligibilityLoading
    ? new Set(contextRelayCandidates.map((assistant) => assistant.conversation_id))
    : cronRelayEligibility.safeConversationIds;

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      contextRelayCandidates.map(async (assistant) => ({
        conversationId: assistant.conversation_id,
        conversation: await getConversationOrNull(assistant.conversation_id),
      }))
    )
      .then((results) => {
        if (cancelled) return;
        setCronRelayEligibility({
          checkedCandidateKey: contextRelayCandidateKey,
          safeConversationIds: new Set(
            results
              .filter(({ conversation }) => conversation && !resolveCronJobId(conversation.extra))
              .map(({ conversationId }) => conversationId)
          ),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCronRelayEligibility({ checkedCandidateKey: contextRelayCandidateKey, safeConversationIds: new Set() });
      });
    return () => {
      cancelled = true;
    };
  }, [contextRelayCandidateKey, contextRelayCandidates]);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  // 中控台默认聚焦单个成员；会议室才并排展示所有成员。
  const [viewMode, setViewMode] = useTeamViewMode(team.id);
  const isGroupView = viewMode === 'group';
  const isSingleView = viewMode === 'single';
  const isDashboardView = viewMode === 'dashboard';
  const isContactsView = isGroupView || isSingleView;

  const activeAssistant = assistants.find((assistant) => assistant.slot_id === activeSlotId);
  const leadAssistant = assistants.find((assistant) => assistant.role === 'leader');
  useEffect(() => {
    if (initializedTeamRef.current === team.id) return;
    initializedTeamRef.current = team.id;
    if (viewMode === 'single' && leadAssistant) switchTab(leadAssistant.slot_id);
  }, [leadAssistant, switchTab, team.id, viewMode]);

  // Do not force leader focus when a member is added in single view —
  // TeamAddMemberPopover already focuses the new slot (audit P1-11).

  const handleViewModeChange = useCallback(
    (mode: typeof viewMode) => {
      setViewMode(mode);
      if (mode === 'single' && leadAssistant) switchTab(leadAssistant.slot_id);
    },
    [leadAssistant, setViewMode, switchTab]
  );

  // 驾驶舱卡片点击全屏按钮：切到中控台并聚焦该成员。
  const handleFocusSlot = useCallback(
    (slot_id: string) => {
      switchTab(slot_id);
      setViewMode('single');
    },
    [switchTab, setViewMode]
  );

  const handleOpenGroupChat = useCallback(() => {
    setViewMode('group');
  }, [setViewMode]);

  // 进团队 warmup：以团队会话整体就绪为闸门（ensureSession resolve = 全员成功）。遮罩覆盖对话区。
  // runtimeStatus 是各成员逐个的真实唤醒信号，用于遮罩头像的「唤醒中→点亮」及失败态定位。
  // 仅在「唤醒进行中」禁用改成员；失败态（error/timeout）要放开，让用户能移除失败成员来自救。
  const isWarmingUp = warmupPhase === 'warming';

  const leaderConversationId = leadAssistant?.conversation_id ?? '';
  const isLeaderAssistant = activeAssistant?.role === 'leader';
  const allConversationIds = useMemo(
    () => assistants.map((assistant) => assistant.conversation_id).filter(Boolean),
    [assistants]
  );

  // Fetch leader assistant's conversation for the workspace sider
  const { data: dispatchConversation } = useSWR(
    leadAssistant?.conversation_id ? ['team-conversation', leadAssistant.conversation_id] : null,
    () => getConversationOrNull(leadAssistant!.conversation_id)
  );

  // Use team workspace if specified, otherwise fall back to leader assistant's conversation workspace (temp workspace)
  const teamWorkspaceView = resolveTeamWorkspaceView(
    team.workspace,
    (dispatchConversation?.extra as { workspace?: string } | undefined)?.workspace
  );
  const effectiveWorkspace = teamWorkspaceView.workspacePath;
  const workspaceEnabled = teamWorkspaceView.workspaceEnabled;
  // Team is "user-picked" only when team.workspace was explicitly set at team
  // creation. Falling back to a leader assistant's auto-temp workspace counts as
  // temporary, mirroring single-chat behavior.
  const isTeamWorkspaceTemporary = teamWorkspaceView.isTemporaryWorkspace;

  const workspaceAgents = useMemo<WorkspaceOverviewAgent[]>(
    () =>
      assistants.map((assistant) => {
        const status = statusMap.get(assistant.slot_id)?.status ?? assistant.status;
        return {
          id: assistant.slot_id,
          label: assistant.assistant_name,
          model: assistant.model,
          status:
            status === 'active' || status === 'pending'
              ? 'running'
              : status === 'completed' || status === 'failed'
                ? status
                : 'idle',
        };
      }),
    [assistants, statusMap]
  );

  const siderTitle = useMemo(
    () => (
      <div className='flex items-center justify-between'>
        <span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>
      </div>
    ),
    [t]
  );

  const sider = useMemo(() => {
    if (!workspaceEnabled || !dispatchConversation) return <div />;
    return (
      <ChatSlider
        conversation={dispatchConversation}
        agents={workspaceAgents}
        workspace={effectiveWorkspace}
        isTemporaryWorkspace={isTeamWorkspaceTemporary}
      />
    );
  }, [workspaceEnabled, dispatchConversation, workspaceAgents, effectiveWorkspace, isTeamWorkspaceTemporary]);

  const updateScrollArrows = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const hasOverflow = container.scrollWidth > container.clientWidth + 1;
    setShowLeftArrow(hasOverflow && container.scrollLeft > 10);
    setShowRightArrow(hasOverflow && container.scrollLeft + container.clientWidth < container.scrollWidth - 10);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', updateScrollArrows, { passive: true });
    window.addEventListener('resize', updateScrollArrows);
    const observer = new ResizeObserver(updateScrollArrows);
    observer.observe(container);
    updateScrollArrows();
    return () => {
      container.removeEventListener('scroll', updateScrollArrows);
      window.removeEventListener('resize', updateScrollArrows);
      observer.disconnect();
    };
  }, [updateScrollArrows]);

  const handleTabClick = useCallback(
    (slot_id: string) => {
      switchTab(slot_id);
      if (isGroupView) {
        setViewMode('single');
        return;
      }
      // 单聊视图只显示选中成员，无需滚动定位/闪动；并行视图滚动到对应列并闪一下。
      if (isSingleView) return;
      requestAnimationFrame(() => {
        const el = assistantRefs.current[slot_id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
          // Flash: opacity 1→0→1
          setTimeout(() => {
            el.style.transition = 'opacity 150ms ease-out';
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.transition = 'opacity 150ms ease-in';
              el.style.opacity = '1';
              setTimeout(() => {
                el.style.transition = '';
              }, 200);
            }, 150);
          }, 200);
        }
      });
    },
    [isGroupView, isSingleView, setViewMode, switchTab]
  );

  const scrollToPrev = useCallback(() => {
    const idx = assistants.findIndex((assistant) => assistant.slot_id === activeSlotId);
    const target = idx > 0 ? idx - 1 : 0;
    if (assistants[target]) handleTabClick(assistants[target].slot_id);
  }, [assistants, activeSlotId, handleTabClick]);

  const scrollToNext = useCallback(() => {
    const idx = assistants.findIndex((assistant) => assistant.slot_id === activeSlotId);
    const target = idx >= 0 && idx < assistants.length - 1 ? idx + 1 : 0;
    if (assistants[target]) handleTabClick(assistants[target].slot_id);
  }, [assistants, activeSlotId, handleTabClick]);

  // Every time the page mounts, scroll + flash the active tab
  useEffect(() => {
    if (activeSlotId && assistants.length > 0) {
      const timer = setTimeout(() => {
        const el = assistantRefs.current[activeSlotId];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
          setTimeout(() => {
            el.style.transition = 'opacity 150ms ease-out';
            el.style.opacity = '0';
            setTimeout(() => {
              el.style.transition = 'opacity 150ms ease-in';
              el.style.opacity = '1';
              setTimeout(() => {
                el.style.transition = '';
              }, 200);
            }, 150);
          }, 200);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []); // empty deps = only on mount

  // 并行视图下：当 activeSlotId 因程序化切换而变化（如「告诉 Leader」切到 Leader），
  // 把对应列滚动到可视区，避免选中的成员列不在画面中。
  useEffect(() => {
    if (isSingleView || !activeSlotId) return;
    const el = assistantRefs.current[activeSlotId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, [activeSlotId, isSingleView]);

  // Track pending permission confirmation counts per assistant (requirements 5, 6, 7, 8)
  const { pendingCounts } = useTeamPendingPermissions(team.id, allConversationIds);

  // Build slot_id → pendingCount map for tab badge display
  const slotPendingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const assistant of assistants) {
      if (assistant.conversation_id) {
        map.set(assistant.slot_id, pendingCounts[assistant.conversation_id] ?? 0);
      }
    }
    return map;
  }, [assistants, pendingCounts]);

  const conversationIdSet = useMemo(
    () => new Set(assistants.map((assistant) => assistant.conversation_id).filter(Boolean)),
    [assistants]
  );
  const { data: teamScheduledJobs = [] } = useSWR(
    team.id ? ['team-scheduled-jobs', team.id, [...conversationIdSet].toSorted().join('|')] : null,
    async () => {
      const jobs = (await ipcBridge.cron.listJobs.invoke()) ?? [];
      return jobs.filter((job: ICronJob) => conversationIdSet.has(job.metadata.conversation_id));
    },
    { revalidateOnFocus: false, dedupingInterval: 15_000 }
  );

  // warmup 失败的成员 slot 集合：胶囊头像标红。仅在失败态计算（进行中/就绪都无需标红）。
  const warmupFailedSlotIds = useMemo(() => {
    if (warmupPhase !== 'error') return undefined;
    const ids = new Set<string>();
    warmupRuntimeStatus.forEach((state, slot_id) => {
      if (state.status === 'failed') ids.add(slot_id);
    });
    return ids.size > 0 ? ids : undefined;
  }, [warmupPhase, warmupRuntimeStatus]);

  const tabsSlot = useMemo(
    () =>
      isContactsView ? undefined : (
        <TeamTabs
          onTabClick={handleTabClick}
          pendingCounts={slotPendingCounts}
          warmingUp={isWarmingUp}
          failedSlotIds={warmupFailedSlotIds}
        />
      ),
    [handleTabClick, isContactsView, slotPendingCounts, isWarmingUp, warmupFailedSlotIds]
  );
  const contextRelaySupportedConversationIds = useMemo(
    () =>
      assistants
        .filter((assistant) => {
          if (!assistant.assistant_id || !assistant.conversation_id) return false;
          // Leader rebuild is not blocked by per-member cron eligibility (whole team archives).
          if (assistant.role === 'leader') return true;
          return cronSafeRelayConversationIds.has(assistant.conversation_id);
        })
        .map((assistant) => assistant.conversation_id),
    [assistants, cronSafeRelayConversationIds]
  );
  const contextRelayRebuildConversationIds = useMemo(
    () =>
      assistants
        .filter((assistant) => assistant.role === 'leader' && assistant.assistant_id && assistant.conversation_id)
        .map((assistant) => assistant.conversation_id),
    [assistants]
  );
  const requestContextRelay = useCallback(
    async (conversationId: string) => {
      if (!isTeamContextRelaySafe(teamRun.state)) {
        throw new Error('The team is not at a safe context relay boundary');
      }
      const assistant = assistants.find((item) => item.conversation_id === conversationId && item.assistant_id);
      if (!assistant) throw new Error('This team conversation cannot be safely relayed');
      // Member replace still waits for cron eligibility; Leader rebuild does not.
      if (assistant.role !== 'leader') {
        if (cronRelayEligibilityLoading || !cronSafeRelayConversationIds.has(conversationId)) {
          throw new Error('This team conversation cannot be safely relayed');
        }
      }
      return await onContextRelay(conversationId);
    },
    [assistants, cronRelayEligibilityLoading, cronSafeRelayConversationIds, onContextRelay, teamRun.state]
  );
  const activateContextRelayReplacement = useCallback(
    (replacement: TeamContextRelayReplacement) => {
      if (replacement.mode === 'team_rebuild') {
        onActivateContextRelayReplacement(replacement);
        return;
      }
      if (replacement.slotId) switchTab(replacement.slotId);
    },
    [onActivateContextRelayReplacement, switchTab]
  );

  return (
    <TeamPermissionProvider
      team_id={team.id}
      isLeaderAgent={isLeaderAssistant}
      leaderConversationId={leaderConversationId}
      allConversationIds={allConversationIds}
      contextRelaySupportedConversationIds={contextRelaySupportedConversationIds}
      contextRelayRebuildConversationIds={contextRelayRebuildConversationIds}
      contextRelayTemporarilyUnavailable={isTeamContextRelayTemporarilyUnavailable(
        teamRun.state,
        membershipMutationBusy || cronRelayEligibilityLoading
      )}
      contextRelayRebuildTemporarilyUnavailable={isTeamContextRelayTemporarilyUnavailable(
        teamRun.state,
        membershipMutationBusy
      )}
      requestContextRelay={requestContextRelay}
      requestContextRelayConfirm={onContextRelayConfirm}
      activateContextRelayReplacement={activateContextRelayReplacement}
    >
      <TeamIdentityProvider colorOfConversation={colorOfConversation}>
        {messageContext}
        <ChatLayout
          title={team.name}
          siderTitle={siderTitle}
          sider={sider}
          workspaceEnabled={workspaceEnabled}
          tabsSlot={tabsSlot}
          conversation_id={activeAssistant?.conversation_id}
          agent_name={undefined}
          workspacePath={effectiveWorkspace}
          isTemporaryWorkspace={isTeamWorkspaceTemporary}
          workspacePreferenceKey={team.id}
          onRenameTitle={onRenameTeam}
          headerExtra={
            <div className='flex items-center gap-10px min-w-0'>
              <TeamWorkOverview
                assistants={assistants}
                runView={teamRun.state}
                pendingCounts={slotPendingCounts}
                scheduledJobs={teamScheduledJobs}
                membershipMutationBusy={membershipMutationBusy}
                onFocusSlot={handleFocusSlot}
              />
              <TeamViewToggle value={viewMode} onChange={handleViewModeChange} />
            </div>
          }
          headerLeading={
            <span className='inline-flex w-16px h-16px items-center justify-center shrink-0 leading-none text-t-primary'>
              <Peoples theme='outline' size='16' fill='currentColor' style={{ lineHeight: 0 }} />
            </span>
          }
        >
          <div className='relative flex h-full'>
            {isContactsView && (
              <TeamContactsPanel
                assistants={assistants}
                activeSlotId={activeSlotId}
                groupSelected={isGroupView}
                statusMap={statusMap}
                warmingUp={isWarmingUp}
                membershipMutationBusy={membershipMutationBusy}
                colorOf={colorOf}
                onSelectGroup={handleOpenGroupChat}
                onSelectMember={handleFocusSlot}
              />
            )}
            <div className='relative min-w-0 flex-1 h-full'>
              {!isGroupView && (
                <TeamWarmupOverlay
                  phase={warmupPhase}
                  assistants={assistants}
                  runtimeStatus={warmupRuntimeStatus}
                  colorOf={colorOf}
                  onRetry={onRetryWarmup}
                />
              )}
              {isGroupView ? (
                <TeamGroupChat
                  team_id={team.id}
                  assistants={assistants}
                  workspacePath={effectiveWorkspace}
                  sessionMode={team.session_mode}
                  onOpenPrivateChat={handleFocusSlot}
                  onTeamRunAck={teamRun.applyAck}
                  runView={teamRun.state}
                  warmupPhase={warmupPhase}
                  onRetryWarmup={onRetryWarmup}
                />
              ) : isSingleView ? (
                // 中控台主工作区只呈现一个沟通窗口，默认是负责人；成员卡仍可用于主动查看员工。
                (() => {
                  const assistant =
                    assistants.find((candidate) => candidate.slot_id === activeSlotId) ??
                    leadAssistant ??
                    assistants[0];
                  if (!assistant) return null;
                  const isLeaderSlot = assistant.slot_id === leadAssistant?.slot_id;
                  return (
                    <div className='flex-1 h-full'>
                      <AssistantChatSlot
                        assistant={assistant}
                        team_id={team.id}
                        isLeader={isLeaderSlot}
                        color={colorOf(assistant.slot_id)}
                        isFullscreen
                        onToggleFullscreen={() => setViewMode('parallel')}
                        teamRunView={teamRun.state}
                        onTeamRunAck={teamRun.applyAck}
                        onRunStateStale={teamRun.reconcile}
                      />
                    </div>
                  );
                })()
              ) : isDashboardView ? (
                // 驾驶舱：响应式网格一屏看全所有成员。
                <TeamDashboard
                  assistants={assistants}
                  team_id={team.id}
                  colorOf={colorOf}
                  leadAssistant={leadAssistant}
                  onFocusSlot={handleFocusSlot}
                  teamRunView={teamRun.state}
                  onTeamRunAck={teamRun.applyAck}
                  onRunStateStale={teamRun.reconcile}
                />
              ) : (
                <>
                  {showLeftArrow && (
                    <div
                      className='absolute left-0 top-0 bottom-0 w-48px z-20 flex items-center justify-center cursor-pointer opacity-80 hover:opacity-100 transition-opacity'
                      style={{ background: 'linear-gradient(90deg, var(--color-bg-1) 40%, transparent)' }}
                      onClick={scrollToPrev}
                    >
                      <div
                        className='w-32px h-32px rd-full flex items-center justify-center'
                        style={{ background: 'rgba(0,0,0,0.5)', lineHeight: 0 }}
                      >
                        <Left size='24' fill='#fff' />
                      </div>
                    </div>
                  )}
                  <div
                    ref={scrollContainerRef}
                    className='flex h-full w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none]'
                    style={{ scrollSnapType: 'x proximity' }}
                  >
                    {assistants.map((assistant, index) => {
                      const isSingle = assistants.length <= 2;
                      const isLeaderSlot = assistant.slot_id === leadAssistant?.slot_id;
                      const isLastColumn = index === assistants.length - 1;
                      return (
                        <div
                          key={assistant.slot_id}
                          ref={(el) => {
                            assistantRefs.current[assistant.slot_id] = el;
                          }}
                          data-slot-id={assistant.slot_id}
                          data-role={isLeaderSlot ? 'leader' : 'member'}
                          // 列间灰色隔离线：除最后一列外，右侧加一条分隔线，避免多列浅底粘连看不清边界。
                          className={`relative h-full ${isLastColumn ? '' : 'border-r border-solid border-[color:var(--border-base)]'}`}
                          style={{
                            // Always flex-grow to fill available space; each slot starts at 400px
                            // basis so the layout is stable, but spare room is distributed evenly
                            // instead of leaving empty gaps to the right. When the team is wider
                            // than the viewport we preserve the 400px floor (prevents shrinking
                            // into unreadable cards) so horizontal scroll kicks in naturally.
                            flex: '1 1 400px',
                            minWidth: isSingle ? '240px' : '400px',
                            scrollSnapAlign: 'start',
                          }}
                        >
                          <AssistantChatSlot
                            assistant={assistant}
                            team_id={team.id}
                            isLeader={isLeaderSlot}
                            color={colorOf(assistant.slot_id)}
                            onToggleFullscreen={() => {
                              switchTab(assistant.slot_id);
                              setViewMode('single');
                            }}
                            teamRunView={teamRun.state}
                            onTeamRunAck={teamRun.applyAck}
                            onRunStateStale={teamRun.reconcile}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {showRightArrow && (
                    <div
                      className='absolute right-0 top-0 bottom-0 w-48px z-20 flex items-center justify-center cursor-pointer opacity-80 hover:opacity-100 transition-opacity'
                      style={{ background: 'linear-gradient(270deg, var(--color-bg-1) 40%, transparent)' }}
                      onClick={scrollToNext}
                    >
                      <div
                        className='w-32px h-32px rd-full flex items-center justify-center'
                        style={{ background: 'rgba(0,0,0,0.5)', lineHeight: 0 }}
                      >
                        <Right size='24' fill='#fff' />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </ChatLayout>
      </TeamIdentityProvider>
    </TeamPermissionProvider>
  );
};

const TeamPage: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { phase: warmupPhase, runtimeStatus: warmupRuntimeStatus, retry: retryWarmup } = useTeamWarmup(team.id);
  const teamRun = useTeamRunView(team.id);
  const {
    statusMap,
    syncingSlotIds,
    relayingSlotIds,
    membershipMutationBusy,
    addAssistant,
    renameAssistant,
    removeAssistant,
    syncAssistant,
    relayAssistant,
    relayTeamContext,
    syncAllAssistants,
    mutateTeam,
  } = useTeamSession(team, warmupPhase, isTeamContextRelaySafe(teamRun.state));
  const effectiveStatusMap = useMemo(() => {
    const next = new Map(statusMap);
    for (const assistant of team.assistants) {
      const current = next.get(assistant.slot_id);
      next.set(assistant.slot_id, {
        slot_id: assistant.slot_id,
        ...current,
        status: resolveTeamMemberRuntimeStatus({
          persistedStatus: current?.status ?? assistant.status,
          work: teamRun.state.slotWorkBySlot[assistant.slot_id],
          childTurn: teamRun.state.childTurnsBySlot[assistant.slot_id],
          sessionStopped: teamRun.state.sessionStopped,
          hydrated: teamRun.state.hydrated,
        }),
      });
    }
    return next;
  }, [statusMap, team.assistants, teamRun.state]);
  const { user } = useAuth();
  const { mutate: globalMutate } = useSWRConfig();
  const notifyMembershipBusy = useCallback(() => {
    Message.warning(
      t('team.ops.busy', {
        defaultValue: 'A team membership operation is already in progress. Please wait.',
      })
    );
  }, [t]);

  const handleRemoveAssistantWithConfirm = useCallback(
    (slot_id: string) => {
      if (membershipMutationBusy) {
        notifyMembershipBusy();
        return;
      }

      const doRemoveAssistant = async () => {
        try {
          await removeAssistant(slot_id);
          Message.success(t('common.deleteSuccess'));
        } catch (error) {
          Message.error(String(error));
        }
      };
      // 移除成员一律二次确认；成员正在工作中时用更强的措辞提示会打断其工作。
      const status = effectiveStatusMap.get(slot_id)?.status;
      const isActive = status === 'active';
      Modal.confirm({
        title: t('team.removeAgent.confirmTitle', { defaultValue: 'Remove team member' }),
        content: isActive
          ? t('team.removeAgent.confirmContentActive', {
              defaultValue: 'This member is working. Remove it anyway? Its current work will be interrupted.',
            })
          : t('team.removeAgent.confirmContent', { defaultValue: 'Remove this member from the team?' }),
        okButtonProps: { status: 'danger' },
        onOk: doRemoveAssistant,
      });
    },
    [effectiveStatusMap, membershipMutationBusy, notifyMembershipBusy, removeAssistant, t]
  );

  const handleSyncAssistantWithConfirm = useCallback(
    (slot_id: string) => {
      if (membershipMutationBusy) {
        notifyMembershipBusy();
        return;
      }
      let preserveContext = true;

      Modal.confirm({
        title: t('team.syncAgent.confirmTitle', { defaultValue: 'Sync assistant configuration?' }),
        content: (
          <div className='flex flex-col gap-12px'>
            <div>
              {t('team.syncAgent.syncConfirmContent', {
                defaultValue:
                  'Only changed settings are synchronized. A changed Agent or CLI pauses the team and recreates this member; a model-only change is applied in place.',
              })}
            </div>
            <Checkbox defaultChecked onChange={(checked) => (preserveContext = checked)}>
              {t('team.syncAgent.preserveContext', { defaultValue: 'Preserve recent conversation context' })}
            </Checkbox>
          </div>
        ),
        onOk: async () => {
          try {
            await syncAssistant(slot_id, { preserveContext });
            Message.success(t('team.syncAgent.success', { defaultValue: 'Assistant configuration synchronized' }));
          } catch (error) {
            // Prefer localized create/setup codes (Claude provider missing) then the
            // concrete runtime message so "sync all works, single fails" stays diagnosable.
            console.error('[TeamPage] syncAssistant failed:', error);
            Message.error(
              getTeamMembershipErrorMessage(
                error,
                t,
                t('team.syncAgent.error', { defaultValue: 'Failed to synchronize assistant configuration' })
              )
            );
          }
        },
      });
    },
    [membershipMutationBusy, notifyMembershipBusy, syncAssistant, t]
  );

  const handleRelayAssistantWithConfirm = useCallback(
    (slot_id: string) => {
      if (membershipMutationBusy) {
        notifyMembershipBusy();
        return;
      }
      if (!isTeamContextRelaySafe(teamRun.state)) {
        Message.warning(t('team.contextRelay.busyUnavailable'));
        return;
      }

      const assistant = team.assistants.find((item) => item.slot_id === slot_id);
      if (!assistant?.assistant_id) {
        Message.error(t('team.contextRelay.error', { defaultValue: 'Failed to relay the member context' }));
        return;
      }

      const isLeader = assistant.role === 'leader';
      let preserveContext = true;

      Modal.confirm({
        title: isLeader
          ? t('team.contextRelay.leaderConfirmTitle', {
              defaultValue: 'Relay leader context with a whole-team rebuild?',
            })
          : t('team.contextRelay.confirmTitle'),
        content: isLeader ? (
          <div className='flex flex-col gap-12px'>
            <div>
              {t('team.contextRelay.leaderConfirmContent', {
                defaultValue:
                  'The whole team will stop. A new team id is created, the current team is archived, and a compressed context handoff is restored (not full history). Scheduled tasks on the old team are paused with the archive.',
              })}
            </div>
            <Checkbox defaultChecked onChange={(checked) => (preserveContext = checked)}>
              {t('team.syncAgent.preserveContext', { defaultValue: 'Preserve recent conversation context' })}
            </Checkbox>
          </div>
        ) : (
          t('team.contextRelay.confirmContent')
        ),
        onOk: async () => {
          try {
            if (isLeader) {
              const result = await relayTeamContext({ kind: 'leader' }, { preserveContext });
              handoffLeaderSendBoxDraft(assistant.conversation_id, result.conversationId);
              await globalMutate(`teams/${user?.id ?? 'system_default_user'}`);
              Message.success(
                t('team.contextRelay.leaderSuccess', {
                  defaultValue: 'Team rebuilt with a fresh leader context',
                })
              );
              navigate(`/team/${result.teamId}`, { replace: true });
              return;
            }
            await relayAssistant(slot_id);
            Message.success(t('team.contextRelay.success'));
          } catch (error) {
            console.error('[TeamPage] context relay failed:', error);
            Message.error(
              isLeader
                ? error instanceof Error && error.message.trim()
                  ? error.message
                  : t('team.contextRelay.leaderError', { defaultValue: 'Leader context relay failed' })
                : t('team.contextRelay.error')
            );
          }
        },
      });
    },
    [
      globalMutate,
      membershipMutationBusy,
      navigate,
      notifyMembershipBusy,
      relayAssistant,
      relayTeamContext,
      t,
      team.assistants,
      teamRun.state,
      user?.id,
    ]
  );

  const handleContextRelayConfirmByConversation = useCallback(
    (conversationId: string) => {
      const assistant = team.assistants.find((item) => item.conversation_id === conversationId);
      if (!assistant) return;
      handleRelayAssistantWithConfirm(assistant.slot_id);
    },
    [handleRelayAssistantWithConfirm, team.assistants]
  );

  const handleAutomaticContextRelay = useCallback(
    async (conversationId: string): Promise<TeamContextRelayReplacement> => {
      const result = await relayTeamContext({ kind: 'conversation', conversationId });
      return {
        mode: result.mode,
        teamId: result.teamId,
        conversationId: result.conversationId,
        slotId: result.slotId,
      };
    },
    [relayTeamContext]
  );

  const handleActivateContextRelayReplacement = useCallback(
    (replacement: TeamContextRelayReplacement) => {
      if (replacement.mode === 'team_rebuild' && replacement.teamId) {
        void globalMutate(`teams/${user?.id ?? 'system_default_user'}`);
        navigate(`/team/${replacement.teamId}`, { replace: true });
      }
      // member_replace activation (switchTab) is applied inside TeamPageContent.
    },
    [globalMutate, navigate, user?.id]
  );

  const handleSyncAllAssistantsWithConfirm = useCallback(() => {
    if (membershipMutationBusy) {
      notifyMembershipBusy();
      return;
    }
    let preserveContext = true;

    Modal.confirm({
      title: t('team.syncAll.stopAndSyncConfirmTitle', {
        defaultValue: 'Stop all and rebuild the team?',
      }),
      content: (
        <div className='flex flex-col gap-12px'>
          <div>
            {t('team.syncAll.stopAndSyncConfirmContent', {
              defaultValue:
                'This fully rebuilds the team (including the lead) from system assistant configuration. A new team id is created, the previous team is archived, and all sessions stop. This is not an in-place model-only sync.',
            })}
          </div>
          <Checkbox defaultChecked onChange={(checked) => (preserveContext = checked)}>
            {t('team.syncAgent.preserveContext', { defaultValue: 'Preserve recent conversation context' })}
          </Checkbox>
        </div>
      ),
      onOk: async () => {
        try {
          // Product path is intentionally nuclear: soft in-place syncAll exists in the hook
          // for tests/future UI but is not exposed here (audit P0-4).
          const result = await syncAllAssistants({ preserveContext, restartAll: true });
          if (result.replacementTeam) {
            await globalMutate(`teams/${user?.id ?? 'system_default_user'}`);
            if (result.failed > 0) {
              const detail = result.firstError
                ? getTeamMembershipErrorMessage(result.firstError, t)
                : '';
              Message.warning(
                detail ||
                  t('team.syncAll.partial', {
                    synchronized: result.synchronized,
                    failed: result.failed,
                    defaultValue:
                      'Rebuilt team with {{synchronized}} members planned; {{failed}} could not be mapped',
                  })
              );
            } else {
              Message.success(
                t('team.syncAll.success', {
                  count: result.synchronized,
                  defaultValue: 'Team rebuilt ({{count}} members)',
                })
              );
            }
            navigate(`/team/${result.replacementTeam.id}`, { replace: true });
            return;
          }
          if (result.failed === 0) {
            Message.success(
              t('team.syncAll.success', {
                count: result.synchronized,
                defaultValue: 'Synchronized {{count}} team members',
              })
            );
            return;
          }

          const detail = result.firstError ? getTeamMembershipErrorMessage(result.firstError, t) : '';
          Message.warning(
            detail ||
              t('team.syncAll.partial', {
                synchronized: result.synchronized,
                failed: result.failed,
                defaultValue: 'Synchronized {{synchronized}} members; {{failed}} failed',
              })
          );
        } catch (error) {
          Message.error(
            getTeamMembershipErrorMessage(
              error,
              t,
              t('team.syncAll.error', { defaultValue: 'Failed to synchronize team members' })
            )
          );
        }
      },
    });
  }, [globalMutate, membershipMutationBusy, navigate, notifyMembershipBusy, syncAllAssistants, t, user?.id]);

  const handleRenameTeam = useCallback(
    async (new_name: string): Promise<boolean> => {
      try {
        await ipcBridge.team.renameTeam.invoke({ id: team.id, name: new_name });
        await mutateTeam();
        await globalMutate(`teams/${user?.id ?? 'system_default_user'}`);
        return true;
      } catch (error) {
        console.error('Failed to rename team:', error);
        return false;
      }
    },
    [team.id, mutateTeam, globalMutate, user]
  );

  const defaultSlotId =
    team.assistants.find((assistant) => assistant.role === 'leader')?.slot_id ?? team.assistants[0]?.slot_id ?? '';

  return (
    <TeamTabsProvider
      assistants={team.assistants}
      statusMap={effectiveStatusMap}
      syncingSlotIds={syncingSlotIds}
      relayingSlotIds={relayingSlotIds}
      defaultActiveSlotId={defaultSlotId}
      team_id={team.id}
      addAssistant={addAssistant}
      renameAssistant={renameAssistant}
      removeAssistant={handleRemoveAssistantWithConfirm}
      syncAssistant={handleSyncAssistantWithConfirm}
      relayAssistant={handleRelayAssistantWithConfirm}
      syncAllAssistants={handleSyncAllAssistantsWithConfirm}
      membershipMutationBusy={membershipMutationBusy}
    >
      <TeamPageContent
        team={team}
        teamRun={teamRun}
        onRenameTeam={handleRenameTeam}
        onContextRelay={handleAutomaticContextRelay}
        onContextRelayConfirm={handleContextRelayConfirmByConversation}
        onActivateContextRelayReplacement={handleActivateContextRelayReplacement}
        warmupPhase={warmupPhase}
        warmupRuntimeStatus={warmupRuntimeStatus}
        onRetryWarmup={retryWarmup}
      />
    </TeamTabsProvider>
  );
};

export default TeamPage;
