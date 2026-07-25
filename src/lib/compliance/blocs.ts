/**
 * Blocs, expanded to member country codes.
 *
 * BUILD_SPEC §8.2: "Jurisdictions cleared — an explicit list of ISO 3166-1
 * alpha-2 country codes. **Blocs are expanded to their member codes when the
 * approval is recorded**, so the stored list is always comparable to a
 * recipient's field value."
 *
 * The expansion happens once, at the moment of recording, and what is stored
 * is the resulting list of countries. Nothing at send time ever has to know
 * what "EU" means, and nobody later has to guess whether an approval written
 * in 2026 meant the EU of 2026 or the EU of the day it was read.
 *
 * Only memberships with an exact, checkable definition are here. "Europe",
 * "the Nordics", "worldwide" and "offshore" are not blocs — they are
 * shorthand, and a compliance approval is the last place in the application
 * where shorthand should be interpreted. Those are refused, with the message
 * saying to name the countries.
 */

/** The 27 member states of the European Union. */
const EU: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]

/** European Free Trade Association. */
const EFTA: readonly string[] = ['CH', 'IS', 'LI', 'NO']

/** European Economic Area — the EU plus Iceland, Liechtenstein and Norway. */
const EEA: readonly string[] = [...EU, 'IS', 'LI', 'NO']

export interface BlocDefinition {
  /** The token as it will be recognised, upper case. */
  token: string
  label: string
  members: readonly string[]
}

const DEFINITIONS: readonly BlocDefinition[] = [
  { token: 'EU', label: 'European Union', members: EU },
  { token: 'EEA', label: 'European Economic Area', members: EEA },
  { token: 'EFTA', label: 'European Free Trade Association', members: EFTA },
]

const BY_TOKEN = new Map<string, BlocDefinition>()
for (const definition of DEFINITIONS) {
  BY_TOKEN.set(definition.token, definition)
}
// A few spellings that mean exactly the same membership.
BY_TOKEN.set('EUROPEAN UNION', BY_TOKEN.get('EU')!)
BY_TOKEN.set('EUROPEAN ECONOMIC AREA', BY_TOKEN.get('EEA')!)

export const BLOCS: readonly BlocDefinition[] = DEFINITIONS

export function lookupBloc(token: string): BlocDefinition | null {
  return BY_TOKEN.get(token.trim().toUpperCase().replace(/\s+/g, ' ')) ?? null
}
