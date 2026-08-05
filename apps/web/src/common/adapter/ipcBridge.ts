/**
 * Slim ipcBridge for Team-Lite (E2).
 *
 * Upstream ipcBridge.ts is ~2300 lines mapping every product surface.
 * Keep only team / conversation / agent HTTP + team WS events.
 * Dropped: channel / office / cron / mcp / extension / shell / file / system /
 * hub / provider mall / skills market / update.
 *
 * Fork baseline: zbbody-new 11b72ca (see UPSTREAM.md).
 */

import {
  httpDelete,
  httpGet,
  httpPatch,
  httpPost,
  withResponseMap,
  wsEmitter,
} from './httpBridge'
import type { TeamAssistant, TTeam } from '../types/team/teamTypes'
import type { IAddTeamAssistantParams, ICreateTeamParams } from './teamMapper'
import {
  fromBackendAssistant,
  fromBackendTeam,
  fromBackendTeamList,
  fromBackendTeamOptional,
  toBackendAssistant,
} from './teamMapper'

// ---------------------------------------------------------------------------
// Conversation — /api/conversations/* (minimal for team chat paths)
// ---------------------------------------------------------------------------

export type IResponseMessage = {
  type?: string
  content?: string
  data?: unknown
}

/** Cron types retained only so team cleanup helpers type-check; no HTTP routes. */
export type ICronJob = {
  id: string
  name: string
  description?: string
  schedule?: string
  target: { payload: { text: string }; execution_mode?: string }
  metadata: {
    conversation_id?: string
    conversation_title?: string
    created_by?: string
    agent_config?: Record<string, unknown>
  }
  state: { queue_enabled?: boolean }
}

export type ICreateCronJobParams = {
  name: string
  description?: string
  schedule?: string
  message?: string
  conversation_id?: string
  conversation_title?: string
  created_by?: string
  execution_mode?: string
  queue_enabled?: boolean
  agent_config?: Record<string, unknown>
}

export const conversation = {
  get: httpGet<unknown, { id: string }>((p) => `/api/conversations/${p.id}`, {
    silentStatuses: [404],
  }),
  update: httpPatch<boolean, { id: string; updates: Record<string, unknown>; merge_extra?: boolean }>(
    (p) => `/api/conversations/${p.id}`,
    (p) => ({ updates: p.updates, merge_extra: p.merge_extra }),
  ),
  remove: httpDelete<boolean, { id: string }>((p) => `/api/conversations/${p.id}`),
  ensureRuntime: httpPost<unknown, { conversation_id: string }>(
    (p) => `/api/conversations/${p.conversation_id}/runtime/ensure`,
  ),
  activeLease: httpPost<void, { conversation_id: string }>(
    (p) => `/api/conversations/${p.conversation_id}/active-lease`,
  ),
  stop: httpPost<unknown, { conversation_id: string; turn_id?: string }>(
    (p) => `/api/conversations/${p.conversation_id}/cancel`,
  ),
  sendMessage: httpPost<unknown, { conversation_id: string; content?: string; input?: string }>(
    (p) => `/api/conversations/${p.conversation_id}/messages`,
    (p) => ({ content: p.content ?? p.input }),
  ),
  getConfigOptions: httpGet<unknown, { conversation_id: string }>(
    (p) => `/api/conversations/${p.conversation_id}/config-options`,
  ),
  listMessages: httpGet<
    { items: unknown[]; has_more_before?: boolean; has_more_after?: boolean },
    { conversation_id: string; limit?: number }
  >(
    (p) =>
      `/api/conversations/${encodeURIComponent(p.conversation_id)}/messages?limit=${p.limit ?? 100}`,
  ),
  confirmation: {
    list: httpGet<unknown[], { conversation_id: string }>(
      (p) => `/api/conversations/${p.conversation_id}/confirmations`,
    ),
    confirm: httpPost<
      void,
      { conversation_id: string; call_id: string; approved?: boolean }
    >(
      (p) =>
        `/api/conversations/${p.conversation_id}/confirmations/${encodeURIComponent(p.call_id)}/confirm`,
    ),
  },
}

/** No-op cron surface — Team-Lite does not ship cron (E5). */
export const cron = {
  listJobs: {
    provider: () => {},
    invoke: async () => [] as ICronJob[],
  },
  getJob: {
    provider: () => {},
    invoke: async (_p: { job_id: string }) => null as ICronJob | null,
  },
  addJob: {
    provider: () => {},
    invoke: async (_p: ICreateCronJobParams) => {
      throw new Error('cron is not available in Team-Lite')
    },
  },
  removeJob: {
    provider: () => {},
    invoke: async (_p: { job_id: string }) => undefined,
  },
  pauseJob: {
    provider: () => {},
    invoke: async (_p: { job_id: string }) => undefined,
  },
  resumeJob: {
    provider: () => {},
    invoke: async (_p: { job_id: string }) => undefined,
  },
  updateJob: {
    provider: () => {},
    invoke: async (_p: { job_id: string } & Record<string, unknown>) => undefined,
  },
}

// ---------------------------------------------------------------------------
// Agents — /api/agents/* (runtime metadata for selectors)
// ---------------------------------------------------------------------------

export const agents = {
  getManagedAgents: httpGet<unknown[], void>('/api/agents/management'),
  setAgentEnabled: httpPatch<unknown, { id: string; enabled: boolean }>(
    (p) => `/api/agents/${p.id}/enabled`,
    (p) => ({ enabled: p.enabled }),
  ),
  checkManagedAgentHealthById: httpPost<unknown, { id: string }>(
    (p) => `/api/agents/${p.id}/health-check`,
  ),
}

// ---------------------------------------------------------------------------
// Assistants catalog (team member picker)
// ---------------------------------------------------------------------------

export const assistants = {
  list: httpGet<unknown[], void>('/api/assistants'),
  get: httpGet<unknown, { id: string }>((p) => `/api/assistants/${encodeURIComponent(p.id)}`),
}

// ---------------------------------------------------------------------------
// Team — /api/teams/*
// ---------------------------------------------------------------------------

export type { IAddTeamAssistantParams, ICreateTeamParams }

export type ISendTeamMessageParams = {
  team_id: string
  input: string
  files?: unknown[]
}

export type ISendTeamAgentMessageParams = {
  team_id: string
  slot_id: string
  input: string
  files?: unknown[]
}

export type ISendTeamGroupMessageParams = {
  team_id: string
  input: string
  files?: unknown[]
  share_only?: boolean
  target_slot_ids?: string[]
}

export type ICancelTeamRunParams = {
  team_id: string
  team_run_id: string
  target_slot_id?: string
  reason?: string
}

export type ICancelTeamChildTurnParams = {
  team_id: string
  team_run_id: string
  slot_id: string
  reason?: string
}

export type IPauseTeamSlotParams = {
  team_id: string
  team_run_id: string
  slot_id: string
  reason?: string
}

export const realtime = {
  reconnected: wsEmitter<{ timestamp: number }>('realtime.reconnected'),
}

export const team = {
  create: withResponseMap(
    httpPost<TTeam, ICreateTeamParams>('/api/teams', (p) => ({
      name: p.name,
      agents: p.agents.map(toBackendAssistant),
      ...(p.workspace ? { workspace: p.workspace } : {}),
    })),
    fromBackendTeam,
  ),
  list: withResponseMap(httpGet<unknown, undefined>('/api/teams'), fromBackendTeamList),
  listArchived: withResponseMap(
    httpGet<unknown, undefined>('/api/teams?archived=true'),
    fromBackendTeamList,
  ),
  get: withResponseMap(
    httpGet<unknown, { id: string }>((p) => `/api/teams/${p.id}`),
    fromBackendTeamOptional,
  ),
  remove: httpDelete<void, { id: string }>((p) => `/api/teams/${p.id}`),
  archive: httpPost<void, { id: string }>((p) => `/api/teams/${p.id}/archive`),
  addAgent: withResponseMap(
    httpPost<TeamAssistant, IAddTeamAssistantParams>(
      (p) => `/api/teams/${p.team_id}/agents`,
      (p) => ({ assistant: toBackendAssistant(p.assistant) }),
    ),
    fromBackendAssistant,
  ),
  removeAgent: httpDelete<void, { team_id: string; slot_id: string }>(
    (p) => `/api/teams/${p.team_id}/agents/${p.slot_id}`,
  ),
  stop: httpDelete<void, { team_id: string }>((p) => `/api/teams/${p.team_id}/session`),
  ensureSession: httpPost<void, { team_id: string }>((p) => `/api/teams/${p.team_id}/session`),
  getConfigOptions: httpGet<unknown, { team_id: string; conversation_id: string }>(
    (p) =>
      `/api/teams/${p.team_id}/conversations/${encodeURIComponent(p.conversation_id)}/config-options`,
  ),
  activeLease: httpPost<void, { team_id: string }>(
    (p) => `/api/teams/${p.team_id}/active-lease`,
    () => undefined,
  ),
  renameAgent: httpPatch<void, { team_id: string; slot_id: string; new_name: string }>(
    (p) => `/api/teams/${p.team_id}/agents/${p.slot_id}/name`,
    (p) => ({ name: p.new_name }),
  ),
  renameTeam: httpPatch<void, { id: string; name: string }>(
    (p) => `/api/teams/${p.id}/name`,
    (p) => ({ name: p.name }),
  ),
  setSessionMode: httpPost<void, { team_id: string; session_mode: string }>(
    (p) => `/api/teams/${p.team_id}/session-mode`,
    (p) => ({ mode: p.session_mode }),
  ),
  getRunState: httpGet<unknown, { team_id: string }>((p) => `/api/teams/${p.team_id}/run-state`),
  sendMessage: httpPost<unknown, ISendTeamMessageParams>(
    (p) => `/api/teams/${p.team_id}/messages`,
    (p) => ({
      content: p.input,
      files: p.files,
    }),
  ),
  sendMessageToAgent: httpPost<unknown, ISendTeamAgentMessageParams>(
    (p) => `/api/teams/${p.team_id}/agents/${p.slot_id}/messages`,
    (p) => ({
      content: p.input,
      files: p.files,
    }),
  ),
  listGroupMessages: httpGet<unknown, { team_id: string }>(
    (p) => `/api/teams/${p.team_id}/group-messages`,
  ),
  sendGroupMessage: httpPost<unknown, ISendTeamGroupMessageParams>(
    (p) => `/api/teams/${p.team_id}/group-messages`,
    (p) => ({
      content: p.input,
      files: p.files,
      share_only: p.share_only,
      target_slot_ids: p.target_slot_ids,
    }),
  ),
  cancelRun: httpPost<void, ICancelTeamRunParams>(
    (p) => `/api/teams/${p.team_id}/runs/${p.team_run_id}/cancel`,
    (p) => ({
      target_slot_id: p.target_slot_id,
      reason: p.reason,
    }),
  ),
  cancelChildTurn: httpPost<void, ICancelTeamChildTurnParams>(
    (p) => `/api/teams/${p.team_id}/runs/${p.team_run_id}/agents/${p.slot_id}/cancel`,
    (p) => ({
      reason: p.reason,
    }),
  ),
  pauseSlotWork: httpPost<void, IPauseTeamSlotParams>(
    (p) => `/api/teams/${p.team_id}/runs/${p.team_run_id}/agents/${p.slot_id}/pause`,
    (p) => ({
      reason: p.reason,
    }),
  ),

  // WS events
  agentStatusChanged: wsEmitter<unknown>('team.agentStatusChanged'),
  agentSpawned: wsEmitter<unknown>('team.agentSpawned'),
  agentRemoved: wsEmitter<unknown>('team.agentRemoved'),
  agentRenamed: wsEmitter<unknown>('team.agentRenamed'),
  agentRuntimeStatusChanged: wsEmitter<unknown>('team.agentRuntimeStatusChanged'),
  listChanged: wsEmitter<unknown>('team.listChanged'),
  created: wsEmitter<unknown>('team.created'),
  removed: wsEmitter<unknown>('team.removed'),
  renamed: wsEmitter<unknown>('team.renamed'),
  teammateMessage: wsEmitter<unknown>('team.teammateMessage'),
  groupMessageCreated: wsEmitter<unknown>('team.groupMessageCreated'),
  sessionStatusChanged: wsEmitter<unknown>('team.sessionStatusChanged'),
  taskChanged: wsEmitter<unknown>('team.taskChanged'),
  sessionChanged: wsEmitter<unknown>('team.sessionChanged'),
  runAccepted: wsEmitter<unknown>('team.runAccepted'),
  runStarted: wsEmitter<unknown>('team.runStarted'),
  runUpdated: wsEmitter<unknown>('team.runUpdated'),
  runCompleted: wsEmitter<unknown>('team.runCompleted'),
  runCancelled: wsEmitter<unknown>('team.runCancelled'),
  runFailed: wsEmitter<unknown>('team.runFailed'),
  childTurnStarted: wsEmitter<unknown>('team.childTurnStarted'),
  childTurnCompleted: wsEmitter<unknown>('team.childTurnCompleted'),
  childTurnCancelled: wsEmitter<unknown>('team.childTurnCancelled'),
}

/** Default export shape similar to upstream `ipcBridge` barrel usage. */
const ipcBridge = {
  conversation,
  // Upstream alias used by team session / agent hooks
  acpConversation: conversation,
  agents,
  assistants,
  team,
  realtime,
  cron,
}

export default ipcBridge
