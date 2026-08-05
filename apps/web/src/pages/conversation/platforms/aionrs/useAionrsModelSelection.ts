// @ts-nocheck
/** E5: aionrs model mall dropped — return empty selection. */
export function useAionrsModelSelection(_args?: {
  initialModel?: unknown
  onSelectModel?: (provider: unknown, modelName: string) => Promise<boolean>
}) {
  return {
    model: undefined as unknown,
    providers: [] as unknown[],
    selectModel: async () => false,
    loading: false,
  }
}
export default useAionrsModelSelection
