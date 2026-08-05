export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Upstream helper used by badge stacks — no-op remove. */
export function removeStack<T>(stack: T[], _predicate: (item: T) => boolean): T[] {
  return stack
}

export default { cn, removeStack }
