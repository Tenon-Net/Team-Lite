export function paginateMessages<T>(items: T[], _pageSize = 50): T[] {
  return items
}

export async function loadLatestConversationMessages(
  _conversationId: string,
  _opts?: { limit?: number },
): Promise<unknown[]> {
  return []
}

export default { paginateMessages, loadLatestConversationMessages }
