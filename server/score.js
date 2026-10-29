// Seller-likelihood score, 0-100, with the reasons that produced it so the
// number is never a black box. Weights are a starting point; tune them as you
// learn which leads actually convert.

import { normalizeStreet, normalizeTown } from './address.js';

const EXPIRED = /EXPIRED|WITHDRAWN|CANCEL|TEMP.*OFF|OFF ?MARKET/i;
const ACTIVE = /ACTIVE|COMING SOON|UNDER CONTRACT|PENDING|SHOW/i;
const SUPPRESSED_OWNER = /^CURRENT (CO-?)?OWNER$/i;

export function listingKind(status) {
  if (!status) return null;
  if (EXPIRED.test(status)) return 'expired';
  if (ACTIVE.test(status)) return 'active';
  if (/SOLD|CLOSED/i.test(status)) return 'sold';
  return null;
}

function yearsSince(isoDate, now) {
  if (!isoDate) return null;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return null;
  return (now - t) / (365.25 * 24 * 3600 * 1000);
}

// Vacant land has no house, so the owner always mails somewhere else. What
// matters is whether they live in a different town from the parcel.
export function isAbsentee(p) {
  if (SUPPRESSED_OWNER.test(p.owner || '')) return false; // town replaced mailing address with property address
  if (p.mailCity) {
    const sameTown = normalizeTown(p.mailCity) === normalizeTown(p.town);
    const sameZip = p.mailZip && p.propZip && String(p.mailZip).slice(0, 5) === String(p.propZip).slice(0, 5);
    return !sameTown && !sameZip;
  }
  return Boolean(p.mailAddress) && normalizeStreet(p.mailAddress) !== normalizeStreet(p.location);
}

export function isOutOfState(p) {
  const st = String(p.mailState || '').trim().toUpperCase();
  return Boolean(st) && st !== 'CT' && st !== 'CONNECTICUT';
}

export function scoreLead(p, listing, now = Date.now()) {
  let score = 10;
  const reasons = [];
  const add = (pts, why) => { score += pts; reasons.push({ pts, why }); };

  const kind = listing ? listingKind(listing.status) : null;
  if (kind === 'expired') {
    add(30, `Listing ${String(listing.status).toLowerCase()} — owner already tried to sell`);
    const offYears = yearsSince(listing.offMarketDate, now);
    if (offYears !== null && offYears <= 0.25) add(5, 'Came off the market in the last 90 days');
    if (listing.originalPrice && listing.listPrice && listing.listPrice < listing.originalPrice) {
      add(5, 'Price was reduced before it came off the market');
    }
    if (listing.dom >= 180) add(5, `${listing.dom} days on market`);
  } else if (kind === 'active') {
    reasons.push({ pts: 0, why: 'Currently listed with an agent — do not solicit the owner' });
  } else if (kind === 'sold') {
    add(-20, 'Recently sold per MLS');
  }

  if (isOutOfState(p)) add(20, `Owner mails to ${p.mailState} — out-of-state owner`);
  else if (isAbsentee(p)) add(12, `Absentee owner — lives in ${p.mailCity || 'another town'}`);

  const owner = `${p.owner || ''} ${p.coOwner || ''}`.toUpperCase();
  if (/\bESTATE\b|\bEST OF\b|\bHEIRS?\b|\bEXECUT|\bADMINISTRAT|\bDECEASED\b/.test(owner)) {
    add(15, 'Owned by an estate or heirs');
  } else if (/\bTRUST\b|\bTRUSTEE\b|\bTR\b|\bTRS\b/.test(owner)) {
    add(5, 'Held in a trust (often estate planning)');
  }

  const held = yearsSince(p.saleDate, now);
  if (held !== null) {
    if (held >= 25) add(12, `Owned for ${Math.floor(held)} years`);
    else if (held >= 15) add(8, `Owned for ${Math.floor(held)} years`);
    else if (held < 2) add(-10, 'Bought within the last 2 years');
  }
  if (p.saleDate && Number(p.salePrice) === 0) add(5, 'Last transfer was for $0 (gift, inheritance or quitclaim)');

  if (p.acres >= 5) add(6, `${p.acres.toFixed(1)} acres — possible subdivision interest`);
  else if (p.acres >= 2) add(3, `${p.acres.toFixed(1)} acres`);

  if (/PA ?490|Farm/.test(p.landType || '') || /PA ?490/i.test(p.stateUseDesc || '')) {
    add(-5, 'PA 490 use assessment — conveyance tax on sale within 10 years can discourage selling');
  }
  if (p.landType === 'Undevelopable') add(-8, 'Assessor lists it as undevelopable');

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons, listingKind: kind };
}
