/**
 * ISO 3166-1 alpha-2 country codes.
 *
 * BUILD_SPEC §9 makes a jurisdiction that is not a valid alpha-2 code a
 * FILE-LEVEL error, and §8.2 compares a recipient's code against the
 * compliance-approved list. Those two rules only work if "valid code" means
 * exactly one thing, so the list below is the whole of ISO 3166-1 alpha-2 as
 * currently assigned — 249 codes — and nothing else.
 *
 * Deliberately excluded: withdrawn codes (AN, CS, SU, YU, ZR and the rest),
 * CLDR's non-country regions (EU, QO, ZZ), and exceptional reservations that
 * are not ISO 3166-1 country codes (UK, XK). `UK` is a common way to write it,
 * so it resolves through the alias table to `GB` — but only as an alias, never
 * as a code in its own right.
 *
 * The name table exists to turn "United Kingdom" or "England" into `GB` when a
 * spreadsheet has country names rather than codes. Every such resolution is
 * shown to the operator in the review table before anything is imported
 * (BUILD_SPEC §9.1 — "the first few converted values as they would be stored").
 * Nothing is resolved silently and nothing is guessed: an unrecognised value is
 * a file-level error, not a best effort.
 */

export const ISO_3166_1_ALPHA_2: ReadonlyArray<readonly [string, string]> = [
  ['AD', `Andorra`],
  ['AE', `United Arab Emirates`],
  ['AF', `Afghanistan`],
  ['AG', `Antigua & Barbuda`],
  ['AI', `Anguilla`],
  ['AL', `Albania`],
  ['AM', `Armenia`],
  ['AO', `Angola`],
  ['AQ', `Antarctica`],
  ['AR', `Argentina`],
  ['AS', `American Samoa`],
  ['AT', `Austria`],
  ['AU', `Australia`],
  ['AW', `Aruba`],
  ['AX', `Åland Islands`],
  ['AZ', `Azerbaijan`],
  ['BA', `Bosnia & Herzegovina`],
  ['BB', `Barbados`],
  ['BD', `Bangladesh`],
  ['BE', `Belgium`],
  ['BF', `Burkina Faso`],
  ['BG', `Bulgaria`],
  ['BH', `Bahrain`],
  ['BI', `Burundi`],
  ['BJ', `Benin`],
  ['BL', `St. Barthélemy`],
  ['BM', `Bermuda`],
  ['BN', `Brunei`],
  ['BO', `Bolivia`],
  ['BQ', `Caribbean Netherlands`],
  ['BR', `Brazil`],
  ['BS', `Bahamas`],
  ['BT', `Bhutan`],
  ['BV', `Bouvet Island`],
  ['BW', `Botswana`],
  ['BY', `Belarus`],
  ['BZ', `Belize`],
  ['CA', `Canada`],
  ['CC', `Cocos (Keeling) Islands`],
  ['CD', `Congo - Kinshasa`],
  ['CF', `Central African Republic`],
  ['CG', `Congo - Brazzaville`],
  ['CH', `Switzerland`],
  ['CI', `Côte d’Ivoire`],
  ['CK', `Cook Islands`],
  ['CL', `Chile`],
  ['CM', `Cameroon`],
  ['CN', `China`],
  ['CO', `Colombia`],
  ['CR', `Costa Rica`],
  ['CU', `Cuba`],
  ['CV', `Cape Verde`],
  ['CW', `Curaçao`],
  ['CX', `Christmas Island`],
  ['CY', `Cyprus`],
  ['CZ', `Czechia`],
  ['DE', `Germany`],
  ['DJ', `Djibouti`],
  ['DK', `Denmark`],
  ['DM', `Dominica`],
  ['DO', `Dominican Republic`],
  ['DZ', `Algeria`],
  ['EC', `Ecuador`],
  ['EE', `Estonia`],
  ['EG', `Egypt`],
  ['EH', `Western Sahara`],
  ['ER', `Eritrea`],
  ['ES', `Spain`],
  ['ET', `Ethiopia`],
  ['FI', `Finland`],
  ['FJ', `Fiji`],
  ['FK', `Falkland Islands`],
  ['FM', `Micronesia`],
  ['FO', `Faroe Islands`],
  ['FR', `France`],
  ['GA', `Gabon`],
  ['GB', `United Kingdom`],
  ['GD', `Grenada`],
  ['GE', `Georgia`],
  ['GF', `French Guiana`],
  ['GG', `Guernsey`],
  ['GH', `Ghana`],
  ['GI', `Gibraltar`],
  ['GL', `Greenland`],
  ['GM', `Gambia`],
  ['GN', `Guinea`],
  ['GP', `Guadeloupe`],
  ['GQ', `Equatorial Guinea`],
  ['GR', `Greece`],
  ['GS', `South Georgia & South Sandwich Islands`],
  ['GT', `Guatemala`],
  ['GU', `Guam`],
  ['GW', `Guinea-Bissau`],
  ['GY', `Guyana`],
  ['HK', `Hong Kong SAR China`],
  ['HM', `Heard & McDonald Islands`],
  ['HN', `Honduras`],
  ['HR', `Croatia`],
  ['HT', `Haiti`],
  ['HU', `Hungary`],
  ['ID', `Indonesia`],
  ['IE', `Ireland`],
  ['IL', `Israel`],
  ['IM', `Isle of Man`],
  ['IN', `India`],
  ['IO', `British Indian Ocean Territory`],
  ['IQ', `Iraq`],
  ['IR', `Iran`],
  ['IS', `Iceland`],
  ['IT', `Italy`],
  ['JE', `Jersey`],
  ['JM', `Jamaica`],
  ['JO', `Jordan`],
  ['JP', `Japan`],
  ['KE', `Kenya`],
  ['KG', `Kyrgyzstan`],
  ['KH', `Cambodia`],
  ['KI', `Kiribati`],
  ['KM', `Comoros`],
  ['KN', `St. Kitts & Nevis`],
  ['KP', `North Korea`],
  ['KR', `South Korea`],
  ['KW', `Kuwait`],
  ['KY', `Cayman Islands`],
  ['KZ', `Kazakhstan`],
  ['LA', `Laos`],
  ['LB', `Lebanon`],
  ['LC', `St. Lucia`],
  ['LI', `Liechtenstein`],
  ['LK', `Sri Lanka`],
  ['LR', `Liberia`],
  ['LS', `Lesotho`],
  ['LT', `Lithuania`],
  ['LU', `Luxembourg`],
  ['LV', `Latvia`],
  ['LY', `Libya`],
  ['MA', `Morocco`],
  ['MC', `Monaco`],
  ['MD', `Moldova`],
  ['ME', `Montenegro`],
  ['MF', `St. Martin`],
  ['MG', `Madagascar`],
  ['MH', `Marshall Islands`],
  ['MK', `North Macedonia`],
  ['ML', `Mali`],
  ['MM', `Myanmar (Burma)`],
  ['MN', `Mongolia`],
  ['MO', `Macao SAR China`],
  ['MP', `Northern Mariana Islands`],
  ['MQ', `Martinique`],
  ['MR', `Mauritania`],
  ['MS', `Montserrat`],
  ['MT', `Malta`],
  ['MU', `Mauritius`],
  ['MV', `Maldives`],
  ['MW', `Malawi`],
  ['MX', `Mexico`],
  ['MY', `Malaysia`],
  ['MZ', `Mozambique`],
  ['NA', `Namibia`],
  ['NC', `New Caledonia`],
  ['NE', `Niger`],
  ['NF', `Norfolk Island`],
  ['NG', `Nigeria`],
  ['NI', `Nicaragua`],
  ['NL', `Netherlands`],
  ['NO', `Norway`],
  ['NP', `Nepal`],
  ['NR', `Nauru`],
  ['NU', `Niue`],
  ['NZ', `New Zealand`],
  ['OM', `Oman`],
  ['PA', `Panama`],
  ['PE', `Peru`],
  ['PF', `French Polynesia`],
  ['PG', `Papua New Guinea`],
  ['PH', `Philippines`],
  ['PK', `Pakistan`],
  ['PL', `Poland`],
  ['PM', `St. Pierre & Miquelon`],
  ['PN', `Pitcairn Islands`],
  ['PR', `Puerto Rico`],
  ['PS', `Palestinian Territories`],
  ['PT', `Portugal`],
  ['PW', `Palau`],
  ['PY', `Paraguay`],
  ['QA', `Qatar`],
  ['RE', `Réunion`],
  ['RO', `Romania`],
  ['RS', `Serbia`],
  ['RU', `Russia`],
  ['RW', `Rwanda`],
  ['SA', `Saudi Arabia`],
  ['SB', `Solomon Islands`],
  ['SC', `Seychelles`],
  ['SD', `Sudan`],
  ['SE', `Sweden`],
  ['SG', `Singapore`],
  ['SH', `St. Helena`],
  ['SI', `Slovenia`],
  ['SJ', `Svalbard & Jan Mayen`],
  ['SK', `Slovakia`],
  ['SL', `Sierra Leone`],
  ['SM', `San Marino`],
  ['SN', `Senegal`],
  ['SO', `Somalia`],
  ['SR', `Suriname`],
  ['SS', `South Sudan`],
  ['ST', `São Tomé & Príncipe`],
  ['SV', `El Salvador`],
  ['SX', `Sint Maarten`],
  ['SY', `Syria`],
  ['SZ', `Eswatini`],
  ['TC', `Turks & Caicos Islands`],
  ['TD', `Chad`],
  ['TF', `French Southern Territories`],
  ['TG', `Togo`],
  ['TH', `Thailand`],
  ['TJ', `Tajikistan`],
  ['TK', `Tokelau`],
  ['TL', `Timor-Leste`],
  ['TM', `Turkmenistan`],
  ['TN', `Tunisia`],
  ['TO', `Tonga`],
  ['TR', `Türkiye`],
  ['TT', `Trinidad & Tobago`],
  ['TV', `Tuvalu`],
  ['TW', `Taiwan`],
  ['TZ', `Tanzania`],
  ['UA', `Ukraine`],
  ['UG', `Uganda`],
  ['UM', `U.S. Outlying Islands`],
  ['US', `United States`],
  ['UY', `Uruguay`],
  ['UZ', `Uzbekistan`],
  ['VA', `Vatican City`],
  ['VC', `St. Vincent & Grenadines`],
  ['VE', `Venezuela`],
  ['VG', `British Virgin Islands`],
  ['VI', `U.S. Virgin Islands`],
  ['VN', `Vietnam`],
  ['VU', `Vanuatu`],
  ['WF', `Wallis & Futuna`],
  ['WS', `Samoa`],
  ['YE', `Yemen`],
  ['YT', `Mayotte`],
  ['ZA', `South Africa`],
  ['ZM', `Zambia`],
  ['ZW', `Zimbabwe`],
]

const CODE_TO_NAME = new Map<string, string>(ISO_3166_1_ALPHA_2)

/** Lowercase, unaccented, single-spaced, no leading "the". */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/[^a-z0-9&\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/, '')
}

const NAME_TO_CODE = new Map<string, string>()
for (const [code, name] of ISO_3166_1_ALPHA_2) {
  NAME_TO_CODE.set(normalise(name), code)
  // CLDR writes "Antigua & Barbuda"; spreadsheets write "and".
  const withAnd = normalise(name.replace(/&/g, 'and'))
  NAME_TO_CODE.set(withAnd, code)
}

/**
 * Everyday names that are not the ISO short name. Constituent countries of the
 * United Kingdom are here because the recipient list uses "England".
 */
const ALIASES: Readonly<Record<string, string>> = {
  uk: 'GB',
  'u k': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  usa: 'US',
  'u s': 'US',
  'u s a': 'US',
  'united states of america': 'US',
  america: 'US',
  'republic of ireland': 'IE',
  eire: 'IE',
  holland: 'NL',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  vietnam: 'VN',
  uae: 'AE',
  'ivory coast': 'CI',
  'czech republic': 'CZ',
  burma: 'MM',
  swaziland: 'SZ',
  macedonia: 'MK',
  'cape verde': 'CV',
  'east timor': 'TL',
  turkey: 'TR',
  'bvi': 'VG',
  'british virgin islands': 'VG',
  'hong kong sar': 'HK',
  'mainland china': 'CN',
  'prc': 'CN',
  'new zealand aotearoa': 'NZ',
}

/**
 * Values that name a bloc or a region rather than a country. Recorded
 * separately so the operator gets a useful message instead of "unknown".
 * BUILD_SPEC §8.2 expands blocs at approval time; an import must not.
 */
const BLOC_OR_REGION = new Set([
  'eu',
  'european union',
  'eea',
  'european economic area',
  'eurozone',
  'euro zone',
  'europe',
  'emea',
  'apac',
  'asia',
  'asia pacific',
  'asean',
  'gcc',
  'nato',
  'africa',
  'north america',
  'south america',
  'latin america',
  'central america',
  'middle east',
  'caribbean',
  'scandinavia',
  'nordics',
  'benelux',
  'oceania',
  'commonwealth',
  'worldwide',
  'global',
  'international',
  'offshore',
])

export function isIsoAlpha2(code: string): boolean {
  return CODE_TO_NAME.has(code.trim().toUpperCase())
}

export function countryName(code: string): string | null {
  return CODE_TO_NAME.get(code.trim().toUpperCase()) ?? null
}

export type JurisdictionResolution =
  | {
      ok: true
      code: string
      name: string
      /** How it was read. `NAME` and `ALIAS` are surfaced to the operator. */
      from: 'CODE' | 'NAME' | 'ALIAS'
      raw: string
    }
  | {
      ok: false
      reason: 'EMPTY' | 'BLOC_OR_REGION' | 'UNKNOWN'
      message: string
      raw: string
    }

/** Resolve a spreadsheet cell to an ISO 3166-1 alpha-2 code, or explain why not. */
export function resolveJurisdiction(raw: string): JurisdictionResolution {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') {
    return {
      ok: false,
      reason: 'EMPTY',
      message: 'Jurisdiction is required — the compliance gate depends on it.',
      raw,
    }
  }

  const upper = trimmed.toUpperCase()
  if (upper.length === 2 && CODE_TO_NAME.has(upper)) {
    return { ok: true, code: upper, name: CODE_TO_NAME.get(upper)!, from: 'CODE', raw }
  }

  const key = normalise(trimmed)

  if (BLOC_OR_REGION.has(key)) {
    return {
      ok: false,
      reason: 'BLOC_OR_REGION',
      message:
        `"${trimmed}" names a bloc or a region, not a country. The compliance approval ` +
        'is recorded against individual country codes, so each recipient needs their own.',
      raw,
    }
  }

  const byName = NAME_TO_CODE.get(key)
  if (byName) {
    return { ok: true, code: byName, name: CODE_TO_NAME.get(byName)!, from: 'NAME', raw }
  }

  const byAlias = ALIASES[key]
  if (byAlias) {
    return { ok: true, code: byAlias, name: CODE_TO_NAME.get(byAlias)!, from: 'ALIAS', raw }
  }

  return {
    ok: false,
    reason: 'UNKNOWN',
    message:
      `"${trimmed}" is not an ISO 3166-1 alpha-2 country code and is not a country name ` +
      'the importer recognises. Use the two-letter code, for example GB, AU, FR or TH.',
    raw,
  }
}
