export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function parseError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function resolveLocaleKey(locale?: string): string {
  return locale?.trim() || 'en'
}

export default { sleep, parseError, resolveLocaleKey }
