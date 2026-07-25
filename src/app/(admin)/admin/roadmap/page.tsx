import {
  createTileAction,
  moveTileAction,
  renameTileAction,
  setTileHiddenAction,
  setTileLiveAction,
} from '@/actions/roadmap'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, Pill, SectionHeading, TextInput } from '@/components/admin/ui'
import { requireOwner } from '@/lib/auth/guards'
import { ROADMAP_DISCLAIMER } from '@/lib/portal/roadmap'
import { MAX_TILE_LABEL_LENGTH, loadTiles } from '@/lib/portal/roadmap-tiles'

/**
 * "Coming to your portal" — the owner's editing surface. BUILD_SPEC §13.1,
 * §22 AC30: *"tiles can be added, renamed, hidden, or switched from 'in
 * development' to live as features ship."*
 *
 * Owner-only, and every action re-checks that on the server. The nav hides the
 * link from the operator; `requireOwner()` is what actually refuses them.
 *
 * There is no delete. Hiding keeps the row, and the log keeps its answer to
 * what an investor was shown on a given day.
 */

export const metadata = { title: 'Portal roadmap' }

export default async function RoadmapPage() {
  await requireOwner()
  const tiles = await loadTiles()

  return (
    <>
      <SectionHeading eyebrow="Owner only" title="Portal roadmap">
        The small set of tiles beneath an investor’s record, under “Coming to your portal”.
        Names only — §13.1 asks for short labels and no explanation, because this sits on a
        securities offer page and is the easiest place in the build to say something
        unintended.
      </SectionHeading>

      <div className="space-y-4">
        <Notice tone="warn">
          A label is refused if it reads as a promise of return, valuation, liquidity or a
          timeline — and dates, years and “soon” are refused outright. Name the tool, not what
          it will do for them.
        </Notice>

        <Notice>
          This line always sits beneath the tiles and cannot be switched off:{' '}
          <em className="text-ftext">{ROADMAP_DISCLAIMER}</em>
        </Notice>

        <Card
          title="Add a tile"
          description="It starts in development. Mark it available when the feature actually ships."
        >
          <ActionForm action={createTileAction} submitLabel="Add tile">
            <Field
              label="Label"
              name="label"
              hint={`Up to ${MAX_TILE_LABEL_LENGTH} characters. For example: Holdings & documents`}
            >
              <TextInput name="label" maxLength={MAX_TILE_LABEL_LENGTH} required />
            </Field>
          </ActionForm>
        </Card>

        {tiles.length === 0 ? (
          <Card title="No tiles">
            <p className="text-sm text-dim">
              The section does not appear on any portal while there are none.
            </p>
          </Card>
        ) : null}

        {tiles.map((tile, index) => (
          <Card key={tile.id} title={tile.label} tone={tile.hidden ? 'warn' : 'default'}>
            <div className="flex flex-wrap gap-2">
              <Pill tone={tile.isLive ? 'ok' : 'neutral'}>
                {tile.isLive ? 'Available' : 'In development'}
              </Pill>
              <Pill tone={tile.hidden ? 'warn' : 'neutral'}>
                {tile.hidden ? 'Hidden from investors' : 'Shown on every portal'}
              </Pill>
              <Pill tone="neutral">{`Position ${index + 1} of ${tiles.length}`}</Pill>
            </div>

            <div className="mt-4 space-y-4">
              <ActionForm
                action={renameTileAction}
                submitLabel="Rename"
                tone="quiet"
                hidden={{ tileId: tile.id }}
              >
                <Field label="Label" name="label">
                  <TextInput
                    name="label"
                    defaultValue={tile.label}
                    maxLength={MAX_TILE_LABEL_LENGTH}
                    required
                  />
                </Field>
              </ActionForm>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ActionForm
                  action={setTileLiveAction}
                  submitLabel={tile.isLive ? 'Back to in development' : 'Mark available'}
                  tone="quiet"
                  hidden={{ tileId: tile.id, isLive: tile.isLive ? 'false' : 'true' }}
                />
                <ActionForm
                  action={setTileHiddenAction}
                  submitLabel={tile.hidden ? 'Show on portals' : 'Hide from investors'}
                  tone={tile.hidden ? 'quiet' : 'danger'}
                  hidden={{ tileId: tile.id, hidden: tile.hidden ? 'false' : 'true' }}
                />
                <ActionForm
                  action={moveTileAction}
                  submitLabel="Move up"
                  tone="quiet"
                  hidden={{ tileId: tile.id, direction: 'up' }}
                />
                <ActionForm
                  action={moveTileAction}
                  submitLabel="Move down"
                  tone="quiet"
                  hidden={{ tileId: tile.id, direction: 'down' }}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
