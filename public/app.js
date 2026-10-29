const $ = (sel) => document.querySelector(sel);
const state = { config: null, results: [], sort: { key: 'score', dir: -1 }, query: null, selected: null };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n || n === 0 ? `$${Math.round(n).toLocaleString()}` : '—');
const scoreClass = (s) => (s >= 60 ? 'hot' : s >= 35 ? 'warm' : 'cold');
const scoreColor = (s) => (s >= 60 ? '#c2410c' : s >= 35 ? '#ca8a04' : '#64748b');
const isSuppressed = (r) => /^CURRENT (CO-?)?OWNER$/i.test(r.owner || '');
const outOfTown = (r) => r.reasons.some((x) => /out-of-state|Absentee/.test(x.why));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body.error || body || res.statusText);
  return body;
}

// ---------- map ----------
const map = L.map('map').setView([41.6, -72.7], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);
const markers = L.layerGroup().addTo(map);

function drawMap(rows) {
  markers.clearLayers();
  const pts = [];
  for (const r of rows) {
    if (!Number.isFinite(r.lat)) continue;
    pts.push([r.lat, r.lon]);
    L.circleMarker([r.lat, r.lon], { radius: 7, color: '#fff', weight: 1.5, fillColor: scoreColor(r.score), fillOpacity: 0.9 })
      .bindTooltip(`${esc(r.location)} · ${r.score}`)
      .on('click', () => openDetail(r.id))
      .addTo(markers);
  }
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
}

// ---------- search ----------
function filtered() {
  const minAcres = Number($('#f-acres').value) || 0;
  const minScore = Number($('#f-score').value) || 0;
  const type = $('#f-type').value;
  return state.results.filter((r) =>
    r.acres >= minAcres && r.score >= minScore && (!type || r.landType === type)
    && (!$('#f-absentee').checked || outOfTown(r))
    && (!$('#f-expired').checked || r.listingKind === 'expired')
    && (!$('#f-hide-active').checked || r.listingKind !== 'active'));
}

function render() {
  const { key, dir } = state.sort;
  const rows = filtered().sort((a, b) => {
    const x = a[key] ?? '', y = b[key] ?? '';
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
  });
  $('#results tbody').innerHTML = rows.map((r) => `
    <tr data-id="${esc(r.id)}" class="${state.selected === r.id ? 'selected' : ''}">
      <td><span class="score ${scoreClass(r.score)}">${r.score}</span></td>
      <td>${esc(r.location || '(no address)')}<div class="muted small">${esc(r.town)}</div></td>
      <td>${r.acres ? r.acres.toFixed(2) : '—'}</td>
      <td class="small">${esc(r.landType)}</td>
      <td class="small">${isSuppressed(r) ? '<span class="muted">Withheld by town</span>' : esc(r.owner)}</td>
      <td>${esc(r.mailState || '')}</td>
      <td class="small">${r.listing ? `<span class="pill ${r.listingKind}">${esc(r.listing.status)}</span>` : ''}</td>
      <td class="small">${esc(r.lead?.status || '')}</td>
    </tr>`).join('');
  const total = state.results.length;
  $('#status').textContent = total
    ? `${rows.length} of ${total} vacant land parcels shown.`
    : 'No vacant land parcels found.';
  drawMap(rows);
}

$('#results tbody').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (tr) openDetail(tr.dataset.id);
});

document.querySelectorAll('#results th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (key === 'score' || key === 'acres' ? -1 : 1) };
  render();
}));

['#f-acres', '#f-score', '#f-type', '#f-absentee', '#f-expired', '#f-hide-active'].forEach((s) => $(s).addEventListener('input', render));

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zip = $('#zip').value.trim();
  const town = $('#town').value.trim();
  const qs = new URLSearchParams(zip ? { zip } : { town });
  $('#status').textContent = 'Searching the CT parcel layer… large towns can take 20–30 seconds.';
  try {
    const { results } = await api(`/api/search?${qs}`);
    state.results = results;
    state.query = qs.toString();
    const types = [...new Set(results.map((r) => r.landType))].sort();
    $('#f-type').innerHTML = '<option value="">Any</option>' + types.map((t) => `<option>${esc(t)}</option>`).join('');
    $('#export').href = `/api/export.csv?${qs}`;
    $('#export').hidden = false;
    render();
  } catch (err) {
    $('#status').textContent = `Search failed: ${err.message}`;
  }
});

// ---------- detail ----------
function researchLinks(r) {
  const links = [];
  if (Number.isFinite(r.lat)) {
    links.push(['Google Maps (satellite)', `https://www.google.com/maps/@${r.lat},${r.lon},300m/data=!3m1!1e3`]);
  }
  if (/^https?:/i.test(r.link)) links.push(['Assessor record', r.link]);
  const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  links.push(['Town assessor online database', g(`${r.town} CT assessor online database ${r.location}`)]);
  links.push(['Town zoning regulations & map', g(`${r.town} CT zoning regulations map`)]);
  links.push(['Town land records (deeds, plats)', g(`${r.town} CT town clerk land records search`)]);
  if (!isSuppressed(r) && r.owner) {
    if (/\b(LLC|INC|CORP|CO|LP|LTD|COMPANY)\b/i.test(r.owner)) {
      links.push(['CT business registry (agent & principals)', 'https://service.ct.gov/business/s/onlinebusinesssearch']);
    }
    links.push(['Search owner online', g(`"${r.owner.replace(/^SAMPLE /, '')}" ${r.mailCity} ${r.mailState}`)]);
  }
  links.push(['National Do Not Call registry (for numbers you find)', 'https://www.donotcall.gov/']);
  return links;
}

function openDetail(id) {
  const r = state.results.find((x) => x.id === id);
  if (!r) return;
  state.selected = id;
  const lead = r.lead || {};
  const opt = (list, v) => list.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const l = r.listing;
  $('#detail-body').innerHTML = `
    <h2>${esc(r.location || '(no address)')}</h2>
    <p class="muted">${esc(r.town)} ${esc(r.propZip)}</p>
    <p><span class="score big ${scoreClass(r.score)}">${r.score}</span> seller likelihood</p>
    <ul class="reasons">${r.reasons.map((x) => `<li><b>${x.pts > 0 ? '+' : ''}${x.pts || ''}</b> ${esc(x.why)}</li>`).join('')}</ul>

    <h3>Parcel</h3>
    <dl>
      <dt>Acres</dt><dd>${r.acres ? r.acres.toFixed(2) : '—'}</dd>
      <dt>Type</dt><dd>${esc(r.landType)}</dd>
      <dt>Assessor use</dt><dd>${esc(r.stateUseDesc || '—')}</dd>
      <dt>Zone</dt><dd>${esc(r.zone || '—')}</dd>
      <dt>Assessed land</dt><dd>${money(r.assessedLand)}</dd>
      <dt>Assessed total</dt><dd>${money(r.assessedTotal)} <span class="muted small">(CT assesses at 70% of value)</span></dd>
      <dt>Last sale</dt><dd>${esc(r.saleDate || '—')} ${r.saleDate ? money(r.salePrice) : ''}</dd>
      <dt>Flood zone</dt><dd id="flood"><button id="flood-btn" class="link">Check FEMA</button></dd>
    </dl>

    <h3>Owner</h3>
    ${isSuppressed(r) ? '<p class="muted">This town withholds owner names from the state file. Look it up in the town assessor database.</p>' : `
    <dl>
      <dt>Owner</dt><dd>${esc(r.owner)}</dd>
      ${r.coOwner ? `<dt>Co-owner</dt><dd>${esc(r.coOwner)}</dd>` : ''}
      <dt>Mailing</dt><dd>${esc(r.mailAddress)}<br>${esc(r.mailCity)}, ${esc(r.mailState)} ${esc(r.mailZip)}</dd>
    </dl>`}

    <h3>MLS</h3>
    ${l ? `<dl>
      <dt>Status</dt><dd><span class="pill ${r.listingKind}">${esc(l.status)}</span> ${l.offMarketDate ? `<span class="small muted">${esc(l.offMarketDate)}</span>` : ''}</dd>
      <dt>MLS #</dt><dd>${esc(l.mls || '—')}</dd>
      <dt>List price</dt><dd>${money(l.listPrice)}${l.originalPrice && l.originalPrice !== l.listPrice ? ` <span class="muted small">(orig. ${money(l.originalPrice)})</span>` : ''}</dd>
      <dt>Days on market</dt><dd>${esc(l.dom ?? '—')}</dd>
      <dt>Listing agent</dt><dd>${esc(l.agent || '—')} ${l.agentPhone ? `· ${esc(l.agentPhone)}` : ''}<br><span class="small muted">${esc(l.office)}</span></dd>
      <dt>Match</dt><dd class="small muted">${esc(r.matchConfidence)}</dd>
    </dl>` : '<p class="muted">No matching listing in your imported MLS data.</p>'}

    <h3>Lead</h3>
    <form id="lead-form">
      <label>Status <select name="status">${opt(state.config.leadStatuses, lead.status || 'New')}</select></label>
      <label>Approval status <select name="entitlement">${opt(state.config.entitlementOptions, lead.entitlement || 'Unknown')}</select></label>
      <label>Phone <input name="phone" value="${esc(lead.phone)}"></label>
      <label>Email <input name="email" type="email" value="${esc(lead.email)}"></label>
      <label>Notes <textarea name="notes" rows="4">${esc(lead.notes)}</textarea></label>
      <button type="submit">Save lead</button> <span id="lead-saved" class="muted small"></span>
    </form>

    <h3>Research</h3>
    <ul class="links">${researchLinks(r).map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul>
  `;
  $('#detail').hidden = false;
  render();

  $('#flood-btn').addEventListener('click', async () => {
    $('#flood').textContent = 'Checking…';
    try {
      const f = await api(`/api/flood?lat=${r.lat}&lon=${r.lon}`);
      $('#flood').innerHTML = `${esc(f.zone)}${f.subtype ? ` <span class="small muted">${esc(f.subtype)}</span>` : ''}${f.inFloodplain ? ' <span class="pill expired">100-yr floodplain</span>' : ''}<div class="small muted">At the parcel center only</div>`;
    } catch (err) {
      $('#flood').textContent = `Could not reach FEMA: ${err.message}`;
    }
  });

  $('#lead-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.parcel = { owner: r.owner, location: r.location, town: r.town, acres: r.acres };
    try {
      r.lead = await api(`/api/leads/${encodeURIComponent(r.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      $('#lead-saved').textContent = 'Saved';
      render();
    } catch (err) {
      $('#lead-saved').textContent = `Save failed: ${err.message}`;
    }
  });
}

$('#close-detail').addEventListener('click', () => {
  $('#detail').hidden = true;
  state.selected = null;
  render();
});

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  for (const t of ['search', 'leads', 'listings']) $(`#tab-${t}`).hidden = t !== btn.dataset.tab;
  if (btn.dataset.tab === 'leads') loadLeads();
  if (btn.dataset.tab === 'search') map.invalidateSize();
}));

async function loadLeads() {
  const { leads } = await api('/api/leads');
  leads.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  $('#leads-table tbody').innerHTML = leads.length ? leads.map((l) => `
    <tr>
      <td>${esc(l.parcel?.location)}<div class="muted small">${esc(l.parcel?.town)}</div></td>
      <td class="small">${esc(l.parcel?.owner)}</td>
      <td>${esc(l.status)}</td><td class="small">${esc(l.entitlement)}</td>
      <td>${esc(l.phone)}</td><td>${esc(l.email)}</td>
      <td class="small muted">${esc((l.updatedAt || '').slice(0, 10))}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="muted">No saved leads yet.</td></tr>';
}

// ---------- listings ----------
function showListingCount() {
  const c = state.config;
  $('#listings-status').textContent = c.listingCount
    ? `${c.listingCount} listings loaded (last import ${new Date(c.listingsImportedAt).toLocaleString()}).`
    : 'No listings imported yet.';
}

$('#csv-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#listings-status').textContent = 'Importing…';
  try {
    const r = await api('/api/listings', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text() });
    state.config.listingCount = r.total;
    state.config.listingsImportedAt = new Date().toISOString();
    $('#listings-status').textContent = `Imported ${r.imported} listings (${r.total} total). Columns used: ${Object.entries(r.columns).map(([k, v]) => `${k} ← "${v}"`).join(', ')}. Re-run your search to see matches.`;
  } catch (err) {
    $('#listings-status').textContent = `Import failed: ${err.message}`;
  }
  e.target.value = '';
});

$('#clear-listings').addEventListener('click', async () => {
  if (!confirm('Remove all imported MLS listings?')) return;
  await api('/api/listings', { method: 'DELETE' });
  state.config.listingCount = 0;
  showListingCount();
});

(async () => {
  state.config = await api('/api/config');
  $('#demo-badge').hidden = !state.config.demo;
  if (state.config.demo) $('#zip').value = '06443';
  showListingCount();
})();
