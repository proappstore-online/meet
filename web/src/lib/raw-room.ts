/**
 * Chunking adapter over the SDK Room.
 *
 * The platform caps room messages at 4KB, but WebRTC SDP/ICE payloads can
 * exceed that — so large sends are split into `_chunk` frames and reassembled
 * on receive. Everything else (auth, transport, reconnect, peers) is the SDK
 * Room: no raw session token in app code, and rooms run on PAS infra (not FAS).
 * Works in both `legacy-bearer` and `platform-cookie` modes.
 */

import type { Room, RoomMessage, RoomPeer, ConnectionState } from '@proappstore/sdk'

type Unsubscribe = () => void

export interface RawRoom {
  readonly state: ConnectionState
  send<T>(data: T): void
  onMessage<T>(listener: (msg: RoomMessage<T>) => void): Unsubscribe
  onPeers(listener: (peers: RoomPeer[]) => void): Unsubscribe
  onConnectionState(listener: (state: ConnectionState) => void): Unsubscribe
  close(): void
}

const MAX_UNCHUNKED = 3800 // leave headroom under the 4KB frame limit
const CHUNK_SIZE = 3000

export function createChunkedRoom(room: Room, log: (msg: string) => void): RawRoom {
  const listeners = new Set<(msg: RoomMessage) => void>()
  const chunkBuffers = new Map<string, { chunks: string[]; received: number; total: number }>()

  // Single upstream subscription; fan out to app listeners after reassembly.
  room.onMessage((msg) => {
    let data = msg.data as unknown
    const maybeChunk = data as { type?: string; id?: string; idx?: number; total?: number; chunk?: string }
    if (maybeChunk?.type === '_chunk') {
      const { id, idx, total, chunk } = maybeChunk as { id: string; idx: number; total: number; chunk: string }
      let buf = chunkBuffers.get(id)
      if (!buf) {
        buf = { chunks: new Array(total).fill(''), received: 0, total }
        chunkBuffers.set(id, buf)
      }
      buf.chunks[idx] = chunk
      buf.received++
      if (buf.received < total) return
      chunkBuffers.delete(id)
      try {
        data = JSON.parse(buf.chunks.join(''))
      } catch (e) {
        log(`chunked-room: reassembly failed: ${e}`)
        return
      }
    }
    const out: RoomMessage = { from: msg.from, data, at: msg.at }
    for (const l of listeners) l(out)
  })

  return {
    get state() {
      return room.state
    },

    send<T>(data: T) {
      const payload = JSON.stringify(data)
      if (payload.length <= MAX_UNCHUNKED) {
        room.send(data)
        return
      }
      const totalChunks = Math.ceil(payload.length / CHUNK_SIZE)
      const id = Math.random().toString(36).slice(2, 8)
      log(`chunked-room: send CHUNKED (${payload.length}B → ${totalChunks} chunks)`)
      for (let i = 0; i < totalChunks; i++) {
        const chunk = payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        room.send({ type: '_chunk', id, idx: i, total: totalChunks, chunk })
      }
    },

    onMessage<T>(listener: (msg: RoomMessage<T>) => void): Unsubscribe {
      listeners.add(listener as (msg: RoomMessage) => void)
      return () => {
        listeners.delete(listener as (msg: RoomMessage) => void)
      }
    },

    onPeers(listener: (peers: RoomPeer[]) => void): Unsubscribe {
      return room.onPeers(listener)
    },

    onConnectionState(listener: (state: ConnectionState) => void): Unsubscribe {
      return room.onConnectionState(listener)
    },

    close() {
      listeners.clear()
      chunkBuffers.clear()
      room.close()
    },
  }
}
