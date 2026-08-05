export type SendBoxDraft = {
  content?: string
  atPath?: string[]
  uploadFile?: string[]
  _type?: string
  type?: string
  [key: string]: unknown
}
const drafts = new Map<string, SendBoxDraft>()
const keyOf = (surface: string, id: string) => `${surface}:${id}`
export function peekSendBoxDraft(surface: string, id: string): SendBoxDraft | undefined {
  return drafts.get(keyOf(surface, id))
}
export function seedSendBoxDraft(surface: string, id: string, draft: SendBoxDraft): void {
  drafts.set(keyOf(surface, id), draft)
}
export function useSendBoxDraft(_surface: string, _id: string) {
  return { draft: undefined as SendBoxDraft | undefined, setDraft: (_d: SendBoxDraft) => {} }
}
export function getSendBoxDraftHook(_surface: string) {
  return (id: string) => useSendBoxDraft(_surface, id)
}
export default useSendBoxDraft
