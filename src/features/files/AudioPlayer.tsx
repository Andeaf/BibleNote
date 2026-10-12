import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '@/i18n/ro'
import { formatDuration } from '@/lib/files'

const SPEEDS = [1, 1.25, 1.5, 2] as const
const SKIP_SECONDS = 15
const speedLabel = (speed: number) => `${String(speed).replace('.', ',')}×`

interface AudioPlayerProps {
  src: string
  /** Measured at recording time: WebM from Chrome has no duration in its header. */
  knownDuration: number | null
}

/** Play/pause, a seek bar, ±15 s and speeds 1× / 1,25× / 1,5× / 2× (docs/PLAN.md §5.5). */
export function AudioPlayer({ src, knownDuration }: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [mediaDuration, setMediaDuration] = useState<number | null>(null)
  const [speed, setSpeed] = useState<number>(1)

  const duration = mediaDuration ?? knownDuration ?? 0

  useEffect(() => {
    const element = audio.current
    if (!element) return
    // A new source resets playbackRate to the default rate: set both.
    element.defaultPlaybackRate = speed
    element.playbackRate = speed
  }, [speed, src])

  function readDuration() {
    const value = audio.current?.duration
    setMediaDuration(value !== undefined && Number.isFinite(value) && value > 0 ? value : null)
  }

  function seek(to: number) {
    const element = audio.current
    if (!element) return
    const max = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
    element.currentTime = Math.min(Math.max(0, to), max)
    setTime(element.currentTime)
  }

  function toggle() {
    const element = audio.current
    if (!element) return
    if (element.paused) void element.play().catch(() => undefined)
    else element.pause()
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={readDuration}
        onDurationChange={readDuration}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <input
        type="range"
        min={0}
        max={Math.max(duration, time, 1)}
        step={0.1}
        value={time}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label={t.files.player.seek}
        aria-valuetext={formatDuration(time)}
        className="h-11 w-full accent-accent"
      />
      <div className="flex justify-between text-sm text-muted tabular-nums">
        <span>{formatDuration(time)}</span>
        <span>{duration > 0 ? formatDuration(duration) : '–:––'}</span>
      </div>
      <div className="mt-3 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => seek(time - SKIP_SECONDS)}
          className="flex size-12 items-center justify-center rounded-full text-muted hover:bg-canvas hover:text-ink"
          aria-label={t.files.player.back}
        >
          <RotateCcw className="size-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={toggle}
          className="flex size-16 items-center justify-center rounded-full bg-accent text-white shadow-md hover:brightness-110"
          aria-label={playing ? t.files.player.pause : t.files.player.play}
        >
          {playing ? (
            <Pause className="size-7" aria-hidden="true" />
          ) : (
            <Play className="size-7 translate-x-0.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => seek(time + SKIP_SECONDS)}
          className="flex size-12 items-center justify-center rounded-full text-muted hover:bg-canvas hover:text-ink"
          aria-label={t.files.player.forward}
        >
          <RotateCw className="size-6" aria-hidden="true" />
        </button>
      </div>
      <div
        role="group"
        aria-label={t.files.player.speed}
        className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-canvas p-1"
      >
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSpeed(value)}
            aria-pressed={speed === value}
            className={`min-h-11 rounded-lg text-sm font-medium ${
              speed === value ? 'bg-surface text-accent shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {speedLabel(value)}
          </button>
        ))}
      </div>
    </div>
  )
}
