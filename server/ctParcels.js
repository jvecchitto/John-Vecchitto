// Client for the statewide "Connecticut CAMA and Parcel Layer" published by
// the CT Office of Policy and Management on ArcGIS Online. The layer's field
// names have changed between yearly releases, so we read its schema at
// runtime and map fields by name/alias instead of hard-coding them.

import { classifyLand } from './landType.js';

export const DEFAULT_LAYER_URL =
  'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0';

// Logical field -> normalized candidate names (lowercase, alphanumerics only),
// in priority order. Matched against both the field name and its alias.
const FIELD_CANDIDATES = {
  town: ['townname', 'town', 'municipality'],
  location: ['location', 'propertyaddress', 'siteaddress', 'address'],
  propZip: ['propertyzip', 'propzip', 'locationzip', 'sitezip'],
  owner: ['owner', 'ownername', 'owner1'],
  coOwner: ['coowner', 'owner2'],
  mailAddress: ['mailingaddress', 'mailaddress', 'mailingaddress1'],
  mailCity: ['mailingcity', 'mailcity'],
  mailState: ['mailingstate', 'mailstate'],
  mailZip: ['mailingzip', 'mailzip', 'mailingzipcode'],
  acres: ['landacres', 'landacre', 'acres', 'acreage', 'gisacres'],
  zone: ['zone', 'zoning', 'zonedescription'],
  stateUse: ['stateuse', 'stateusecode', 'usecode'],
  stateUseDesc: ['stateusedescription', 'stateusedesc', 'usedescription'],
  assessedTotal: ['assessedtotal', 'totalassessed', 'assessment'],
  assessedLand: ['assessedland'],
  assessedBuilding: ['assessedbuilding', 'assessedbldg'],
  appraisedLand: ['appraisedland'],
  saleDate: ['saledate', 'lastsaledate', 'salesdate'],
  salePrice: ['saleprice', 'lastsaleprice', 'salesprice'],
  link: ['link', 'camalink', 'parcellink'],
  parcelId: ['parcelid', 'pid', 'gisid', 'mblu', 'camalink', 'link', 'objectid'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function resolveFields(layerFields) {
  const resolved = {};
  for (const [logical, candidates] of Object.entries(FIELD_CANDIDATES)) {
    for (const cand of candidates) {
      const hit = layerFields.find((f) => norm(f.name) === cand || norm(f.alias) === cand);
      if (hit) { resolved[logical] = hit; break; }
    }
  }
  return resolved;
}

// Rough centroid of the first polygon ring; good enough for a map marker and
// a flood-zone point lookup.
export function centroid(geometry) {
  const ring = geometry?.rings?.[0];
  if (!ring?.length) return null;
  let x = 0, y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return { lon: x / ring.length, lat: y / ring.length };
}

function toIsoDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 0 ? new Date(v).toISOString().slice(0, 10) : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function toParcel(feature, fields) {
  const a = feature.attributes || {};
  const get = (k) => (fields[k] ? a[fields[k].name] : undefined);
  const str = (k) => { const v = get(k); return v === null || v === undefined ? '' : String(v).trim(); };
  const p = {
    town: str('town'),
    location: str('location'),
    propZip: str('propZip'),
    owner: str('owner'),
    coOwner: str('coOwner'),
    mailAddress: str('mailAddress'),
    mailCity: str('mailCity'),
    mailState: str('mailState'),
    mailZip: str('mailZip'),
    acres: num(get('acres')) ?? 0,
    zone: str('zone'),
    stateUse: str('stateUse'),
    stateUseDesc: str('stateUseDesc'),
    assessedTotal: num(get('assessedTotal')),
    assessedLand: num(get('assessedLand')),
    assessedBuilding: num(get('assessedBuilding')),
    appraisedLand: num(get('appraisedLand')),
    saleDate: toIsoDate(get('saleDate')),
    salePrice: num(get('salePrice')),
    link: str('link'),
    ...centroid(feature.geometry),
  };
  p.id = `${p.town}|${str('parcelId') || p.location}`.toUpperCase();
  p.landType = classifyLand(p);
  return p;
}

function sqlString(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export function buildWhere(fields, { zip, town }) {
  const clauses = [];
  if (zip) {
    if (!fields.propZip) throw new Error('This parcel layer has no property zip field; search by town instead.');
    const f = fields.propZip;
    clauses.push(f.type === 'esriFieldTypeString'
      ? `(${f.name} = ${sqlString(zip)} OR ${f.name} LIKE ${sqlString(zip + '%')})`
      : `${f.name} = ${Number(zip)}`);
  }
  if (town) {
    if (!fields.town) throw new Error('This parcel layer has no town field.');
    clauses.push(`UPPER(${fields.town.name}) = ${sqlString(town.toUpperCase())}`);
  }
  if (!clauses.length) throw new Error('Give a zip code or a town.');
  return clauses.join(' AND ');
}

// Server-side pre-filter so we don't download every house in the zip.
export function buildLandFilter(fields) {
  const parts = [];
  if (fields.assessedBuilding) parts.push(`${fields.assessedBuilding.name} = 0`);
  if (fields.stateUseDesc) {
    const d = `UPPER(${fields.stateUseDesc.name})`;
    for (const word of ['VAC', 'LAND', 'ACRE', 'LOT', 'FOREST', 'FARM', 'UNDEV', 'EXCESS', '490', 'OPEN SPACE']) {
      parts.push(`${d} LIKE '%${word}%'`);
    }
  }
  return parts.length ? `(${parts.join(' OR ')})` : null;
}

export class CtParcelClient {
  constructor({ layerUrl = DEFAULT_LAYER_URL, fetchImpl = globalThis.fetch } = {}) {
    this.layerUrl = layerUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.meta = null;
  }

  async getJson(url) {
    const res = await this.fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Parcel service returned HTTP ${res.status}`);
    const body = await res.json();
    // ArcGIS reports errors with HTTP 200 and an "error" object.
    if (body.error) throw new Error(`Parcel service error: ${body.error.message || JSON.stringify(body.error)}`);
    return body;
  }

  async metadata() {
    if (!this.meta) {
      const layer = await this.getJson(`${this.layerUrl}?f=json`);
      this.meta = {
        fields: resolveFields(layer.fields || []),
        maxRecordCount: Math.min(layer.maxRecordCount || 1000, 2000),
      };
    }
    return this.meta;
  }

  async queryAll(where, outFields, pageSize) {
    const features = [];
    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({
        where,
        outFields: outFields.join(','),
        outSR: '4326',
        returnGeometry: 'true',
        geometryPrecision: '6',
        maxAllowableOffset: '0.0001',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        f: 'json',
      });
      const body = await this.getJson(`${this.layerUrl}/query?${params}`);
      features.push(...(body.features || []));
      if (!body.exceededTransferLimit || !body.features?.length) break;
      if (features.length > 50000) throw new Error('Too many parcels; narrow the search.');
    }
    return features;
  }

  async findLand({ zip, town }) {
    const { fields, maxRecordCount } = await this.metadata();
    const base = buildWhere(fields, { zip, town });
    const outFields = [...new Set(Object.values(fields).map((f) => f.name))];
    const landFilter = buildLandFilter(fields);
    let features;
    try {
      features = await this.queryAll(landFilter ? `${base} AND ${landFilter}` : base, outFields, maxRecordCount);
    } catch (err) {
      // Some services reject UPPER/LIKE; fall back to filtering locally.
      if (!landFilter) throw err;
      features = await this.queryAll(base, outFields, maxRecordCount);
    }
    return features.map((f) => toParcel(f, fields)).filter((p) => p.landType);
  }
}
