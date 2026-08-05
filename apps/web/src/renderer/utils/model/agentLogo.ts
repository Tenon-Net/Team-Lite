export function getAgentLogo(_backend?: string): string | undefined { return undefined }
export function resolveAgentAvatar(_agent?: unknown): string | undefined { return undefined }
export function resolveAgentLogo(_agent?: unknown): string | undefined { return undefined }
export function useAgentLogos() { return { logos: {} as Record<string, string>, loading: false } }
export default { getAgentLogo, resolveAgentAvatar, resolveAgentLogo, useAgentLogos }
