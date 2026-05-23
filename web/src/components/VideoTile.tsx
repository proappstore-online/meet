import { useRef, useEffect } from 'react'

interface VideoTileProps {
  stream: MediaStream | null
  muted?: boolean
  label: string
  mirrored?: boolean
  fill?: boolean
}

export function VideoTile({ stream, muted = false, label, mirrored = false, fill = false }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${
      fill ? 'h-full w-full' : 'aspect-video rounded-2xl border border-[var(--line)]'
    } bg-[var(--panel)]`}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full object-cover ${mirrored ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
            <svg className="h-8 w-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          </div>
          <span className="text-xs text-white/40">Waiting...</span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[0.65rem] font-medium text-white backdrop-blur-sm">
        {label}
      </span>
    </div>
  )
}
