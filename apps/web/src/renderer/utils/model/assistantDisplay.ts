export function getAssistantDisplayName(assistant?: { name?: string; assistant_name?: string }): string {
  return assistant?.assistant_name ?? assistant?.name ?? ''
}

export function resolveAssistantName(assistant?: { name?: string; assistant_name?: string }): string {
  return getAssistantDisplayName(assistant)
}

export default { getAssistantDisplayName, resolveAssistantName }
