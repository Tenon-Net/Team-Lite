export type AcpModelInfo = {
  current_model_id?: string
  available_models?: Array<{ id: string; name?: string }>
}

export type GetConfigOptionsResponse = {
  options?: AcpConfigOption[]
  current_mode_id?: string
  models?: AcpModelInfo
}

export type AcpConfigOption = {
  id: string
  name?: string
  description?: string
  type?: string
  options?: Array<{ value: string; name?: string }>
}

export type SetConfigOptionRequest = {
  option_id: string
  value: string
}

export type SetConfigOptionResponse = {
  ok?: boolean
}

export type EnsureConversationRuntimeResponse = {
  ready?: boolean
}
