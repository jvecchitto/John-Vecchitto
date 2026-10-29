# CT Land Leads

A small web app for finding vacant land in Connecticut and ranking the owners by how likely they are to sell.

Enter a zip code or town. You get:

- Every vacant or land-use parcel there, on a map and in a sortable table
- Owner name, co-owner, mailing address, acreage, zoning, assessor use, assessed value and last sale
- A land type from the assessor's use code: residential buildable lot, PA 490 farm or forest, commercial or industrial vacant, undevelopable
- The matching MLS listing from your imported export (expired, withdrawn or active), with listing agent and office
- A **seller-likelihood score (0–100)** with the reasons listed
- FEMA flood zone on demand
- Fields to track each lead: status, approval status, phone, email and notes
- CSV export of the results

## Data sources (all free)

| Data | Source |
|---|---|
| Parcels, owners, mailing addresses, acres, zone, use, assessments, sales | [Connecticut CAMA and Parcel Layer](https://geodata.ct.gov/maps/ctmaps::connecticut-cama-and-parcel-layer), published each year by CT OPM for all 169 towns |
| Flood zones | FEMA National Flood Hazard Layer |
| Listings | An MLS export (CSV) uploaded by the realtor (see below) |

The app reads the parcel layer's field list when it starts and matches fields by name. If the state renames a column in a future release, the app keeps working. If the state moves the service, set `PARCEL_LAYER_URL`.

## Running it

Requires Node.js 18 or newer.

```bash
npm install
npm start            # http://localhost:3000, live CT data
npm run demo         # made-up sample parcels and listings, no internet needed
npm test
```

Environment variables:

- `PORT`: defaults to 3000
- `APP_PASSWORD`: when set, the browser asks for a password. Set this whenever the app is on the internet, because it shows owner information.
- `PARCEL_LAYER_URL`: overrides the ArcGIS parcel layer URL

Saved leads and imported listings are stored in `data/leads.json` and `data/listings.json`. Back up that folder.

To share it with your realtor, deploy it to a small Node host such as Render or Railway with a persistent disk for `data/`, and set `APP_PASSWORD`.

## Getting expired listings into the app

IDX feeds normally carry **active** listings only. Expired, withdrawn and canceled listings come from the MLS itself:

1. In SmartMLS, search Property Type **Lots and Land**, Status **Expired / Withdrawn / Canceled** (add Active too if you want those flagged), in your towns.
2. Export the results to CSV with at least: Address (or Street Number and Street Name), City, Status, List Price, Original List Price, DOM, List Agent, List Office, MLS #, Expiration or Off-Market Date, and Acres.
3. Upload the file on the **MLS listings** tab. Column names are detected automatically, and listings with an MLS # you've already imported are replaced.

Land addresses are often messy, like `0 Main St`, `Lot 3 Main St` or `Rear Main St`. When there's no exact match, the app matches on street and town, and uses acreage to choose between several parcels on the same street. Each match shows how it was made.

## How the score works

Each lead starts at 10, and the points below are added or subtracted (capped at 0–100):

| Signal | Points |
|---|---|
| Expired, withdrawn or canceled listing | +30 |
| … off the market in the last 90 days, price reduced, or 180+ days on market | +5 each |
| Out-of-state owner | +20 |
| Owner lives in another CT town | +12 |
| Estate or heirs | +15 |
| Trust | +5 |
| Owned 25+ years / 15+ years | +12 / +8 |
| Last transfer for $0 (inheritance, gift, quitclaim) | +5 |
| 5+ acres / 2+ acres | +6 / +3 |
| PA 490 (conveyance tax can discourage a sale) | −5 |
| Undevelopable | −8 |
| Bought in the last 2 years | −10 |
| Sold per MLS | −20 |

Active listings get no points. They're labeled "do not solicit," because the owner already has an agent. Change the weights in `server/score.js` as you learn which leads actually convert.

## What free data can't tell you

- **Whether land is approved.** The state file has zoning and the assessor's use code, but not subdivision, site-plan or wetlands approvals. Check with the town's Planning & Zoning or land records, then record it in the lead's **Approval status** field.
- **Phone and email.** These aren't public. The detail panel links to the town assessor, land records, the CT business registry (for LLC owners), and a web search for the owner. Enter what you find. A paid skip-tracing service can be added later.
- **Tax delinquency.** Each town's tax collector keeps this; it isn't in the state file.
- **Some owner names.** A few towns withhold them in the state file and show "Current Owner." Look those up in the town's own assessor database.

## Compliance

- Check every phone number against the National Do Not Call Registry before cold calling. Texting has stricter TCPA consent rules.
- Don't solicit owners whose land is actively listed with another agent (NAR Code of Ethics, Article 16).
- Use MLS data only as your MLS's rules allow.

## Project layout

```
server/
  index.js       Express app and API routes
  ctParcels.js   CT parcel layer client (schema discovery, paging, land filter)
  landType.js    Land classification from the assessor's use code
  score.js       Seller-likelihood score
  listings.js    MLS CSV import and parcel matching
  address.js     Address normalization
  flood.js       FEMA flood zone lookup
  store.js       JSON file storage
  demo.js        Offline sample data
public/          Web UI (plain HTML/JS with a Leaflet map)
test/            node:test suite
```
