// Address normalization so MLS listing addresses can be matched to assessor
// "Location" values, which are written inconsistently across CT towns.

const SUFFIXES = {
  ROAD: 'RD', STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', LANE: 'LN', DRIVE: 'DR',
  COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', TERRACE: 'TER', HIGHWAY: 'HWY',
  TURNPIKE: 'TPKE', TPK: 'TPKE', PIKE: 'PK', BOULEVARD: 'BLVD', PARKWAY: 'PKWY',
  EXTENSION: 'EXT', TRAIL: 'TRL', HILL: 'HL', MOUNTAIN: 'MTN', ROUTE: 'RT',
  RTE: 'RT', WAY: 'WAY', POINT: 'PT', SQUARE: 'SQ', CROSSING: 'XING',
};

const DIRECTIONS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };

// Prefixes that mean "no real street number" on a land parcel.
const NON_NUMBER_PREFIXES = new Set(['LOT', 'REAR', 'OFF', 'PARCEL', 'MAP', 'TBD', 'XX', 'VL']);

export function normalizeStreet(raw) {
  if (!raw) return '';
  let s = String(raw).toUpperCase();
  s = s.replace(/[.,#]/g, ' ');
  // Drop unit designators and anything after them.
  s = s.replace(/\b(UNIT|APT|STE|SUITE)\b.*$/, '');
  const words = s.split(/\s+/).filter(Boolean).map((w) => SUFFIXES[w] || DIRECTIONS[w] || w);
  return words.join(' ');
}

// Splits a normalized address into { number, street }. Land parcels often
// have no number, a 0, or a prefix like "LOT 3" or "REAR".
export function splitAddress(raw) {
  const words = normalizeStreet(raw).split(' ').filter(Boolean);
  let number = '';
  while (words.length) {
    const w = words[0];
    if (NON_NUMBER_PREFIXES.has(w)) {
      words.shift();
      // "LOT 3 MAIN ST" -> the 3 is a lot identifier, not a street number
      const takesId = w === 'LOT' || w === 'PARCEL' || w === 'MAP';
      if (takesId && words.length > 2 && /^[0-9A-Z-]{1,5}$/.test(words[0]) && /\d/.test(words[0])) words.shift();
      continue;
    }
    if (/^\d+[A-Z]?(-\d+[A-Z]?)?$/.test(w)) {
      number = words.shift().replace(/-.*$/, '');
      if (/^0+$/.test(number)) number = '';
    }
    break;
  }
  return { number, street: words.join(' ') };
}

export function normalizeTown(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
}
