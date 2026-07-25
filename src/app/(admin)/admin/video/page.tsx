import type { Metadata } from 'next'
import Link from 'next/link'
import {
  publishVideoAction,
  removeVideoAction,
  unpublishVideoAction,
  updateVideoTextAction,
} from '@/actions/video'
import { ActionForm } from '@/components/admin/action-form'
import {
  Card,
  Checkbox,
  Field,
  Notice,
  Pill,
  SectionHeading,
  TextArea,
  TextInput,
} from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { MAX_VIDEO_BYTES } from '@/lib/media/formats'
import { mediaStore, MEDIA_STORE_UNCONFIGURED } from '@/lib/media/store'
import { adminVideoPreviewUrl, videoUploadUrl } from '@/lib/media/urls'
import { videoTextAlternative } from '@/lib/media/video'
import { currentVideo } from '@/lib/media/video-store'
import { VideoRecorder } from './recorder'

export const metadata: Metadata = {
  title: 'Personal video — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * David's personal video. BUILD_SPEC §13.3.
 *
 * The owner reaches this page and sees the preview; every control that writes
 * is refused for him by `requireOperator()` inside the action. §13.3 is about
 * one person's video, and the owner watching it is a different thing from the
 * owner recording it.
 *
 * The test-email prompt sits directly under the publish control rather than on
 * the sending screen, because §13.3 asks for it *"in the flow, not a feature
 * he has to find"* — and the moment he has just published a video is the
 * moment he wants to see what the whole thing looks like arriving.
 */
export default async function VideoPage() {
  const admin = await requireOnboardedAdmin()
  const isOperator = admin.role === 'OPERATOR'

  const store = mediaStore()
  const video = store ? await currentVideo() : null
  const text = video ? videoTextAlternative(video) : null

  return (
    <>
      <SectionHeading eyebrow="Optional" title="A short personal video">
        Entirely your call, and removable at any time. If you never record one, the portal
        shows no gap where it would have been &mdash; nothing about it appears at all.
      </SectionHeading>

      <div className="space-y-4">
        {!store ? (
          <Card title="There is nowhere to store a video yet" tone="warn">
            <p className="text-sm leading-relaxed text-silver2">{MEDIA_STORE_UNCONFIGURED}</p>
          </Card>
        ) : null}

        {!isOperator ? (
          <Card title="This one is David's" tone="warn">
            <p className="text-sm leading-relaxed text-silver2">
              You can watch whatever is here. Recording, replacing, publishing and removing are
              the operator&rsquo;s alone &mdash; §13.3 is written about his video, and the
              controls below will refuse you.
            </p>
          </Card>
        ) : null}

        {/* --- Current state ------------------------------------------- */}
        {video ? (
          <Card title="What is here now">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {video.publishedAt ? (
                <Pill tone="ok">On the portal</Pill>
              ) : (
                <Pill tone="neutral">Not published &mdash; nobody but you can see it</Pill>
              )}
              <Pill tone="neutral">{video.contentType.replace('video/', '')}</Pill>
              <Pill tone="neutral">
                {Math.max(1, Math.round(video.sizeBytes / (1024 * 1024)))} MB
              </Pill>
            </div>

            <video
              controls
              playsInline
              preload="metadata"
              src={adminVideoPreviewUrl(video.id)}
              className="w-full rounded-sm bg-ink"
            />

            <p className="mt-3 text-xs leading-relaxed text-dim">
              This is the same file, served the same way, that a signed-in investor gets. It is
              never indexed and never reachable without a session.
            </p>
          </Card>
        ) : store ? (
          <Card title="Nothing recorded yet">
            <p className="text-sm leading-relaxed text-silver2">
              The portal is complete without one. It is the single highest-leverage thing you
              could add to a raise of this kind, and it costs ten minutes with a phone &mdash;
              but nothing anywhere depends on it existing.
            </p>
          </Card>
        ) : null}

        {/* --- Record or upload ---------------------------------------- */}
        {store && isOperator ? (
          <Card
            title={video ? 'Replace it' : 'Record or upload'}
            description={`Up to ${MAX_VIDEO_BYTES / (1024 * 1024)} MB. MP4, WebM or QuickTime.`}
          >
            <VideoRecorder
              uploadUrl={videoUploadUrl()}
              maxBytes={MAX_VIDEO_BYTES}
              replacesPublished={video?.publishedAt != null}
            />
          </Card>
        ) : null}

        {/* --- Caption and transcript ---------------------------------- */}
        {video ? (
          <Card
            title="Caption and transcript"
            description="Some recipients will open the portal somewhere they cannot play sound. For them, this is the video."
          >
            <ActionForm action={updateVideoTextAction} submitLabel="Save">
              <Field
                label="Caption"
                name="caption"
                hint="One line, shown beside the player. Up to 160 characters."
              >
                <TextInput
                  name="caption"
                  maxLength={160}
                  defaultValue={text?.caption ?? ''}
                  placeholder="A short note from David about where Flipit is"
                />
              </Field>
              <Field
                label="Transcript"
                name="transcript"
                hint="What you said, in text. Shown in full — it is not hidden behind a control somebody has to find."
              >
                <TextArea name="transcript" rows={8} defaultValue={text?.transcript ?? ''} />
              </Field>
            </ActionForm>

            {!text?.hasText ? (
              <div className="mt-4">
                <Notice tone="warn">
                  There is neither a caption nor a transcript. Anyone who cannot play sound
                  &mdash; on a train, in an office, or using a screen reader &mdash; gets
                  nothing from this video at all.
                </Notice>
              </div>
            ) : null}
          </Card>
        ) : null}

        {/* --- Publish ------------------------------------------------- */}
        {video && !video.publishedAt ? (
          <Card
            title="Publish it"
            description="Until you do, no investor can reach it — not by guessing the address, not by any link."
          >
            <ActionForm action={publishVideoAction} submitLabel="Publish to the portal">
              <Checkbox
                name="confirm"
                value="PUBLISH"
                label="I have watched it above and I am happy for every investor to see it."
              />
            </ActionForm>
          </Card>
        ) : null}

        {video?.publishedAt ? (
          <>
            <Card title="Send yourself the whole thing" tone="ok">
              <p className="text-sm leading-relaxed text-silver2">
                Before any real invitation goes out, send yourself the complete email &mdash;
                the designed template, your figures, the portal link and this video behind it
                &mdash; and open it the way a recipient will. It is the only way to find out
                what it actually feels like to receive.
              </p>
              <p className="mt-4">
                <Link
                  href="/recipients"
                  className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink hover:bg-orange-soft"
                >
                  Go to review and send
                </Link>
              </p>
              <p className="mt-3 text-xs leading-relaxed text-dim">
                A test send goes to your own address and nowhere else &mdash; the send gate
                refuses one addressed anywhere but there.
              </p>
            </Card>

            <Card title="Take it down">
              <p className="mb-4 text-sm leading-relaxed text-silver2">
                Unpublishing leaves the file here and removes it from the portal. There is no
                gap where it was.
              </p>
              <ActionForm action={unpublishVideoAction} submitLabel="Unpublish" tone="quiet" />
            </Card>
          </>
        ) : null}

        {video ? (
          <Card title="Remove it altogether">
            <p className="mb-4 text-sm leading-relaxed text-silver2">
              Deletes the row and the stored file. §13.3 calls the whole feature optional and
              removable, and this is what that means.
            </p>
            <ActionForm
              action={removeVideoAction}
              submitLabel="Remove the video"
              tone="danger"
              hidden={{ videoId: video.id }}
            />
          </Card>
        ) : null}
      </div>
    </>
  )
}
