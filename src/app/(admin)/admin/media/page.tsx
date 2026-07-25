import type { Metadata } from 'next'
import {
  listMedia,
  removeMediaAction,
  updateMediaDetailsAction,
  uploadMediaAction,
} from '@/actions/media'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, Pill, SectionHeading, TextArea, TextInput } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { IMAGE_FORMATS, MAX_IMAGE_BYTES } from '@/lib/media/formats'
import { mediaStore, MEDIA_STORE_UNCONFIGURED } from '@/lib/media/store'
import { mediaUrl } from '@/lib/media/urls'

export const metadata: Metadata = {
  title: 'Media library — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The admin media library. BUILD_SPEC §13.2.
 *
 * Owner and operator both. §13.2 names them both and nothing in here belongs
 * to an investor.
 *
 * The screen says what happens to a file before it says how to add one. An
 * operator uploading a headshot from a phone is entitled to know, before he
 * presses anything, that the location it was taken at is about to be removed.
 */
export default async function MediaLibraryPage() {
  await requireOnboardedAdmin()

  const store = mediaStore()
  const assets = store ? await listMedia() : []

  return (
    <>
      <SectionHeading eyebrow="Owner and operator" title="Media library">
        Logos, an email header, David&rsquo;s headshot, product screenshots. Everything here
        is served from this application&rsquo;s own domain &mdash; nothing is ever hot-linked
        from somewhere else.
      </SectionHeading>

      <div className="space-y-4">
        {!store ? (
          <Card title="There is nowhere to store a file yet" tone="warn">
            <p className="text-sm leading-relaxed text-silver2">{MEDIA_STORE_UNCONFIGURED}</p>
            <div className="mt-4">
              <Notice tone="warn">
                Everything else in the portal is complete without this. An empty library is a
                supported state, not a broken one &mdash; the portal, the invitation and the
                participation certificate all work with nothing uploaded.
              </Notice>
            </div>
          </Card>
        ) : (
          <>
            <Card
              title="What happens to a file when you upload it"
              description="Before you choose one."
            >
              <ul className="space-y-2 text-sm leading-relaxed text-silver2">
                <li>
                  <strong className="text-white">Embedded metadata is removed.</strong> EXIF,
                  XMP, IPTC, the colour profile and any comment. A photograph taken on a phone
                  carries the coordinates it was taken at; that is stripped before anything is
                  written to disk, so the original never exists here at all.
                </li>
                <li>
                  <strong className="text-white">The format is read from the file itself</strong>{' '}
                  &mdash; not from its name. {IMAGE_FORMATS.join(', ')} are accepted. SVG is
                  refused outright because it can carry script, and GIF because its comment
                  blocks cannot be reliably removed here.
                </li>
                <li>
                  <strong className="text-white">
                    Up to {MAX_IMAGE_BYTES / (1024 * 1024)} MB.
                  </strong>{' '}
                  Anything larger is refused before it is read.
                </li>
                <li>
                  <strong className="text-white">Every upload is recorded</strong> in the audit
                  log, with the name and the size and never the file.
                </li>
              </ul>
              <p className="mt-4 text-xs text-dim">{store.describe()}</p>
            </Card>

            <Card title="Add an image">
              <ActionForm action={uploadMediaAction} submitLabel="Upload it">
                <Field
                  label="Name"
                  name="name"
                  hint="What you will look for in this list later. “FLIPIT logo, orange on dark”, not “logo2-final”."
                >
                  <TextInput name="name" maxLength={80} required placeholder="FLIPIT logo" />
                </Field>
                <Field label="Description" name="description" hint="Optional. Where it is meant to be used.">
                  <TextArea
                    name="description"
                    maxLength={400}
                    placeholder="For the email header. 600px wide, transparent background."
                  />
                </Field>
                <Field label="File" name="file">
                  <input
                    type="file"
                    name="file"
                    id="file"
                    required
                    accept={IMAGE_FORMATS.join(',')}
                    className="w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext file:mr-3 file:rounded-sm file:border-0 file:bg-orange file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
                  />
                </Field>
              </ActionForm>
            </Card>

            {assets.length === 0 ? (
              <Card title="Nothing uploaded yet">
                <p className="text-sm leading-relaxed text-silver2">
                  The portal ships with sensible defaults and looks finished without a single
                  file in here. Add one when you have one worth adding.
                </p>
              </Card>
            ) : null}

            {assets.map((asset) => (
              <Card key={asset.id} title={asset.name}>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">{asset.contentType.replace('image/', '')}</Pill>
                  <Pill tone="neutral">{Math.max(1, Math.round(asset.sizeBytes / 1024))} KB</Pill>
                  {asset.width && asset.height ? (
                    <Pill tone="neutral">
                      {asset.width} &times; {asset.height}
                    </Pill>
                  ) : null}
                </div>

                <div className="mb-4 overflow-hidden rounded-sm border hairline bg-bg2 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(asset.storageKey)}
                    alt={asset.description ?? asset.name}
                    className="max-h-48 w-auto max-w-full"
                  />
                </div>

                <p className="mb-4 break-all text-xs text-dim">
                  Address on this deployment:{' '}
                  <code className="text-silver2">{mediaUrl(asset.storageKey)}</code>
                </p>

                <ActionForm
                  action={updateMediaDetailsAction}
                  submitLabel="Save"
                  hidden={{ assetId: asset.id }}
                >
                  <Field label="Name" name={`name-${asset.id}`}>
                    <TextInput
                      name="name"
                      id={`name-${asset.id}`}
                      defaultValue={asset.name}
                      maxLength={80}
                      required
                    />
                  </Field>
                  <Field label="Description" name={`description-${asset.id}`}>
                    <TextArea
                      name="description"
                      id={`description-${asset.id}`}
                      defaultValue={asset.description ?? ''}
                      maxLength={400}
                    />
                  </Field>
                </ActionForm>

                <div className="mt-6 border-t hairline pt-4">
                  <p className="mb-3 text-xs leading-relaxed text-dim">
                    Removing deletes the stored file as well. Anywhere this address already
                    appears &mdash; including an email that has already been sent &mdash; will
                    stop showing the image.
                  </p>
                  <ActionForm
                    action={removeMediaAction}
                    submitLabel="Remove"
                    tone="danger"
                    hidden={{ assetId: asset.id }}
                  />
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </>
  )
}
