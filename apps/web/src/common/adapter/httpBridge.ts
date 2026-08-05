/**
 * HTTP/WS bridge factory — same-origin (Vite proxy) for Team-Lite web.
 * Ported/slimmed from zbbody-new common/adapter/httpBridge.ts (fork 11b72ca).
 */

export type HttpRequestOptions = {
  silentStatuses?: number[]
}

export class BackendHttpError extends Error {
  readonly status: number
  readonly code: string
  readonly backendMessage: string
  readonly details: unknown
  readonly body: unknown

  constructor(params: { method: string; path: string; status: number; body: unknown }) {
    const { method, path, status, body } = params
    let code = ''
    let backendMessage = ''
    let details: unknown
    if (body && typeof body === 'object') {
      const b = body as { code?: unknown; error?: unknown; details?: unknown }
      if (typeof b.code === 'string') code = b.code
      if (typeof b.error === 'string') backendMessage = b.error
      details = b.details
    } else if (typeof body === 'string') {
      backendMessage = body
    }
    super(`Backend ${method} ${path} failed (${status}): ${JSON.stringify(body)}`)
    this.name = 'BackendHttpError'
    this.status = status
    this.code = code
    this.backendMessage = backendMessage
    this.details = details
    this.body = body
  }
}

export function isBackendHttpError(error: unknown): error is BackendHttpError {
  if (error instanceof BackendHttpError) return true
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: unknown }).name === 'BackendHttpError' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return true
  }
  return false
}

/** Same-origin; Vite proxies /api and /ws to TEAM_LITE (default 127.0.0.1:3000). */
export function getBaseUrl(): string {
  return ''
}

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export async function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: HttpRequestOptions,
): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const headers: Record<string, string> = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const rawText = await response.text().catch(() => '')
    let errorBody: unknown
    try {
      errorBody = JSON.parse(rawText)
    } catch {
      errorBody = rawText
    }
    if (!options?.silentStatuses?.includes(response.status)) {
      console.error(`[httpBridge] ${method} ${path} → ${response.status}`, errorBody)
    }
    throw new BackendHttpError({ method, path, status: response.status, body: errorBody })
  }

  const contentType = response.headers.get('Content-Type')
  if (!contentType?.includes('application/json')) {
    return undefined as T
  }

  const json = await response.json()
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T
  }
  return json as T
}

type ProviderLike<Data, Params> = {
  provider: (handler: (params: Params) => Promise<Data>) => void
  invoke: Params extends undefined ? () => Promise<Data> : (params: Params) => Promise<Data>
}

export function withResponseMap<Raw, Mapped, Params>(
  inner: ProviderLike<Raw, Params>,
  map: (data: Raw) => Mapped,
): ProviderLike<Mapped, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const raw = await (inner.invoke as (p?: Params) => Promise<Raw>)(params)
      return map(raw)
    }) as ProviderLike<Mapped, Params>['invoke'],
  }
}

export function httpGet<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  options?: HttpRequestOptions,
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path
      return httpRequest<Data>('GET', resolvedPath, undefined, options)
    }) as ProviderLike<Data, Params>['invoke'],
  }
}

export function httpPost<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown,
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path
      const body = mapBody ? mapBody(params!) : params
      return httpRequest<Data>('POST', resolvedPath, body)
    }) as ProviderLike<Data, Params>['invoke'],
  }
}

export function httpPatch<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown,
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path
      const body = mapBody ? mapBody(params!) : params
      return httpRequest<Data>('PATCH', resolvedPath, body)
    }) as ProviderLike<Data, Params>['invoke'],
  }
}

export function httpDelete<Data, Params = undefined>(
  path: string | ((params: Params) => string),
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path
      return httpRequest<Data>('DELETE', resolvedPath)
    }) as ProviderLike<Data, Params>['invoke'],
  }
}

// WebSocket singleton
type WsCallback = (data: unknown) => void
const REALTIME_RECONNECTED_EVENT = 'realtime.reconnected'
const wsListeners = new Map<string, Set<WsCallback>>()
let ws: WebSocket | null = null
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
let wsReconnectAttempt = 0
let wsHasOpened = false

function dispatchWsEvent(eventName: string, payload: unknown): void {
  const handlers = wsListeners.get(eventName)
  if (!handlers) return
  for (const handler of handlers) {
    try {
      handler(payload)
    } catch {
      /* never crash listener */
    }
  }
}

function ensureWs(): void {
  if (typeof window === 'undefined') return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const url = getWsUrl()
  try {
    ws = new WebSocket(url)
  } catch {
    scheduleWsReconnect()
    return
  }

  const current = ws
  current.addEventListener('open', () => {
    const isReconnect = wsHasOpened
    wsHasOpened = true
    wsReconnectAttempt = 0
    if (isReconnect) {
      dispatchWsEvent(REALTIME_RECONNECTED_EVENT, { timestamp: Date.now() })
    }
  })
  current.addEventListener('close', () => {
    if (ws === current) ws = null
    scheduleWsReconnect()
  })
  current.addEventListener('error', () => {
    current.close()
  })
  current.addEventListener('message', (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as {
        name?: string
        event?: string
        data?: unknown
        payload?: unknown
      }
      const eventName = msg.name ?? msg.event
      const payload = msg.data ?? msg.payload
      if (eventName) dispatchWsEvent(eventName, payload)
    } catch {
      /* ignore non-JSON */
    }
  })
}

function scheduleWsReconnect(): void {
  if (wsReconnectTimer) return
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempt), 30000)
  wsReconnectAttempt++
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null
    ensureWs()
  }, delay)
}

type EmitterLike<Params> = {
  on: (callback: Params extends undefined ? () => void : (params: Params) => void) => () => void
  emit: Params extends undefined ? () => void : (params: Params) => void
}

export function wsEmitter<Params = undefined>(eventName: string): EmitterLike<Params> {
  return {
    on: (callback: (params: Params) => void) => {
      ensureWs()
      if (!wsListeners.has(eventName)) {
        wsListeners.set(eventName, new Set())
      }
      const cb = callback as WsCallback
      wsListeners.get(eventName)!.add(cb)
      return () => {
        wsListeners.get(eventName)?.delete(cb)
      }
    },
    emit: (() => {}) as EmitterLike<Params>['emit'],
  }
}

export function wsMappedEmitter<Params = undefined>(
  eventName: string,
  transform: (raw: unknown) => Params,
): EmitterLike<Params> {
  const inner = wsEmitter<unknown>(eventName)
  return {
    on: (callback: (params: Params) => void) => {
      return inner.on((raw) => {
        callback(transform(raw))
      })
    },
    emit: (() => {}) as EmitterLike<Params>['emit'],
  }
}

export type { ProviderLike, EmitterLike }
