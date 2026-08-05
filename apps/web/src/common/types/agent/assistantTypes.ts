export type Assistant = {
  id: string
  assistant_id?: string
  name: string
  backend?: string
  description?: string
}

export function assistantRuntimeKey(assistant?: { id?: string; assistant_id?: string; backend?: string }): string {
  return assistant?.assistant_id ?? assistant?.id ?? assistant?.backend ?? 'unknown'
}
export type AssistantDetail = Assistant & { skills?: string[] }
export type CreateAssistantRequest = Partial<Assistant>
export type UpdateAssistantRequest = Partial<Assistant>
export type SetAssistantStateRequest = { id: string; enabled: boolean }
export type ImportAssistantsRequest = { items?: unknown[] }
export type ImportAssistantsResult = { imported: number }
