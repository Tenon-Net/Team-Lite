// src/common/types/teamTypes.ts
// Shared team types used by both main process and renderer.
// Renderer code should import from here instead of @process/team/types.

/** Role of a teammate within a team */
export type TeammateRole = 'leader' | 'teammate';

/** Backend runtime status value as delivered by Team WebSocket events */
export type BackendTeammateStatus = string;

/** Lifecycle status of a teammate agent after frontend normalization */
export type TeammateStatus = 'pending' | 'idle' | 'active' | 'completed' | 'failed';

/** Workspace sharing strategy for the team */
export type WorkspaceMode = 'shared' | 'isolated';

/** Persisted assistant configuration within a team */
export type TeamAssistant = {
  slot_id: string;
  conversation_id: string;
  role: TeammateRole;
  assistant_backend: string;
  icon?: string;
  assistant_name: string;
  status: TeammateStatus;
  cli_path?: string;
  assistant_id?: string;
  model?: string;
  pending_confirmations?: number;
  /** Preview (≤500 chars) of the member's last completed message, from list_teams/get_team. */
  last_message?: string;
  /** Timestamp (ms) of last_message. */
  last_message_at?: number;
};

/** Persisted team record (stored in SQLite `teams` table) */
export type TTeam = {
  id: string;
  user_id: string;
  name: string;
  workspace: string;
  workspace_mode: WorkspaceMode;
  leader_assistant_id: string;
  assistants: TeamAssistant[];
  /** @deprecated Use leader_assistant_id. */
  leader_agent_id?: string;
  /** @deprecated Use assistants. */
  agents?: TeamAssistant[];
  /** Current session permission mode (e.g. 'plan', 'auto'). Persisted so newly spawned assistants inherit it. */
  session_mode?: string;
  created_at: number;
  updated_at: number;
  archived_at?: number;
};

export type ISendTeamMessageParams = {
  team_id: string;
  input: string;
  files?: string[];
};

export type ISendTeamAgentMessageParams = ISendTeamMessageParams & {
  slot_id: string;
};

export type TeamGroupMessageKind = 'user' | 'agent';

export type ITeamGroupMessage = {
  id: string;
  team_id: string;
  kind: TeamGroupMessageKind;
  sender_slot_id?: string;
  sender_name?: string;
  content: string;
  files?: string[];
  target_slot_ids: string[];
  created_at: number;
  /**
   * Per-target delivery results. Present on GET /group-messages history and on
   * the second `team.groupMessageCreated` broadcast (after delivery completes);
   * absent on the first broadcast (persistence time).
   */
  deliveries?: ITeamGroupDelivery[];
};

export type ISendTeamGroupMessageParams = {
  team_id: string;
  input: string;
  files?: string[];
  share_only?: boolean;
  target_slot_ids: string[];
};

export type ITeamGroupDelivery = {
  slot_id: string;
  delivered: boolean;
  /** Full run ack — present only on the POST send-group-message response. */
  ack?: ITeamRunAck;
  /** Slim ack fields — the WS/list serializations carry these instead of `ack`. */
  enqueue_status?: TeamMessageEnqueueStatus;
  message_id?: string;
  team_run_id?: string;
  error?: string;
};

export type ISendTeamGroupMessageResponse = {
  message: ITeamGroupMessage;
  deliveries: ITeamGroupDelivery[];
};

export type ITeamGroupMessageListResponse = {
  messages: ITeamGroupMessage[];
};

export type TeamRunTargetRole = 'lead' | 'teammate';
export type TeamRunStatus = 'accepted' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export type TeamSlotWorkState = 'idle' | 'queued' | 'starting' | 'running' | 'paused' | 'blocked';
export type TeamSlotBlockedReason = 'runtime_starting' | 'runtime_failed' | 'removing' | 'session_stopped';
export type TeamMessageEnqueueStatus = 'accepted' | 'queued' | 'blocked_runtime_starting';

export type ITeamSlotWork = {
  slot_id: string;
  role: TeamRunTargetRole;
  state: TeamSlotWorkState;
  queued_foreground_count: number;
  queued_background_count: number;
  active_turn_id: string | null;
  active_turn_started_at_ms: number | null;
  active_turn_elapsed_ms: number | null;
  active_turn_slow: boolean | null;
  active_turn_slow_threshold_ms: number | null;
  blocked_reason: TeamSlotBlockedReason | null;
  team_run_id: string | null;
};

export type ITeamRunAck = {
  enqueue_status: TeamMessageEnqueueStatus;
  message_id: string;
  run: ITeamRunEvent;
};

export type ICancelTeamRunParams = {
  team_id: string;
  team_run_id: string;
  target_slot_id?: string;
  reason?: string;
};

export type ICancelTeamChildTurnParams = ICancelTeamRunParams & {
  slot_id: string;
};

export type IPauseTeamSlotParams = ICancelTeamChildTurnParams;

export type ITeamRunEvent = {
  team_id: string;
  team_run_id: string;
  source: 'user_message';
  has_user_intervention: boolean;
  target_slot_id: string;
  target_role: TeamRunTargetRole;
  status: TeamRunStatus;
  queued_intent_count: number;
  starting_batch_count: number;
  running_batch_count: number;
  active_enqueue_lease_count: number;
  slot_work: ITeamSlotWork[];
};

export type ITeamRunStateResponse = {
  session_generation: string | null;
  active_run: ITeamRunEvent | null;
  slot_work: ITeamSlotWork[];
};

export type ITeamChildTurnEvent = {
  team_id: string;
  team_run_id: string;
  slot_id: string;
  role: TeamRunTargetRole;
  conversation_id: string;
  turn_id: string;
  status: TeamRunStatus;
};

/** IPC event pushed to renderer when agent status changes */
export type ITeamAgentStatusEvent = {
  team_id: string;
  slot_id: string;
  status: BackendTeammateStatus;
  last_message?: string;
};

/** IPC event pushed to renderer when a new agent is spawned at runtime */
export type ITeamAgentSpawnedEvent = {
  team_id: string;
  assistant: TeamAssistant;
  /** @deprecated Use assistant. */
  agent?: TeamAssistant;
};

/** IPC event pushed to renderer when an agent is removed from the team */
export type ITeamAgentRemovedEvent = {
  team_id: string;
  slot_id: string;
};

/** IPC event pushed to renderer when an agent is renamed */
export type ITeamAgentRenamedEvent = {
  team_id: string;
  slot_id: string;
  name: string;
};

export type TeamAgentRuntimeStatus = 'pending' | 'ready' | 'failed';

/** IPC event pushed to renderer when a team member runtime attach/warmup status changes */
export type ITeamAgentRuntimeStatusEvent = {
  team_id: string;
  slot_id: string;
  conversation_id: string;
  status: TeamAgentRuntimeStatus;
  error?: string;
};

/** IPC event pushed to renderer when the team list changes (created/removed/agent changes) */
export type ITeamListChangedEvent = {
  team_id: string;
  action: 'created' | 'removed' | 'archived' | 'renamed' | 'agent_added' | 'agent_removed';
};

/** IPC event pushed when a new team is created (backend `team.created` WS event) */
export type ITeamCreatedEvent = {
  team_id: string;
  team_name: string;
};

/** IPC event pushed when a team is removed */
export type ITeamRemovedEvent = {
  team_id: string;
};

/** IPC event pushed when a team is renamed */
export type ITeamRenamedEvent = {
  team_id: string;
  team_name: string;
};

/** IPC event for real-time teammate-to-teammate messages */
export type ITeamTeammateMessageEvent = {
  conversation_id: string;
  content: string;
  from_slot_id: string;
  from_name: string;
};

export type ITeamGroupMessageCreatedEvent = ITeamGroupMessage;

/** IPC event for streaming agent messages to renderer */
export type ITeamMessageEvent = {
  team_id: string;
  slot_id: string;
  type: string;
  data: unknown;
  msg_id: string;
  conversation_id: string;
};

/** Team-level session availability status. */
export type TeamSessionStatus = 'starting' | 'ready' | 'failed' | 'stopped';

/** Diagnostic phase for team session startup. */
export type TeamSessionPhase = 'loading_team' | 'starting_bridge' | 'attaching_agents' | 'recovering';

/** IPC event for team session lifecycle status. */
export type ITeamSessionStatusChangedEvent = {
  team_id: string;
  status: TeamSessionStatus;
  phase?: TeamSessionPhase;
  server_count?: number;
  error?: string;
};

/** IPC event pushed when a Team task board item changes */
export type ITeamTaskChangedEvent = {
  team_id: string;
  task_id?: string;
  action?: string;
};

/** IPC event pushed when Team session lifecycle changes */
export type ITeamSessionChangedEvent = {
  team_id: string;
  status?: string;
  error?: string;
};
