// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TeamAssistant } from '@/common/types/team/teamTypes';
import type { AcpModelInfo } from '@/common/types/platform/acpTypes';
import AcpModelSelector from '@/renderer/components/agent/AcpModelSelector';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import { iconColors } from '@/renderer/styles/colors';
import { getAgentModeOptionLabel } from '@/renderer/utils/model/agentTypes';
import { Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { useTeamPermission } from '../../hooks/TeamPermissionContext';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import {
  buildClaudeProviderRoutePatch,
  resolveClaudeProviderModelInfo,
} from '@/renderer/pages/conversation/utils/claudeProviderRoute';

const NON_ACP_BACKENDS = new Set(['aionrs', 'openclaw-gateway', 'nanobot', 'remote']);

type Props = {
  leader?: TeamAssistant;
  sessionMode?: string;
};

/**
 * Group toolbar leader controls — aligned with private-slot model routing so Claude
 * provider routes and roster model ids stay consistent.
 */
const TeamGroupRuntimeControls: React.FC<Props> = ({ leader, sessionMode }) => {
  const { t } = useTranslation();
  const teamPermission = useTeamPermission();
  const { data: providers = [] } = useProvidersQuery();
  const conversationId = leader?.conversation_id;
  const { data: conversation } = useSWR(
    conversationId ? ['team-group-leader-conversation', conversationId] : null,
    () => getConversationOrNull(conversationId!)
  );

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
    routedSnapshotModelId ||
    leader?.model;
  const [currentModelId, setCurrentModelId] = useState(persistedModelId);
  useEffect(() => {
    if (!persistedModelId) return;
    setCurrentModelId(persistedModelId);
  }, [conversationId, persistedModelId]);

  const providerId = typeof conversationExtra?.provider_id === 'string' ? conversationExtra.provider_id : undefined;
  const isClaudeProviderRoute = conversationExtra?.execution_route_key === 'acp:claude';
  const claudeRouteProviderFallback = isClaudeProviderRoute ? providerId : undefined;
  const backend = leader?.assistant_backend ?? 'acp';
  const routedModelInfo = useMemo(
    () =>
      conversation?.type === 'acp'
        ? resolveClaudeProviderModelInfo(
            { ...conversationExtra, current_model_id: currentModelId } as never,
            providers,
            claudeRouteProviderFallback
          )
        : undefined,
    [claudeRouteProviderFallback, conversation?.type, conversationExtra, currentModelId, providers]
  );

  const routeModelSelection = useCallback(
    async (modelId: string, modelInfo: AcpModelInfo | null): Promise<boolean> => {
      if (!conversation || conversation.type !== 'acp' || !conversationExtra) return false;
      const routePatch = buildClaudeProviderRoutePatch({
        extra: conversationExtra,
        backend,
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
    [backend, claudeRouteProviderFallback, conversation, conversationExtra, routedModelInfo]
  );

  if (!leader) return null;

  const isAcpLike = !NON_ACP_BACKENDS.has(leader.assistant_backend);
  const persistedMode = sessionMode?.trim() || 'default';

  return (
    <div className='flex min-w-0 items-center gap-8px' data-testid='team-group-runtime-controls'>
      {isAcpLike && (
        <div className='min-w-0 max-w-180px [&_button]:max-w-full [&_button_span]:truncate'>
          <AcpModelSelector
            conversation_id={leader.conversation_id}
            backend={leader.assistant_backend}
            initialModelId={currentModelId}
            prepareSetRuntime={teamPermission?.warmupSession}
            loadConfigOptions={teamPermission?.loadConfigOptions}
            modelInfoOverride={routedModelInfo}
            routeModelSelection={routeModelSelection}
            onCurrentModelIdChange={(modelId) => {
              setCurrentModelId(modelId);
              if (!conversationId) return;
              void ipcBridge.conversation.update
                .invoke({
                  id: conversationId,
                  merge_extra: true,
                  updates: { extra: { team_runtime_model_id: modelId } as never },
                })
                .catch(() => {});
            }}
          />
        </div>
      )}
      <AgentModeSelector
        backend={leader.assistant_backend}
        conversation_id={leader.conversation_id}
        configOption='approvalMode'
        compact
        initialMode={sessionMode}
        compactLabelFallback={getAgentModeOptionLabel({ value: persistedMode, label: persistedMode }, t)}
        modeLabelFormatter={(mode) => getAgentModeOptionLabel(mode, t)}
        compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
        onModeChanged={teamPermission?.propagateMode}
        beforeRuntimeSet={teamPermission?.warmupSession}
        loadConfigOptions={teamPermission?.loadConfigOptions}
      />
    </div>
  );
};

export default TeamGroupRuntimeControls;
