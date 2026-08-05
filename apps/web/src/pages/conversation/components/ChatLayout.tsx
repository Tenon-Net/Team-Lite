// @ts-nocheck
/** Minimal ChatLayout stub — accepts upstream prop bag. */
import type { ReactNode } from 'react'

export default function ChatLayout(props: Record<string, unknown> & { children?: ReactNode }) {
  return <div className="team-lite-chat-layout">{props.children}</div>
}
