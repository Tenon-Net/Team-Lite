// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import { assistantRuntimeKey, type AssistantDetail } from '@/common/types/agent/assistantTypes';
import { getAvailableModels, parseCompositeModelId } from '@/renderer/pages/guid/utils/modelUtils';
import type { AgentConnectionProfilesResponse } from '@/renderer/utils/model/agentTypes';

export type TeamAssistantSyncTarget = {
  /** Catalog assistant id to provision (may rematch bare → system assistant). */
  assistantId: string;
  assistantBackend: string;
  /** Active Agent profile to re-apply after a new team conversation is created. */
  connectionProfile?: TeamAgentConnectionProfileSync;
  /** Runtime-only model from the active Agent connection profile. Do not send to POST /api/teams. */
  runtimeModel?: string;
  model: string;
  modelMode: 'auto' | 'fixed';
};

export type TeamAgentConnectionProfileSync = {
  agentId: string;
  config: AgentConnectionProfilesResponse;
};

/** Stable error code when Claude team creation has no usable Anthropic/CPA provider. */
export const CLAUDE_TEAM_PROVIDER_REQUIRED_CODE = 'CLAUDE_TEAM_PROVIDER_REQUIRED' as const;

/**
 * Thrown when Claude team model resolution would fall back to the backend-rejected
 * placeholder "default" because no enabled Anthropic/CPA provider can seed a model.
 * Matches the AionCore provisioning message so create/add-member UIs can localize it.
 */
export class ClaudeTeamProviderRequiredError extends Error {
  readonly code = CLAUDE_TEAM_PROVIDER_REQUIRED_CODE;

  constructor(model = 'default') {
    super(`no enabled Anthropic/CPA provider supports Claude team model: ${model}`);
    this.name = 'ClaudeTeamProviderRequiredError';
  }
}

type AgentConnectionProfileLookupResult = {
  agentId: string;
  config?: AgentConnectionProfilesResponse;
};

type ActiveConnectionProfile = TeamAgentConnectionProfileSync & {
  runtimeModel: string;
};

/**
 * Resolve the `model` value a team agent should send to `POST /api/teams`.
 *
 * Backend `service.rs` consumes `input.model` verbatim with no default, so an
 * empty or backend-name-only value (e.g. "gemini") ends up persisted as
 * `use_model: null`. Downstream, GeminiSendBox / AionrsSendBox gate the
 * textarea on `current_model?.useModel` and render disabled. See mnemo #297.
 *
 * This resolver reads assistant-owned defaults first and then falls back to
 * backend-safe defaults when the selected assistant has no explicit model.
 *
 * For ACP backends (claude, codex, acp) the model is resolved from the
 * agent's handshake data or cached model info so the backend receives a
 * valid model ID (e.g. "claude-sonnet-4-5-20250514") instead of the bare
 * backend name.
 */
export async function resolveDefaultTeamAgentModel(params: {
  assistant_id?: string;
  assistant_backend?: string;
  useRememberedModel?: boolean;
}): Promise<string> {
  return (await resolveTeamAssistantSyncTarget(params)).model;
}

/** Resolve the Assistant-owned runtime and model settings used by team sync. */
export async function resolveTeamAssistantSyncTarget(params: {
  assistant_id?: string;
  assistant_backend?: string;
  useRememberedModel?: boolean;
  useConnectionProfileModel?: boolean;
}): Promise<TeamAssistantSyncTarget> {
  const { assistant_id, assistant_backend, useRememberedModel = true, useConnectionProfileModel = false } = params;
  const resolvedAssistantId = assistant_id?.trim() || '';

  const assistantDetail = await resolveAssistantDetail(resolvedAssistantId || undefined);
  if (assistantDetail) {
    const resolvedBackend = assistantRuntimeKey({ agent: assistantDetail.engine?.agent }) || assistant_backend || 'acp';
    const activeConnectionProfile = useConnectionProfileModel
      ? await resolveActiveConnectionProfile(assistantDetail, resolvedBackend)
      : undefined;
    const assistantModel = await resolveAssistantModel(assistantDetail, useRememberedModel, resolvedBackend);
    // 'fixed' only when the fixed default actually resolved: a dangling value
    // (e.g. a composite id whose provider was removed) falls back to the
    // backend default, which must stay best-effort ('auto') instead of turning
    // into a hard "configured model unavailable" sync failure.
    const fixedModel =
      assistantDetail.defaults.model.mode === 'fixed' &&
      Boolean(assistantDetail.defaults.model.value) &&
      assistantModel !== undefined;
    return {
      assistantId: resolvedAssistantId || assistantDetail.id || resolvedBackend,
      assistantBackend: resolvedBackend,
      ...(activeConnectionProfile
        ? {
            connectionProfile: {
              agentId: activeConnectionProfile.agentId,
              config: activeConnectionProfile.config,
            },
            runtimeModel: activeConnectionProfile.runtimeModel,
          }
        : {}),
      model: assistantModel ?? (await resolveBackendDefaultModel(resolvedBackend)),
      modelMode: fixedModel ? 'fixed' : 'auto',
    };
  }

  const resolvedBackend = assistant_backend || 'acp';
  return {
    assistantId: resolvedAssistantId || resolvedBackend,
    assistantBackend: resolvedBackend,
    model: await resolveBackendDefaultModel(resolvedBackend),
    modelMode: 'auto',
  };
}

async function resolveAssistantDetail(assistant_id?: string): Promise<AssistantDetail | undefined> {
  if (!assistant_id) return undefined;

  try {
    const detail = (await ipcBridge.assistants.get.invoke({ id: assistant_id })) as AssistantDetail | null;
    return detail ?? undefined;
  } catch {
    return undefined;
  }
}

async function resolveAssistantModel(
  detail: AssistantDetail,
  useRememberedModel: boolean,
  assistant_backend: string
): Promise<string | undefined> {
  if (detail.defaults.model.mode === 'fixed' && detail.defaults.model.value) {
    return resolveStoredModelValue(detail.defaults.model.value, assistant_backend);
  }

  if (useRememberedModel && detail.defaults.model.mode === 'auto' && detail.preferences.last_model_id) {
    // last_model_id is backend-written from the session model field and stays a
    // bare model id; resolveStoredModelValue passes bare values through as-is.
    return resolveStoredModelValue(detail.preferences.last_model_id, assistant_backend);
  }

  return undefined;
}

/**
 * Map a stored assistant model value to the bare model id the backend expects
 * (`POST /api/teams` consumes `input.model` verbatim, so composite ids must
 * never leak through).
 *
 * Composite `providerId::model` ids (written by the assistant editor for
 * provider-based backends) only resolve when that exact provider is still
 * configured, enabled, and lists the model as enabled; a dangling composite
 * returns undefined so the backend-default fallback applies. Legacy bare
 * values are returned unchanged.
 */
async function resolveStoredModelValue(value: string, assistant_backend: string): Promise<string | undefined> {
  const parsed = parseCompositeModelId(value);
  if (!parsed) {
    if (assistant_backend === 'claude') {
      return resolveClaudeStoredModelValue(value);
    }
    return value;
  }

  try {
    const providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
    const pinnedProvider = providers.find(
      (provider) => provider.id === parsed.providerId && provider.enabled !== false
    );
    if (
      pinnedProvider &&
      getAvailableModels(pinnedProvider).includes(parsed.modelName) &&
      (assistant_backend !== 'claude' || isClaudeTeamModelSupportedByProvider(parsed.modelName, pinnedProvider))
    ) {
      return parsed.modelName;
    }
    return undefined;
  } catch {
    if (assistant_backend === 'claude') return undefined;
    // Provider discovery unavailable: still hand the backend the bare model
    // name rather than leaking the composite id.
    return parsed.modelName;
  }
}

async function resolveRuntimeStoredModelValue(value: string): Promise<string | undefined> {
  const parsed = parseCompositeModelId(value);
  if (!parsed) return value;

  try {
    const providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
    const pinnedProvider = providers.find(
      (provider) => provider.id === parsed.providerId && provider.enabled !== false
    );
    return pinnedProvider && getAvailableModels(pinnedProvider).includes(parsed.modelName)
      ? parsed.modelName
      : undefined;
  } catch {
    return parsed.modelName;
  }
}

async function resolveActiveConnectionProfile(
  detail: AssistantDetail,
  assistant_backend: string
): Promise<ActiveConnectionProfile | undefined> {
  const candidateIds: string[] = [];
  const addCandidate = (id: string | undefined) => {
    const normalized = id?.trim();
    if (normalized && !candidateIds.includes(normalized)) candidateIds.push(normalized);
  };

  addCandidate(detail.engine?.agent_id);
  addCandidate(detail.id);
  if (detail.source === 'builtin' || detail.engine?.agent?.source === 'builtin') {
    addCandidate(assistant_backend);
    if (assistant_backend === 'claude') {
      addCandidate('claude');
    }
  }

  const results = await Promise.all(
    candidateIds.map(async (agentId): Promise<AgentConnectionProfileLookupResult> => {
      try {
        return {
          agentId,
          config: (await ipcBridge.acpConversation.getAgentConnectionProfiles.invoke({
            id: agentId,
          })) as AgentConnectionProfilesResponse,
        };
      } catch {
        // Custom/bare agents or older backends may not expose connection profiles.
        return { agentId };
      }
    })
  );

  for (const { agentId, config } of results) {
    const activeProfile = config?.profiles.find((profile) => profile.id === config.active_profile_id);
    if (!activeProfile?.model_id) continue;
    const storedValue = activeProfile.provider_id
      ? `${activeProfile.provider_id}::${activeProfile.model_id}`
      : activeProfile.model_id;
    const runtimeModel = await resolveRuntimeStoredModelValue(storedValue);
    if (runtimeModel) return { agentId, config, runtimeModel };
  }

  return undefined;
}

async function resolveClaudeStoredModelValue(value: string): Promise<string | undefined> {
  try {
    const providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
    return providers.some((provider) => isClaudeTeamModelSupportedByProvider(value, provider)) ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveBackendDefaultModel(assistant_backend?: string): Promise<string> {
  if (assistant_backend === 'gemini') {
    return resolveGeminiDefaultModel();
  }

  if (assistant_backend === 'aionrs') {
    return resolveAionrsDefaultModel();
  }

  return resolveAcpDefaultModel(assistant_backend ?? 'acp');
}

function isAnthropicProtocol(protocol: string | undefined): boolean {
  const normalized = protocol?.trim().toLowerCase();
  return normalized === 'anthropic' || normalized === 'anthropic_messages' || normalized === 'messages';
}

/**
 * Mirrors AionCore `select_claude_provider_for_model` Anthropic/CPA detection:
 * platform anthropic|claude, Anthropic base URL, or any model_protocols entry that
 * is an Anthropic protocol (even when the model catalog is empty/filtered).
 */
function isAnthropicCompatibleProvider(provider: IProvider): boolean {
  const platform = provider.platform.trim().toLowerCase();
  const baseUrl = provider.base_url.trim().toLowerCase();
  if (platform === 'anthropic' || platform === 'claude' || baseUrl.includes('anthropic')) {
    return true;
  }
  return Object.values(provider.model_protocols ?? {}).some((protocol) => isAnthropicProtocol(protocol));
}

/** True for product Claude model ids (sonnet/opus/…), not arbitrary CPA catalog names. */
function isClaudeFamilyModelId(model: string): boolean {
  return /(^|[/_:.-])(claude|sonnet|opus|fable)(?=$|[/_:.-]|\d)/i.test(model.trim());
}

function isClaudeTeamModelSupportedByProvider(model: string, provider: IProvider): boolean {
  return (
    provider.enabled !== false &&
    getAvailableModels(provider).includes(model) &&
    (isClaudeFamilyModelId(model) || isAnthropicCompatibleProvider(provider))
  );
}

/**
 * Pick the default model seed for a Claude team/assistant member.
 *
 * Prefer real Claude-family model ids (e.g. claude-sonnet-5) when any enabled
 * provider lists them. Next prefer the first available model on an
 * Anthropic-compatible CPA provider. If an Anthropic/CPA provider is enabled but
 * has no primary catalog entry yet, seed backend-accepted `"default"` — AionCore
 * `select_claude_provider_for_model` accepts default/auto whenever such a provider
 * exists, even with an empty models list. Only return undefined when no enabled
 * Anthropic/CPA provider exists at all.
 */
export function resolveClaudeProviderDefaultModel(providers: IProvider[]): string | undefined {
  const enabledProviders = providers.filter((provider) => provider.enabled !== false);

  for (const provider of enabledProviders) {
    const claudeFamilyModel = getAvailableModels(provider).find(isClaudeFamilyModelId);
    if (claudeFamilyModel) return claudeFamilyModel;
  }

  const anthropicProviders = enabledProviders.filter(isAnthropicCompatibleProvider);
  for (const provider of anthropicProviders) {
    const firstAvailable = getAvailableModels(provider)[0];
    if (firstAvailable) return firstAvailable;
  }

  if (anthropicProviders.length > 0) return 'default';
  return undefined;
}

async function resolveAcpDefaultModel(assistant_backend: string): Promise<string> {
  if (assistant_backend === 'claude') {
    // Let provider discovery failures propagate — do not remap IPC/storage blips to
    // "missing Anthropic/CPA provider".
    const providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
    const providerModel = resolveClaudeProviderDefaultModel(providers);
    if (providerModel) return providerModel;
    // Backend rejects Claude team create only when no enabled Anthropic/CPA provider
    // can own the model seed. Fail here so create/add-member show a clear setup error.
    throw new ClaudeTeamProviderRequiredError('default');
  }

  return 'default';
}

async function resolveGeminiDefaultModel(): Promise<string> {
  // The legacy 'gemini.defaultModel' config key has been removed after the
  // Gemini → ACP consolidation. Always fall back to the 'auto' alias.
  return 'auto';
}

async function resolveAionrsDefaultModel(): Promise<string> {
  return 'default';
}
