// @ts-nocheck
/**
 * @license
 * Copyright 2026 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message, Spin } from '@arco-design/web-react';
import { FullScreen, OffScreen } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { ipcBridge } from '@/common';
import type { TeamAssistant } from '@/common/types/team/teamTypes';
import type { IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { AcpModelInfo } from '@/common/types/platform/acpTypes';
import { classifyConfigSetError, useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import AcpModelSelector from '@/renderer/components/agent/AcpModelSelector';
import AionrsModelSelector from '@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { CronJobManager } from '@/renderer/pages/cron';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';
import TeamChatView from './TeamChatView';
import TeamAgentIdentity from './TeamAgentIdentity';
import { useTeamPermission } from '../hooks/TeamPermissionContext';
import type { useTeamRunView } from '../hooks/useTeamRunView';
import { type TeamRunViewState } from '../hooks/useTeamRunView';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import {
  buildClaudeProviderRoutePatch,
  resolveClaudeProviderModelInfo,
} from '@/renderer/pages/conversation/utils/claudeProviderRoute';

const NON_ACP_BACKENDS = new Set(['aionrs', 'openclaw-gateway', 'nanobot', 'remote']);

function isAcpLikeBackend(backend: string | undefined): boolean {
  if (!backend) return false;
  return !NON_ACP_BACKENDS.has(backend);
}

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

/** Compact aionrs model selector for the agent header */
const AionrsHeaderModelSelector: React.FC<{ conversation_id: string; initialModel?: TProviderWithModel }> = ({
  conversation_id,
  initialModel,
}) => {
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();
  const onSelectModel = useCallback(
    async (_provider: IProvider, modelName: string) => {
      const selected = { ..._provider, use_model: modelName } as TProviderWithModel;
      const ok = await ipcBridge.conversation.update.invoke({ id: conversation_id, updates: { model: selected } });
      return Boolean(ok);
    },
    [conversation_id]
  );
  const modelSelection = useAionrsModelSelection({ initialModel, onSelectModel });
  const runtimeConfig = useAcpConfigOptions({
    conversation_id,
    prepareSetRuntime: teamPermission?.warmupSession,
    loadConfigOptions: teamPermission?.loadConfigOptions,
    enabled: Boolean(conversation_id),
  });
  const handleThoughtLevelSetOption = useCallback(
    async (optionId: string, value: string) => {
      try {
        const result = await runtimeConfig.setConfigOption(optionId, value);
        Message.success(t('agent.thoughtLevel.switchSuccess'));
        return result;
      } catch (error) {
        Message.error(t(configErrorMessageKey(error)));
        throw error;
      }
    },
    [runtimeConfig, t]
  );
  return (
    <AionrsModelSelector
      selection={modelSelection}
      thoughtLevel={runtimeConfig.thoughtLevel}
      setStatus={runtimeConfig.setStatus}
      onSetThoughtLevel={handleThoughtLevelSetOption}
    />
  );
};

/** Fetches conversation for a single assistant and renders TeamChatView */
export const AssistantChatSlot: React.FC<{
  assistant: TeamAssistant;
  team_id: string;
  isLeader: boolean;
  /** 成员身份色（列头名字 / 列身淡底）。 */
  color: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  teamRunView: TeamRunViewState;
  onTeamRunAck: ReturnType<typeof useTeamRunView>['applyAck'];
  onRunStateStale: ReturnType<typeof useTeamRunView>['reconcile'];
}> = ({
  assistant,
  team_id,
  isLeader,
  color,
  isFullscreen = false,
  onToggleFullscreen,
  teamRunView,
  onTeamRunAck,
  onRunStateStale,
}) => {
  const layout = useLayoutContext();
  const teamPermission = useTeamPermission();
  const isMobile = layout?.isMobile ?? false;
  const { data: conversation } = useSWR(
    assistant.conversation_id ? ['team-conversation', assistant.conversation_id] : null,
    () => getConversationOrNull(assistant.conversation_id)
  );
  const { data: providers = [] } = useProvidersQuery();

  const isAionrs = conversation?.type === 'aionrs';
  const conversationExtra = conversation?.extra as Record<string, unknown> | undefined;
  const routedSnapshotModelId =
    conversationExtra &&
    typeof conversationExtra.routed_model_info === 'object' &&
    conversationExtra.routed_model_info !== null &&
    typeof (conversationExtra.routed_model_info as { current_model_id?: unknown }).current_model_id === 'string'
      ? ((conversationExtra.routed_model_info as { current_model_id: string }).current_model_id as string)
      : undefined;
  const persistedModelId =
    (typeof conversationExtra?.team_runtime_model_id === 'string'
      ? conversationExtra.team_runtime_model_id
      : undefined) ||
    (typeof conversationExtra?.current_model_id === 'string' ? conversationExtra.current_model_id : undefined) ||
    routedSnapshotModelId;
  const [currentModelId, setCurrentModelId] = useState(persistedModelId);
  useEffect(() => {
    // Never clobber a live selection with undefined while SWR refreshes partial extra.
    if (!persistedModelId) return;
    setCurrentModelId(persistedModelId);
  }, [conversation?.id, persistedModelId]);
  // Team provisioning always stamps Claude members with `provider_id`, but that
  // must not replace the agent's live ACP model options unless the conversation
  // is already on the Claude provider execution route. Using it unconditionally
  // made the current model label look fine while the dropdown showed the wrong
  // provider catalog instead of config_options.
  const providerId = typeof conversationExtra?.provider_id === 'string' ? conversationExtra.provider_id : undefined;
  const isClaudeProviderRoute = conversationExtra?.execution_route_key === 'acp:claude';
  // Only while already on the Claude provider route: use `provider_id` as a
  // stand-in when `execution_provider_id` is missing. Native team Claude
  // members always have `provider_id` stamped by provisioning, but their
  // switchable models still come from ACP config_options until routed.
  const claudeRouteProviderFallback = isClaudeProviderRoute ? providerId : undefined;
  const routedModelInfo = useMemo(
    () =>
      conversation?.type === 'acp'
        ? resolveClaudeProviderModelInfo(
            { ...conversationExtra, current_model_id: currentModelId } as never,
            providers,
            claudeRouteProviderFallback
          )
        : undefined,
    [conversation?.type, conversationExtra, currentModelId, claudeRouteProviderFallback, providers]
  );
  const routeModelSelection = useCallback(
    async (modelId: string, modelInfo: AcpModelInfo | null): Promise<boolean> => {
      if (!conversation || conversation.type !== 'acp' || !conversationExtra) return false;
      const routePatch = buildClaudeProviderRoutePatch({
        extra: conversationExtra,
        backend: assistant.assistant_backend,
        modelId,
        modelInfo: routedModelInfo ?? modelInfo,
        fallbackProviderId: claudeRouteProviderFallback,
      });
      if (!routePatch) return false;

      await ipcBridge.conversation.update.invoke({
        id: conversation.id,
        merge_extra: true,
        updates: { extra: { ...routePatch, team_runtime_model_id: modelId } as never },
      });
      setCurrentModelId(modelId);
      return true;
    },
    [assistant.assistant_backend, conversation, conversationExtra, claudeRouteProviderFallback, routedModelInfo]
  );

  const handleCurrentModelIdChange = useCallback(
    (modelId: string) => {
      setCurrentModelId(modelId);
      if (!conversation?.id) return;
      // Best-effort stamp so roster/group surfaces can read a stable model id after non-route switches.
      void ipcBridge.conversation.update
        .invoke({
          id: conversation.id,
          merge_extra: true,
          updates: { extra: { team_runtime_model_id: modelId } as never },
        })
        .catch(() => {});
    },
    [conversation?.id]
  );
  const isAcpLike = conversation?.type === 'acp' || isAcpLikeBackend(assistant.assistant_backend);
  const cronJobId = resolveCronJobId(conversation?.extra);
  // 抬头不叠身份色底（避免压低彩色名字的可读性）；成员身份仅由抬头里的“彩色名字”承担。
  // 列身体保留极淡身份色底作弱提示，不影响气泡阅读。
  return (
    <div className='flex flex-col h-full' style={{ background: `color-mix(in srgb, ${color} 4%, var(--bg-base))` }}>
      <div className='flex items-center justify-between gap-8px px-12px h-40px shrink-0 border-b border-solid border-[color:var(--border-base)] relative z-10 bg-1'>
        <TeamAgentIdentity
          assistant_name={assistant.assistant_name}
          assistant_backend={assistant.assistant_backend}
          icon={assistant.icon}
          conversation_id={assistant.conversation_id}
          isLeader={isLeader}
          className='min-w-0'
          nameClassName='text-13px font-600'
          nameStyle={{ color }}
        />
        <div className='flex items-center gap-8px shrink-0'>
          {conversation && <CronJobManager conversation_id={conversation.id} cron_job_id={cronJobId} />}
          {!isMobile && assistant.conversation_id && !isAionrs && isAcpLike && (
            <div className='min-w-0 max-w-140px [&_button]:max-w-full [&_button_span]:truncate'>
              <AcpModelSelector
                key={assistant.conversation_id}
                conversation_id={assistant.conversation_id}
                backend={assistant.assistant_backend}
                initialModelId={currentModelId}
                prepareSetRuntime={teamPermission?.warmupSession}
                loadConfigOptions={teamPermission?.loadConfigOptions}
                modelInfoOverride={routedModelInfo}
                routeModelSelection={routeModelSelection}
                onCurrentModelIdChange={handleCurrentModelIdChange}
              />
            </div>
          )}
          {!isMobile && isAionrs && assistant.conversation_id && (
            <div className='min-w-0 max-w-140px [&_button]:max-w-full [&_button_span]:truncate'>
              <AionrsHeaderModelSelector
                key={assistant.conversation_id}
                conversation_id={assistant.conversation_id}
                initialModel={conversation?.model as TProviderWithModel | undefined}
              />
            </div>
          )}
          {/* 移除入口统一到顶部胶囊（team-tab-remove-*），抬头这里不再重复放 X。 */}
          <div
            className='shrink-0 flex items-center justify-center leading-none cursor-pointer hover:bg-[var(--fill-3)] p-4px rd-4px text-[color:var(--color-text-3)] hover:text-[color:var(--color-text-1)] transition-colors'
            onClick={() => onToggleFullscreen?.()}
          >
            {isFullscreen ? <OffScreen size='16' fill='currentColor' /> : <FullScreen size='16' fill='currentColor' />}
          </div>
        </div>
      </div>
      <div className='relative flex flex-col flex-1 min-h-0'>
        {conversation ? (
          <TeamChatView
            conversation={conversation as TChatConversation}
            team_id={team_id}
            slot_id={assistant.slot_id}
            assistant_name={assistant.assistant_name}
            assistant_backend={assistant.assistant_backend}
            agent_icon={assistant.icon}
            isLeader={isLeader}
            teamRunView={teamRunView}
            onTeamRunAck={onTeamRunAck}
            onRunStateStale={() => onRunStateStale('pause.stale')}
            initialModelId={currentModelId}
            routedModelInfo={routedModelInfo}
            onCurrentModelIdChange={handleCurrentModelIdChange}
          />
        ) : (
          <div className='flex flex-1 items-center justify-center'>
            <Spin loading />
          </div>
        )}
      </div>
    </div>
  );
};

export default AssistantChatSlot;
