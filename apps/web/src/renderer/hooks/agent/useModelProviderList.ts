/** E5: provider mall dropped — empty list. */
export function useProvidersQuery() {
  return { data: [] as unknown[], isLoading: false, error: undefined }
}
export function useModelProviderList() {
  return { providers: [] as unknown[], loading: false }
}
export default useModelProviderList
