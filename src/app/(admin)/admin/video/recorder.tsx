'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The two ways a video gets in. BUILD_SPEC §13.3: *"record directly in the
 * browser via webcam, or upload a file shot on his phone. Both land in the
 * same place."*
 *
 * Both post the same field to the same endpoint, so "the same place" is not a
 * figure of speech — there is one route, one gate and one ingest behind both
 * buttons, and neither path can acquire a rule the other does not have.
 *
 * This component holds a camera stream and a recorded blob and nothing else.
 * It decides nothing: the size limit, the format check and the metadata strip
 * all happen on the server, and every message shown here came from there.
 */

type Phase = 'IDLE' | 'ARMED' | 'RECORDING' | 'REVIEWING' | 'UPLOADING'

export function VideoRecorder({
  uploadUrl,
  maxBytes,
  replacesPublished,
}: {
  uploadUrl: string
  maxBytes: number
  /** True when a published video is about to be taken down by this upload. */
  replacesPublished: boolean
}) {
  const [phase, setPhase] = useState<Phase>('IDLE')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  const liveRef = useRef<HTMLVideoElement | null>(null)
  const reviewRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const blobRef = useRef<Blob | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const releaseCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (liveRef.current) liveRef.current.srcObject = null
  }, [])

  // The camera light staying on after somebody navigates away is the kind of
  // thing that makes a person distrust a page. Released on unmount, always.
  useEffect(() => () => {
    releaseCamera()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [releaseCamera])

  useEffect(() => {
    if (phase !== 'RECORDING') return
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  async function arm() {
    setError(null)
    setNotice(null)

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(
        'This browser will not give a page access to the camera. Record on your phone and use ' +
          'the upload button instead — it lands in exactly the same place.',
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (liveRef.current) {
        liveRef.current.srcObject = stream
        await liveRef.current.play().catch(() => undefined)
      }
      setPhase('ARMED')
    } catch {
      setError(
        'The camera was not available. Allow access in the browser’s address bar, or record on ' +
          'your phone and upload the file.',
      )
    }
  }

  function start() {
    const stream = streamRef.current
    if (!stream) return

    chunksRef.current = []
    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' })
      blobRef.current = blob
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = URL.createObjectURL(blob)
      if (reviewRef.current) reviewRef.current.src = objectUrlRef.current
      releaseCamera()
      setPhase('REVIEWING')
    }

    recorderRef.current = recorder
    setSeconds(0)
    recorder.start()
    setPhase('RECORDING')
  }

  function stop() {
    recorderRef.current?.stop()
  }

  function discard() {
    blobRef.current = null
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setSeconds(0)
    setPhase('IDLE')
  }

  const upload = useCallback(
    async (file: Blob, filename: string) => {
      setError(null)
      setNotice(null)

      if (file.size > maxBytes) {
        setError(
          `That is ${Math.round((file.size / (1024 * 1024)) * 10) / 10} MB and the limit is ` +
            `${maxBytes / (1024 * 1024)} MB. Record a shorter one, or export it smaller.`,
        )
        return
      }

      setPhase('UPLOADING')

      const body = new FormData()
      body.append('file', file, filename)

      try {
        const response = await fetch(uploadUrl, { method: 'POST', body })
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean
          message?: string
        } | null

        if (!response.ok || !payload?.ok) {
          setError(payload?.message ?? 'That upload did not go through. Nothing was stored.')
          setPhase(blobRef.current ? 'REVIEWING' : 'IDLE')
          return
        }

        setNotice(payload.message ?? 'Uploaded.')
        // Reload so the server-rendered preview, the publish control and the
        // audit trail on this page all reflect the new row. The page is the
        // source of truth about what exists; this component is not.
        window.location.reload()
      } catch {
        setError('That upload did not go through. Nothing was stored.')
        setPhase(blobRef.current ? 'REVIEWING' : 'IDLE')
      }
    },
    [maxBytes, uploadUrl],
  )

  const busy = phase === 'UPLOADING'

  return (
    <div className="space-y-4">
      {replacesPublished ? (
        <p className="border-l-2 border-warn pl-3 text-xs leading-relaxed text-dim">
          A video is published right now. Uploading a replacement <strong>takes it down</strong>{' '}
          — the new one arrives unpublished so you can watch it in place first, exactly as this
          one did. Your caption and transcript are carried across.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-sm border border-warn bg-warn/8 px-3 py-2.5 text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-sm border border-ok bg-ok/8 px-3 py-2.5 text-sm text-ok" role="status">
          {notice}
        </p>
      ) : null}

      {/* --- Record ---------------------------------------------------- */}
      <div className="rounded-sm border hairline bg-bg2 p-4">
        <h3 className="text-sm font-semibold text-white">Record here</h3>

        <video
          ref={liveRef}
          muted
          playsInline
          className={`mt-3 w-full rounded-sm bg-ink ${
            phase === 'ARMED' || phase === 'RECORDING' ? '' : 'hidden'
          }`}
        />
        <video
          ref={reviewRef}
          controls
          playsInline
          className={`mt-3 w-full rounded-sm bg-ink ${phase === 'REVIEWING' ? '' : 'hidden'}`}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {phase === 'IDLE' ? (
            <button type="button" onClick={arm} className={buttonClass('primary')} disabled={busy}>
              Turn the camera on
            </button>
          ) : null}

          {phase === 'ARMED' ? (
            <>
              <button type="button" onClick={start} className={buttonClass('primary')}>
                Start recording
              </button>
              <button
                type="button"
                onClick={() => {
                  releaseCamera()
                  setPhase('IDLE')
                }}
                className={buttonClass('quiet')}
              >
                Turn the camera off
              </button>
            </>
          ) : null}

          {phase === 'RECORDING' ? (
            <button type="button" onClick={stop} className={buttonClass('danger')}>
              Stop &mdash; {String(Math.floor(seconds / 60)).padStart(2, '0')}:
              {String(seconds % 60).padStart(2, '0')}
            </button>
          ) : null}

          {phase === 'REVIEWING' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const blob = blobRef.current
                  if (blob) void upload(blob, 'recording.webm')
                }}
                className={buttonClass('primary')}
              >
                Use this one
              </button>
              <button type="button" onClick={discard} className={buttonClass('quiet')}>
                Record it again
              </button>
            </>
          ) : null}

          {busy ? <span className="self-center text-sm text-dim">Uploading&hellip;</span> : null}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-dim">
          Nothing leaves this page until you press &ldquo;Use this one&rdquo;. Recording again
          discards what is here and sends nothing.
        </p>
      </div>

      {/* --- Upload ---------------------------------------------------- */}
      <div className="rounded-sm border hairline bg-bg2 p-4">
        <h3 className="text-sm font-semibold text-white">Or upload one from your phone</h3>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          Lands in exactly the same place, with the same checks. Location and device details
          are removed from an MP4 or a QuickTime file before it is stored.
        </p>
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file, file.name)
          }}
          className="mt-3 w-full min-h-11 rounded-sm border hairline bg-paper px-3 py-2.5 text-sm text-ftext file:mr-3 file:rounded-sm file:border-0 file:bg-orange file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
        />
      </div>
    </div>
  )
}

function buttonClass(tone: 'primary' | 'quiet' | 'danger'): string {
  const styles = {
    primary: 'bg-orange text-ink hover:bg-orange-soft',
    quiet: 'border hairline bg-transparent text-ftext hover:border-orange',
    danger: 'border border-warn bg-transparent text-warn hover:bg-warn/10',
  }[tone]

  return `inline-flex min-h-11 items-center justify-center rounded-sm px-4 text-sm font-semibold transition-colors disabled:cursor-progress disabled:opacity-60 ${styles}`
}
