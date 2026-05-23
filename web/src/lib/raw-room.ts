/**
 * Raw WebSocket room — bypasses the SDK Room class entirely.
 * Same protocol as the SDK, but with full visibility into what's happening.
 */

import type { RoomMessage, RoomPeer, ConnectionState } from '@freeappstore/sdk'

type Unsubscribe = () => void

export interface RawRoom {
  readonly state: ConnectionState
  send<T>(data: T): void
  onMessage<T>(listener: (msg: RoomMessage<T>) => void): Unsubscribe
  onPeers(listener: (peers: RoomPeer[]) => void): Unsubscribe
  onConnectionState(listener: (state: ConnectionState) => void): Unsubscribe
  close(): void
}

export function createRawRoom(
  appId: string,
  roomId: string,
  token: string,
  log: (msg: string) => void,
): RawRoom {
  const listeners = new Set<(msg: RoomMessage) => void>()
  const peerListeners = new Set<(peers: RoomPeer[]) => void>()
  const stateListeners = new Set<(state: ConnectionState) => void>()
  let peers: RoomPeer[] = []
  let ws: WebSocket | null = null
  let connectionState: ConnectionState = 'connecting'
  let closed = false

  function setState(s: ConnectionState) {
    if (connectionState === s) return
    connectionState = s
    log(`raw-room: state → ${s}`)
    for (const l of stateListeners) l(s)
  }

  function connect() {
    if (closed) return
    const url = new URL(`/v1/apps/${appId}/rooms/${roomId}`, 'wss://api.freeappstore.online')
    url.searchParams.set('token', token)
    log(`raw-room: connecting to ${url.pathname}`)
    setState('connecting')

    const socket = new WebSocket(url.toString())
    ws = socket

    socket.addEventListener('open', () => {
      log('raw-room: WebSocket open')
      setState('open')
    })

    socket.addEventListener('message', (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : ''
      log(`raw-room: ws recv: ${raw.slice(0, 200)}`)
      try {
        const parsed = JSON.parse(raw)
        if (parsed.kind === 'msg') {
          log(`raw-room: msg from=${parsed.from?.login} type=${parsed.data?.type} listeners=${listeners.size}`)
          const msg: RoomMessage = { from: parsed.from, data: parsed.data, at: parsed.at }
          for (const l of listeners) {
            l(msg)
          }
        } else if (parsed.kind === 'peers') {
          peers = parsed.peers
          log(`raw-room: peers=[${peers.map((p: RoomPeer) => p.login).join(', ')}]`)
          for (const l of peerListeners) l(peers)
        } else if (parsed.kind === 'error') {
          log(`raw-room: server error: ${parsed.error}`)
        }
      } catch (e) {
        log(`raw-room: parse error: ${e}`)
      }
    })

    socket.addEventListener('close', () => {
      log('raw-room: WebSocket closed')
      ws = null
      if (!closed) {
        setState('closed')
        setTimeout(() => { if (!closed) connect() }, 2000)
      }
    })

    socket.addEventListener('error', () => {
      log('raw-room: WebSocket error')
      setState('error')
    })
  }

  connect()

  const room: RawRoom = {
    get state() { return connectionState },

    send<T>(data: T) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        log(`raw-room: send DROPPED (ws=${ws ? ws.readyState : 'null'})`)
        return
      }
      const payload = JSON.stringify({ kind: 'msg', data })
      log(`raw-room: send type=${(data as any)?.type}`)
      ws.send(payload)
    },

    onMessage<T>(listener: (msg: RoomMessage<T>) => void): Unsubscribe {
      listeners.add(listener as (msg: RoomMessage) => void)
      log(`raw-room: onMessage subscribed (count=${listeners.size})`)
      return () => {
        listeners.delete(listener as (msg: RoomMessage) => void)
        log(`raw-room: onMessage unsubscribed (count=${listeners.size})`)
      }
    },

    onPeers(listener: (peers: RoomPeer[]) => void): Unsubscribe {
      peerListeners.add(listener)
      listener(peers)
      return () => { peerListeners.delete(listener) }
    },

    onConnectionState(listener: (state: ConnectionState) => void): Unsubscribe {
      stateListeners.add(listener)
      listener(connectionState)
      return () => { stateListeners.delete(listener) }
    },

    close() {
      closed = true
      ws?.close()
      ws = null
      setState('closed')
      listeners.clear()
      peerListeners.clear()
      stateListeners.clear()
    },
  }

  return room
}
