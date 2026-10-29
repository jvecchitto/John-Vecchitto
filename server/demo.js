// Offline demo: a fake ArcGIS parcel service with made-up parcels, so the app
// can be tried (and tested) without network access. Names are fictional.

const FIELDS = [
  ['OBJECTID', 'esriFieldTypeOID'], ['Town_Name', 'esriFieldTypeString', 'Town Name'],
  ['Owner', 'esriFieldTypeString'], ['Co_Owner', 'esriFieldTypeString', 'Co-Owner'],
  ['Location', 'esriFieldTypeString'], ['Property_Zip', 'esriFieldTypeString', 'Property Zip'],
  ['Mailing_Address', 'esriFieldTypeString', 'Mailing Address'], ['Mailing_City', 'esriFieldTypeString', 'Mailing City'],
  ['Mailing_State', 'esriFieldTypeString', 'Mailing State'], ['Mailing_Zip', 'esriFieldTypeString', 'Mailing Zip'],
  ['Assessed_Total', 'esriFieldTypeDouble', 'Assessed Total'], ['Assessed_Land', 'esriFieldTypeDouble', 'Assessed Land'],
  ['Assessed_Building', 'esriFieldTypeDouble', 'Assessed Building'], ['Zone', 'esriFieldTypeString'],
  ['State_Use', 'esriFieldTypeString', 'State Use'], ['State_Use_Description', 'esriFieldTypeString', 'State Use Description'],
  ['Land_Acres', 'esriFieldTypeDouble', 'Land Acres'], ['Sale_Date', 'esriFieldTypeDate', 'Sale Date'],
  ['Sale_Price', 'esriFieldTypeDouble', 'Sale Price'], ['Link', 'esriFieldTypeString'],
].map(([name, type, alias]) => ({ name, type, alias: alias || name }));

const ROWS = [
  // owner, co-owner, location, mail addr, mail city, mail state, mail zip, use desc, acres, bldg, sale date, sale price, zone
  ['SAMPLE ESTATE OF JANE DOE', '', '0 OLD POST RD', '14 ELM ST', 'HAMDEN', 'CT', '06514', 'RES VACANT LAND', 6.2, 0, '1987-05-01', 0, 'R-4'],
  ['SAMPLE PAT SMITH', 'SAMPLE LEE SMITH', 'LOT 3 FOREST LN', '200 OCEAN DR', 'NAPLES', 'FL', '34102', 'RES BUILDABLE LOT', 1.4, 0, '2003-09-12', 85000, 'R-2'],
  ['SAMPLE RIVERBEND LLC', '', '45 BOSTON POST RD', '1 MAIN ST STE 4', 'NEW HAVEN', 'CT', '06510', 'COM VAC LAND', 2.8, 0, '2024-11-01', 410000, 'C-1'],
  ['SAMPLE CHRIS JONES TRUSTEE', 'SAMPLE JONES FAMILY TRUST', 'REAR DURHAM RD', '18 DURHAM RD', 'MADISON', 'CT', '06443', 'FOREST PA 490', 24.5, 0, '1998-02-20', 120000, 'RU-1'],
  ['SAMPLE ALEX GREEN', '', '12 HIGH ST', '12 HIGH ST', 'MADISON', 'CT', '06443', 'SINGLE FAM', 0.5, 310000, '2010-06-15', 525000, 'R-2'],
  ['SAMPLE TAYLOR BROWN', '', '0 HORSE POND RD', '77 PARK AVE', 'NEW YORK', 'NY', '10016', 'RES VAC UNDEVELOPABLE', 0.9, 0, '2015-03-03', 5000, 'R-4'],
  ['SAMPLE MORGAN WHITE', '', '88 GREEN HILL RD', '9 SHORE LN', 'MADISON', 'CT', '06443', 'RES VACANT LAND', 3.1, 0, '2021-07-30', 175000, 'R-4'],
  ['CURRENT OWNER', 'CURRENT CO-OWNER', '0 COPSE RD', '0 COPSE RD', 'MADISON', 'CT', '06443', 'RES VACANT LAND', 1.1, 0, '2008-01-10', 60000, 'R-2'],
];

function features(zip, town) {
  return ROWS.map((r, i) => {
    const lon = -72.60 + (i % 4) * 0.012;
    const lat = 41.28 + Math.floor(i / 4) * 0.012;
    const d = 0.0015;
    return {
      attributes: {
        OBJECTID: i + 1, Town_Name: town || 'MADISON', Owner: r[0], Co_Owner: r[1], Location: r[2],
        Property_Zip: zip || '06443', Mailing_Address: r[3], Mailing_City: r[4], Mailing_State: r[5], Mailing_Zip: r[6],
        State_Use_Description: r[7], State_Use: String(100 + i), Land_Acres: r[8], Assessed_Building: r[9],
        Assessed_Land: Math.round(r[8] * 42000), Assessed_Total: Math.round(r[8] * 42000) + r[9],
        Sale_Date: Date.parse(r[10]), Sale_Price: r[11], Zone: r[12], Link: `DEMO-${i + 1}`,
      },
      geometry: { rings: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] },
    };
  });
}

export const DEMO_LISTINGS_CSV = `MLS #,Address,City,Status,List Price,Original List Price,DOM,List Agent,List Office,Expiration Date,Acres
DEMO1001,Old Post Road,Madison,Expired,189000,229000,240,Sample Agent One,Sample Realty,${new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)},6.2
DEMO1002,88 Green Hill Road,Madison,Active,199000,199000,45,Sample Agent Two,Sample Brokers,,3.1
DEMO1003,Lot 3 Forest Lane,Madison,Withdrawn,129000,139000,150,Sample Agent One,Sample Realty,2026-01-15,1.4
`;

export function demoFetch(url) {
  const u = new URL(url);
  let body;
  if (u.hostname.includes('fema')) {
    const x = Number(u.searchParams.get('geometry').split(',')[0]);
    body = { features: x < -72.59 ? [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: '', SFHA_TF: 'T' } }] : [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F' } }] };
  } else if (u.pathname.endsWith('/query')) {
    const where = u.searchParams.get('where') || '';
    const zip = where.match(/'(\d{5})/)?.[1];
    const town = where.match(/UPPER\(\w+\) = '([A-Z ]+)'/)?.[1];
    const all = features(zip, town);
    const offset = Number(u.searchParams.get('resultOffset') || 0);
    const count = Number(u.searchParams.get('resultRecordCount') || 1000);
    body = { features: all.slice(offset, offset + count), exceededTransferLimit: offset + count < all.length };
  } else {
    body = { fields: FIELDS, maxRecordCount: 5 };
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}
