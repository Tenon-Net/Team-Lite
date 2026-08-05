export type AgentMetadata = {
  id: string
  name: string
  backend?: string
  enabled?: boolean
  agent_type?: string
}

export type ManagedAgent = AgentMetadata & {
  healthy?: boolean
  status?: string
}

export function getAgentModeOptionLabel(mode?: string): string {
  return mode ?? ''
}
