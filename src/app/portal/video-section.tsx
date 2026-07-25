import { portalVideoUrl } from '@/lib/media/urls'

/**
 * David's video, on the investor's portal. BUILD_SPEC §13.3.
 *
 * This component is rendered only when there is a published video, so there is
 * no empty state below and no placeholder anywhere: *"If he never records one,
 * the portal shows no gap where it would have been."* The decision is
 * `shouldShowVideoSection` and it is made by the page, not here.
 *
 * The caption and transcript are rendered as text on the page, not behind a
 * control. §13.3: *"Some recipients will open this somewhere they cannot play
 * sound."* For those readers the transcript is the video, and something you
 * have to find and click is something you do not read.
 */
export function VideoSection({
  videoId,
  contentType,
  caption,
  transcript,
}: {
  videoId: string
  contentType: string
  caption: string | null
  transcript: string | null
}) {
  return (
    <section className="mt-10">
      <div className="rounded-sm border hairline bg-paper p-5">
        <h2 className="text-sm font-semibold text-white">A note from David</h2>

        {/*
          No `caption` track file exists — the text alternative below is the
          accessible equivalent and is always on the page. The lint rule asks
          for a <track>, which would mean generating WebVTT from the same
          field; that is worth doing if a second video ever exists.
        */}
        <video
          controls
          playsInline
          preload="metadata"
          className="mt-4 w-full rounded-sm bg-ink"
          aria-describedby={transcript ? 'video-transcript' : undefined}
        >
          <source src={portalVideoUrl(videoId)} type={contentType} />
          Your browser cannot play this video. The transcript below says the same thing.
        </video>

        {caption ? <p className="mt-3 text-sm leading-relaxed text-silver2">{caption}</p> : null}

        {transcript ? (
          <div className="mt-5 border-t hairline pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-silver2">
              What David says
            </h3>
            <p
              id="video-transcript"
              className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-dim"
            >
              {transcript}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
