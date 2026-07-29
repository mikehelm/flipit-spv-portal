import type { Metadata } from 'next'
import { asc } from 'drizzle-orm'
import {
  addRoadmapTileAction,
  removeRoadmapTileAction,
  updateRoadmapTileAction,
} from '@/actions/roadmap'
import { ActionForm } from '@/components/admin/action-form'
import {
  Card,
  Checkbox,
  Field,
  Notice,
  Pill,
  SectionHeading,
  TextInput,
} from '@/components/admin/ui'
import { db } from '@/db'
import { roadmapTiles } from '@/db/schema'
import { requireOwner } from '@/lib/auth/guards'
import { FORBIDDEN_IN_TILE_LABEL, ROADMAP_DISCLAIMER } from '@/lib/portal/roadmap'

export const metadata: Metadata = {
  title: 'Coming to your portal — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The "Coming to your portal" tiles. BUILD_SPEC §13.1, §22 AC30.
 *
 * Owner only, because §13.1 says "configurable by the owner" and these words
 * appear on the page an investor reads beside their own figures.
 *
 * The standing line is shown here, greyed and uneditable, so that whoever is
 * writing a tile can see the sentence it will sit above — and can see that it
 * is not one of the things they can change.
 */
export default async function RoadmapPage() {
  await requireOwner()

  const tiles = await db.select().from(roadmapTiles).orderBy(asc(roadmapTiles.sortOrder))
  const visible = tiles.filter((tile) => !tile.hidden)

  return (
    <>
      <SectionHeading eyebrow="Owner only" title="Coming to your portal">
        The small set of named tiles at the bottom of an investor&rsquo;s portal. Names
        only. Keep them short and factual so they feel like a real system being built,
        not a list of promises.
      </SectionHeading>

      <div className="space-y-4">
        <Card title="What sits beneath them, always">
          <p className="text-sm leading-relaxed text-silver2">{ROADMAP_DISCLAIMER}</p>
          <div className="mt-4">
            <Notice>
              This line is fixed. There is no setting that removes it, and renaming or
              hiding every tile does not remove it either. It is part of the investor
              protection built into this page.
            </Notice>
          </div>
        </Card>

        <Card
          title="What an investor sees now"
          description={
            visible.length === 0
              ? 'Nothing. With no visible tiles the section does not appear at all.'
              : `${visible.length} ${visible.length === 1 ? 'tile' : 'tiles'}, in this order.`
          }
        >
          {visible.length > 0 ? (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visible.map((tile) => (
                <li
                  key={tile.id}
                  className="rounded-sm border hairline bg-bg2 px-4 py-3 text-sm text-silver2"
                >
                  {tile.label}
                  {tile.isLive ? (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-ok">
                      Available
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        {/* ------------------------------------------------------------- */}
        <Card
          title="Add a tile"
          description="A name, and nothing else. It goes on as in development; switch it to live once the feature ships."
        >
          <ActionForm action={addRoadmapTileAction} submitLabel="Add it">
            <Field
              label="Name"
              name="label"
              hint={`Up to 40 characters. Refused outright: anything reading as a promise of returns, a valuation, liquidity or a date — ${FORBIDDEN_IN_TILE_LABEL.slice(0, 6).join(', ')} and the like, plus any year.`}
            >
              <TextInput name="label" maxLength={40} required placeholder="Reporting" />
            </Field>
          </ActionForm>
        </Card>

        {/* ------------------------------------------------------------- */}
        {tiles.map((tile) => (
          <Card key={tile.id} title={tile.label}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {tile.hidden ? <Pill tone="neutral">Hidden</Pill> : <Pill tone="accent">On the portal</Pill>}
              {tile.isLive ? <Pill tone="ok">Live</Pill> : <Pill tone="neutral">In development</Pill>}
            </div>

            <ActionForm
              action={updateRoadmapTileAction}
              submitLabel="Save this tile"
              hidden={{ tileId: tile.id }}
            >
              <Field label="Name" name={`label-${tile.id}`}>
                <TextInput
                  name="label"
                  id={`label-${tile.id}`}
                  defaultValue={tile.label}
                  maxLength={40}
                  required
                />
              </Field>

              <div className="space-y-3">
                <Checkbox
                  name="isLive"
                  id={`isLive-${tile.id}`}
                  defaultChecked={tile.isLive}
                  label="This one has shipped — show it as available rather than in development"
                />
                <Checkbox
                  name="hidden"
                  id={`hidden-${tile.id}`}
                  defaultChecked={tile.hidden}
                  label="Hide it from every investor"
                />
              </div>
            </ActionForm>

            <div className="mt-6 border-t hairline pt-4">
              <p className="mb-3 text-xs leading-relaxed text-dim">
                Hiding keeps the tile and is reversible. Removing it does not.
              </p>
              <ActionForm
                action={removeRoadmapTileAction}
                submitLabel="Remove this tile"
                tone="danger"
                hidden={{ tileId: tile.id }}
              />
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
