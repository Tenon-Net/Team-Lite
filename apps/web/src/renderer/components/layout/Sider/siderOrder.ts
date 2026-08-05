export const defaultSiderOrder: string[] = []

export function readStoredSiderOrder(): string[] {
  return []
}

export function writeStoredSiderOrder(_order: string[]): void {}

export function sortSiderItemsByStoredOrder<T extends { id?: string; key?: string }>(
  items: T[],
  _order?: string[],
): T[] {
  return items
}

export default defaultSiderOrder
