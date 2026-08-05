/** Minimal chatLib types/helpers used by team surfaces. */
export type IConfirmation<T = unknown> = {
  call_id: string
  payload?: T
}

export type IResponseMessage = {
  type?: string
  content?: string
  data?: unknown
  conversation_id?: string
}

export type TMessage = {
  id?: string
  msg_id?: string
  type?: string
  content?: string
  role?: string
  created_at?: number
  [key: string]: unknown
}

export function buildContextRelaySuccessorPrompt(_args?: unknown): string {
  return ''
}

export function createContextRelayFallback(_args?: unknown): TMessage[] {
  return []
}

export function redactContextRelayEvidence<T>(value: T): T {
  return value
}
