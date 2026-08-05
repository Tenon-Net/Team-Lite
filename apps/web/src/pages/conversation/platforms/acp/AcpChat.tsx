// @ts-nocheck
/**
 * Thin ACP chat surface for Team-Lite.
 * Full upstream AcpChat is not ported; team messaging goes through teamSendMessage
 * (POST /api/teams/:id/agents/:slot/messages) and history via conversation messages API.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Space, Spin, Typography } from '@arco-design/web-react'
import { ipcBridge } from '@/common'
import { httpRequest } from '@/common/adapter/httpBridge'

type Props = {
  conversation_id: string
  workspace?: string
  backend?: string
  session_mode?: string
  agent_name?: string
  hideSendBox?: boolean
  emptySlot?: React.ReactNode
  teamSendMessage?: (payload: { input: string; files: string[] }) => Promise<void>
  teamRuntime?: {
    statusText?: string
    canSend?: boolean
    onStop?: () => void | Promise<void>
  }
  loadedSkills?: string[]
  loadedMcpServers?: string[]
  loadedMcpStatuses?: unknown[]
  historySourceConversationId?: string
  initialModelId?: string
  routedModelInfo?: unknown
  onCurrentModelIdChange?: (modelId: string) => void
}

type Msg = {
  id: string
  type?: string
  content?: unknown
  status?: string
  created_at?: number
}

function contentToText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
    if (typeof c.content === 'string') return c.content
    try {
      return JSON.stringify(content)
    } catch {
      return String(content)
    }
  }
  return String(content)
}

const AcpChat: React.FC<Props> = ({
  conversation_id,
  workspace,
  backend,
  agent_name,
  hideSendBox,
  emptySlot,
  teamSendMessage,
  teamRuntime,
}) => {
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const loadMessages = useCallback(async () => {
    try {
      const page = await httpRequest<{ items: Msg[] }>(
        'GET',
        `/api/conversations/${encodeURIComponent(conversation_id)}/messages?limit=100`,
      )
      setMessages(Array.isArray(page?.items) ? page.items : [])
      setError(null)
    } catch (e) {
      // Conversation may exist before any messages; keep quiet unless repeated.
      setMessages((prev) => prev)
      if (e instanceof Error) setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [conversation_id])

  useEffect(() => {
    setLoading(true)
    void loadMessages()
    const timer = window.setInterval(() => {
      void loadMessages()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [loadMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const onSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      if (teamSendMessage) {
        await teamSendMessage({ input: text, files: [] })
      } else {
        await ipcBridge.conversation.sendMessage.invoke({
          conversation_id,
          content: text,
        })
      }
      setInput('')
      // Optimistic user line
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          type: 'user',
          content: text,
          created_at: Date.now(),
        },
      ])
      window.setTimeout(() => void loadMessages(), 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [conversation_id, input, loadMessages, sending, teamSendMessage])

  const canSend = teamRuntime?.canSend !== false && !hideSendBox

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border-2, #e5e6eb)',
          fontSize: 12,
          color: 'var(--color-text-3, #86909c)',
        }}
      >
        {agent_name ?? 'agent'} · {backend ?? 'acp'}
        {workspace ? ` · ${workspace}` : ''}
        {teamRuntime?.statusText ? ` · ${teamRuntime.statusText}` : ''}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {loading && messages.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : null}
        {!loading && messages.length === 0 ? emptySlot ?? (
          <Typography.Text type="secondary">暂无消息，在下方输入目标开始协作。</Typography.Text>
        ) : null}
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          {messages.map((m) => {
            const text = contentToText(m.content)
            const isUser = (m.type ?? '').toLowerCase().includes('user')
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: isUser
                    ? 'var(--color-primary-light-1, #e8f3ff)'
                    : 'var(--color-fill-2, #f2f3f5)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
                  {isUser ? 'you' : agent_name ?? m.type ?? 'assistant'}
                  {m.status ? ` · ${m.status}` : ''}
                </div>
                {text || <em style={{ opacity: 0.5 }}>(empty)</em>}
              </div>
            )
          })}
        </Space>
        <div ref={bottomRef} />
      </div>

      {error ? (
        <Typography.Text type="error" style={{ padding: '0 12px 8px', fontSize: 12 }}>
          {error}
        </Typography.Text>
      ) : null}

      {!hideSendBox ? (
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--color-border-2, #e5e6eb)',
            display: 'flex',
            gap: 8,
          }}
        >
          <Input.TextArea
            value={input}
            onChange={setInput}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder={canSend ? '输入消息发给该成员…' : teamRuntime?.statusText || '暂不可发送'}
            disabled={!canSend || sending}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button type="primary" loading={sending} disabled={!canSend || !input.trim()} onClick={() => void onSend()}>
              发送
            </Button>
            {teamRuntime?.onStop ? (
              <Button onClick={() => void teamRuntime.onStop?.()}>停止</Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default AcpChat
