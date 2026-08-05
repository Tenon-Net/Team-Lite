// @ts-nocheck
/**
 * @license
 * Copyright 2025 ZBBody
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { parseError } from '@/common/utils';
import type { TFunction } from 'i18next';

export type WorkspacePathErrorCode = 'WORKSPACE_PATH_UNAVAILABLE' | 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE';
export type TeamAssistantCreateErrorCode =
  | 'TEAM_ASSISTANT_ID_REQUIRED'
  | 'TEAM_ASSISTANT_NOT_FOUND'
  | 'TEAM_ASSISTANT_FIELD_UNSUPPORTED'
  | 'CLAUDE_TEAM_PROVIDER_REQUIRED';

export type ConversationCreateErrorCode = 'WORKSPACE_PATH_UNAVAILABLE' | TeamAssistantCreateErrorCode;
export type ConversationRuntimeWorkspaceErrorCode = 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE';

const BACKEND_ERROR_CODE_MAP: Record<string, WorkspacePathErrorCode> = {
  WORKSPACE_PATH_UNAVAILABLE: 'WORKSPACE_PATH_UNAVAILABLE',
  WORKSPACE_PATH_RUNTIME_UNAVAILABLE: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
  WORKSPACE_PATH_CONTAINS_WHITESPACE_UNSUPPORTED: 'WORKSPACE_PATH_UNAVAILABLE',
  WORKSPACE_PATH_CONTAINS_WHITESPACE_RUNTIME_UNSUPPORTED: 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE',
  WORKSPACE_TRAILING_WHITESPACE_UNSUPPORTED: 'WORKSPACE_PATH_UNAVAILABLE',
};

const TEAM_BACKEND_ERROR_CODE_MAP: Record<string, TeamAssistantCreateErrorCode> = {
  TEAM_ASSISTANT_ID_REQUIRED: 'TEAM_ASSISTANT_ID_REQUIRED',
  TEAM_ASSISTANT_NOT_FOUND: 'TEAM_ASSISTANT_NOT_FOUND',
  TEAM_ASSISTANT_FIELD_UNSUPPORTED: 'TEAM_ASSISTANT_FIELD_UNSUPPORTED',
  CLAUDE_TEAM_PROVIDER_REQUIRED: 'CLAUDE_TEAM_PROVIDER_REQUIRED',
};

const CLAUDE_TEAM_PROVIDER_REQUIRED_PATTERN =
  /no enabled Anthropic\/CPA provider supports Claude team model/i;

// Temporary fallback for older AionCore builds that still return BAD_REQUEST
// plus a human-readable message. Remove after the dedicated backend code has
// shipped everywhere we support.
const LEGACY_BACKEND_MESSAGE_PATTERNS: Array<{
  code: WorkspacePathErrorCode;
  pattern: RegExp;
}> = [
  {
    code: 'WORKSPACE_PATH_UNAVAILABLE',
    pattern: /workspace directory names ending in whitespace are not supported/i,
  },
  {
    code: 'WORKSPACE_PATH_UNAVAILABLE',
    pattern:
      /workspace (directory|path).*(contain|contains|containing).*(whitespace|space).*(not supported|unsupported)/i,
  },
];

type EmbeddedBackendErrorPayload = {
  code?: string;
  error?: string;
  details?: unknown;
};

type WorkspacePathErrorDetails = {
  workspace_path?: string;
};

type TeamAssistantErrorDetails = {
  assistant_id?: string;
  field?: string;
};

const getEmbeddedBackendErrorPayload = (error: unknown): EmbeddedBackendErrorPayload | undefined => {
  const parsedError = parseError(error);
  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof parsedError === 'string'
          ? parsedError
          : '';

  if (!rawMessage) {
    return undefined;
  }

  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart < 0) {
    return undefined;
  }

  try {
    const payload = JSON.parse(rawMessage.slice(jsonStart)) as EmbeddedBackendErrorPayload;
    if (payload && typeof payload === 'object') {
      return payload;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const getWorkspacePathFromDetails = (details: unknown): string | undefined => {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const workspacePath = (details as WorkspacePathErrorDetails).workspace_path;
  return typeof workspacePath === 'string' && workspacePath.trim() ? workspacePath : undefined;
};

const getWorkspacePathErrorPayload = (error: unknown): EmbeddedBackendErrorPayload | undefined => {
  if (isBackendHttpError(error)) {
    return {
      code: error.code,
      error: error.backendMessage,
      details: error.details,
    };
  }

  return getEmbeddedBackendErrorPayload(error);
};

export const getWorkspacePathFromErrorDetails = (error: unknown): string | undefined => {
  const payload = getWorkspacePathErrorPayload(error);
  return getWorkspacePathFromDetails(payload?.details);
};

export const normalizeWorkspacePathErrorCode = (error: unknown): WorkspacePathErrorCode | undefined => {
  const payload = getWorkspacePathErrorPayload(error);
  if (payload) {
    const mappedCode = payload.code ? BACKEND_ERROR_CODE_MAP[payload.code] : undefined;
    if (mappedCode) {
      return mappedCode;
    }

    const matchedLegacyPattern = LEGACY_BACKEND_MESSAGE_PATTERNS.find(({ pattern }) =>
      pattern.test(payload.error ?? '')
    );
    if (matchedLegacyPattern) {
      return matchedLegacyPattern.code;
    }
  }

  return undefined;
};

const getErrorCodeProperty = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

const getRawErrorMessage = (error: unknown): string => {
  const payload = getWorkspacePathErrorPayload(error);
  if (payload?.error) return payload.error;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const parsed = parseError(error);
  return typeof parsed === 'string' ? parsed : '';
};

export const normalizeConversationCreateErrorCode = (error: unknown): ConversationCreateErrorCode | undefined => {
  const workspaceCode = normalizeWorkspacePathErrorCode(error);
  if (workspaceCode === 'WORKSPACE_PATH_UNAVAILABLE') {
    return workspaceCode;
  }

  const payload = getWorkspacePathErrorPayload(error);
  const mappedCode = payload?.code ? TEAM_BACKEND_ERROR_CODE_MAP[payload.code] : undefined;
  if (mappedCode) {
    return mappedCode;
  }

  const errorCode = getErrorCodeProperty(error);
  if (errorCode && TEAM_BACKEND_ERROR_CODE_MAP[errorCode]) {
    return TEAM_BACKEND_ERROR_CODE_MAP[errorCode];
  }

  // AionCore provisioning returns this as a plain InvalidRequest message with no
  // dedicated code; the renderer also throws ClaudeTeamProviderRequiredError with
  // the same text before calling create.
  if (CLAUDE_TEAM_PROVIDER_REQUIRED_PATTERN.test(getRawErrorMessage(error))) {
    return 'CLAUDE_TEAM_PROVIDER_REQUIRED';
  }

  return undefined;
};

export const normalizeConversationRuntimeWorkspaceErrorCode = (
  error: unknown
): ConversationRuntimeWorkspaceErrorCode | undefined => {
  const code = normalizeWorkspacePathErrorCode(error);
  return code === 'WORKSPACE_PATH_RUNTIME_UNAVAILABLE' ? code : undefined;
};

export const getConversationCreateErrorMessage = (error: unknown, t: TFunction): string => {
  const normalizedCode = normalizeConversationCreateErrorCode(error);
  const payload = getWorkspacePathErrorPayload(error);
  const workspacePath = getWorkspacePathFromErrorDetails(error);
  const rawMessage = payload?.error || parseError(error) || t('conversation.createFailed');

  if (normalizedCode && workspacePath) {
    return t(`conversation.createError.pathVariants.${normalizedCode}`, {
      workspacePath,
      defaultValue: rawMessage,
    });
  }

  const details =
    payload?.details && typeof payload.details === 'object' && !Array.isArray(payload.details)
      ? (payload.details as TeamAssistantErrorDetails)
      : undefined;
  if (normalizedCode === 'TEAM_ASSISTANT_ID_REQUIRED') {
    return t('conversation.createError.codes.TEAM_ASSISTANT_ID_REQUIRED', {
      defaultValue: rawMessage,
    });
  }
  if (normalizedCode === 'TEAM_ASSISTANT_NOT_FOUND') {
    return t('conversation.createError.codes.TEAM_ASSISTANT_NOT_FOUND', {
      assistantId: details?.assistant_id,
      defaultValue: rawMessage,
    });
  }
  if (normalizedCode === 'TEAM_ASSISTANT_FIELD_UNSUPPORTED') {
    return t('conversation.createError.codes.TEAM_ASSISTANT_FIELD_UNSUPPORTED', {
      field: details?.field || 'backend',
      defaultValue: rawMessage,
    });
  }
  if (normalizedCode === 'CLAUDE_TEAM_PROVIDER_REQUIRED') {
    return t('team.create.claudeProviderRequired', {
      defaultValue:
        'Enable an Anthropic or CPA provider that supports Claude models before creating a Claude team.',
    });
  }

  return rawMessage;
};

/**
 * User-facing copy for team membership operations (create/add/sync/rebuild).
 * Prefers localized create-error codes (including Claude provider setup), then
 * the concrete Error.message, then an optional operation-specific fallback.
 */
export const getTeamMembershipErrorMessage = (
  error: unknown,
  t: TFunction,
  fallback?: string
): string => {
  // Known create/setup codes (Claude provider missing, workspace path, …) first.
  if (normalizeConversationCreateErrorCode(error)) {
    return getConversationCreateErrorMessage(error, t);
  }

  // Prefer real Error / string messages; avoid parseError(object) → "{}" noise.
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();

  if (fallback?.trim()) return fallback.trim();
  return getConversationCreateErrorMessage(error, t);
};

export const getConversationRuntimeWorkspaceErrorMessage = (error: unknown, t: TFunction): string => {
  const normalizedCode = normalizeConversationRuntimeWorkspaceErrorCode(error);
  const payload = getWorkspacePathErrorPayload(error);
  const workspacePath = getWorkspacePathFromErrorDetails(error);
  const rawMessage = payload?.error || parseError(error) || t('common.unknownError');

  if (normalizedCode) {
    if (workspacePath) {
      return t(`conversation.agentError.codes.${normalizedCode}.bodyWithPath`, {
        workspacePath,
        defaultValue: rawMessage,
      });
    }

    return t(`conversation.agentError.codes.${normalizedCode}.body`, {
      defaultValue: rawMessage,
    });
  }

  return rawMessage;
};
