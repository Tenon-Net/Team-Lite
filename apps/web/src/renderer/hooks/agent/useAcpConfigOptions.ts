export function classifyConfigSetError(_error: unknown): string {
  return 'failed'
}

export function findConfigOption(_options: unknown, _id: string): unknown {
  return undefined
}

export function findConfigOptionById(_options: unknown, _id: string): unknown {
  return undefined
}

export function hasObservedValue(_option: unknown): boolean {
  return false
}

export function revalidateAcpConfigOptions(_conversationId?: string): Promise<void> {
  return Promise.resolve()
}

export function deriveSelectOption(_option: unknown): unknown {
  return undefined
}

export function getRuntimeConfigOptionsKey(conversationId: string): string {
  return `acp-config:${conversationId}`
}

export type AcpConfigOptionsLoader = (conversationId: string) => Promise<unknown>
export type AcpConfigSetStatus = string
export type AcpDerivedOption = { id: string; value?: string }

export function useAcpConfigOptions(_args?: Record<string, unknown>) {
  return {
    options: [] as unknown[],
    thoughtLevel: undefined as unknown,
    model: undefined as unknown,
    setStatus: 'idle' as string,
    isLoading: false,
    setConfigOption: async (_id: string, _value: string) => ({ ok: true }),
    reload: async () => undefined,
  }
}

export default useAcpConfigOptions
