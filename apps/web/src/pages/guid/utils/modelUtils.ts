export function formatModelLabel(model?: string): string { return model ?? "" }
export function getAvailableModels(_providers?: unknown): Array<{ id: string; name?: string }> { return [] }
export function parseCompositeModelId(id?: string): { providerId?: string; modelId?: string } {
  if (!id) return {}
  const i = id.indexOf("/")
  if (i < 0) return { modelId: id }
  return { providerId: id.slice(0, i), modelId: id.slice(i + 1) }
}
export default { formatModelLabel, getAvailableModels, parseCompositeModelId }
