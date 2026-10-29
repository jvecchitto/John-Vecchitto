// Classifies a parcel from its CT state use description and assessed values.
// Statewide data cannot tell us whether a lot has subdivision or site-plan
// approval; that has to be checked with the town. What we can infer is the
// assessor's category, which is a decent first sort.

const RULES = [
  { type: 'Undevelopable', test: /UNDEV|UNBUILD|NON[- ]?BUILD|EXCESS|WASTE|WETLAND|ROW\b|RIGHT OF WAY/ },
  { type: 'Farm / Forest / Open Space (PA 490)', test: /PA ?490|FOREST|FARM|AGRIC|OPEN SPACE|TILLABLE|PASTURE|ORCHARD|WOOD/ },
  { type: 'Commercial vacant', test: /COM.*(VAC|LAND)|(VAC|LAND).*COM/ },
  { type: 'Industrial vacant', test: /IND.*(VAC|LAND)|(VAC|LAND).*IND/ },
  { type: 'Residential buildable lot', test: /BUILDABLE|DEVELOPABLE|RES.*(VAC|LAND|LOT)|(VAC|LAND).*RES|HOUSE ?LOT/ },
  { type: 'Vacant land', test: /VAC|LAND|ACRE|LOT/ },
];

export function classifyLand({ stateUseDesc, assessedBuilding }) {
  const desc = String(stateUseDesc || '').toUpperCase();
  const building = Number(assessedBuilding) || 0;
  for (const rule of RULES) {
    if (!rule.test.test(desc)) continue;
    // A generic "LAND"/"LOT" match on a parcel with a real building is
    // something like a parking lot or a house on acreage, not vacant land.
    if (rule.type === 'Vacant land' && !/VAC/.test(desc) && building > 50000) return null;
    return rule.type;
  }
  if (assessedBuilding !== undefined && assessedBuilding !== null && building === 0) return 'Vacant land';
  return null; // not land
}

export function isLand(parcel) {
  return classifyLand(parcel) !== null;
}

// Approval status the user can record after checking with town Planning & Zoning.
export const ENTITLEMENT_OPTIONS = [
  'Unknown',
  'Raw land',
  'Approved building lot',
  'Approved subdivision',
  'Permits issued',
  'Not buildable',
];
