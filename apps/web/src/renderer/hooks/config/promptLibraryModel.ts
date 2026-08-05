export function usePromptLibraryModel() {
  return { items: [] as unknown[], loading: false }
}

export function insertPromptText(
  current: string | undefined,
  insert: string,
  _opts?: unknown,
): string {
  if (!current) return insert
  if (!insert) return current
  return `${current}${current.endsWith('\n') ? '' : '\n'}${insert}`
}

export default usePromptLibraryModel
