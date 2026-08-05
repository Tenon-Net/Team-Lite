/** Minimal storage types for team UI (provider mall dropped). */
export type TProviderWithModel = {
  provider_id?: string
  model?: string
  use_model?: string
  id?: string
  name?: string
  platform?: string
}

export type TChatConversation = {
  id: string
  name?: string
  type?: string
  model?: TProviderWithModel
  extra?: Record<string, unknown>
  status?: string
  user_id?: string
  workspace?: string
}

export type IProvider = {
  id: string
  name: string
  platform?: string
  models?: string[]
  enabled?: boolean
  use_model?: string
}

export type TConversationRuntimeSummary = {
  status?: string
  mode?: string
}

export type ICssTheme = Record<string, string>
export type IMcpServer = { id: string; name?: string }
export type ISessionMcpServer = IMcpServer
