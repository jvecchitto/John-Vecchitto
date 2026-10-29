// FEMA National Flood Hazard Layer lookup for a single point.

export const NFHL_ZONES_URL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28';

export async function floodZoneAt({ lat, lon }, fetchImpl = globalThis.fetch) {
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetchImpl(`${NFHL_ZONES_URL}/query?${params}`);
  if (!res.ok) throw new Error(`FEMA returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`FEMA error: ${body.error.message}`);
  const attrs = body.features?.[0]?.attributes;
  if (!attrs) return { zone: 'Not mapped', inFloodplain: false };
  return {
    zone: attrs.FLD_ZONE,
    subtype: attrs.ZONE_SUBTY || '',
    inFloodplain: attrs.SFHA_TF === 'T',
  };
}
