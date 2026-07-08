// =====================================================================
// TopoChaouia — Carte des Titres (visualisation terrain hors-bureau)
// =====================================================================

const TITRES_MIN_ZOOM = 13;
const BORNES_MIN_ZOOM = 13;
const TILE_BUFFER = 0.01;

// Lambert Nord Maroc (EPSG:26191, Merchich) — utilisé uniquement pour
// l'affichage en direct des coordonnées au centre de l'écran (réticule).
// Les données des titres/bornes elles-mêmes sont déjà pré-converties en
// WGS84 côté serveur avec la définition officielle EPSG:26191.
proj4.defs('EPSG:26191',
  '+proj=lcc +lat_1=33.3 +lat_0=33.3 +lon_0=-5.4 +k_0=0.999625769 ' +
  '+x_0=500000 +y_0=300000 +ellps=clrk80ign +towgs84=31,146,47,0,0,0,0 +units=m +no_defs');

let map, satLayer, osmLayer;
let titresLayerGroup, bornesLayerGroup;
let tilesIndex = null, bornesTilesIndex = null;
let loadedTitreTiles = new Set(), loadedBornesTiles = new Set();
let searchIndex = null, searchIndexLoading = null;
let gpsWatchId = null, gpsMarker = null, gpsAccuracyCircle = null, lastGpsLatLng = null;
let highlightLayer = null;

// Mesure de distance
let measureActive = false;
let measurePoints = [];
let measureLayer = null;

// Point cible (réticule verrouillé)
let targetLatLng = null;
let targetMarker = null;
let targetLineLayer = null;

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
init();

async function init() {
  map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 20 });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  satLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagery © Esri', maxZoom: 20, maxNativeZoom: 19 }
  );
  osmLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap', maxZoom: 19 }
  );
  satLayer.addTo(map);

  titresLayerGroup = L.layerGroup().addTo(map);
  bornesLayerGroup = L.layerGroup().addTo(map);
  measureLayer = L.layerGroup().addTo(map);

  map.setView([32.9, -7.6], 12);

  wireUI();

  try {
    const res = await fetch('tiles_index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    tilesIndex = await res.json();
    fitToIndexBounds();
  } catch (e) {
    console.error('Erreur chargement tiles_index.json', e);
    showDataError();
  }

  try {
    const res = await fetch('bornes_tiles_index.json');
    if (res.ok) bornesTilesIndex = await res.json();
  } catch (e) {
    console.error('Erreur chargement bornes_tiles_index.json', e);
  }

  map.on('moveend', onMapMoved);
  map.on('move', updateCrosshairReadout);
  onMapMoved();
  updateCrosshairReadout();
}

function fitToIndexBounds() {
  if (!tilesIndex || !tilesIndex.core_bbox) return;
  const b = tilesIndex.core_bbox;
  map.fitBounds([[b.minlat, b.minlon], [b.maxlat, b.maxlon]], { padding: [20, 20] });
}

function fitToFullBounds() {
  if (!tilesIndex || !tilesIndex.full_bbox) return;
  const b = tilesIndex.full_bbox;
  map.fitBounds([[b.minlat, b.minlon], [b.maxlat, b.maxlon]], { padding: [20, 20] });
}

// ---------------------------------------------------------------------
// Chargement des tuiles (titres + bornes) selon la vue courante
// ---------------------------------------------------------------------
function onMapMoved() {
  updateStatusInfo();
  const z = map.getZoom();
  const banner = document.getElementById('zoomBanner');

  if (z < TITRES_MIN_ZOOM) {
    banner.textContent = `Zoomez pour voir les titres et bornes (zoom ${z}/${TITRES_MIN_ZOOM})`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  if (z < TITRES_MIN_ZOOM) return;

  const b = map.getBounds();
  const minlon = b.getWest() - TILE_BUFFER, maxlon = b.getEast() + TILE_BUFFER;
  const minlat = b.getSouth() - TILE_BUFFER, maxlat = b.getNorth() + TILE_BUFFER;
  const intersects = t => !(t.maxlon < minlon || t.minlon > maxlon || t.maxlat < minlat || t.minlat > maxlat);

  if (tilesIndex) {
    const toLoad = tilesIndex.tiles.filter(t => t.count > 0 && !loadedTitreTiles.has(t.gx + '_' + t.gy) && intersects(t));
    if (toLoad.length) { showToast(true); Promise.all(toLoad.map(loadTitreTile)).finally(() => showToast(false)); }
  }
  if (bornesTilesIndex && document.getElementById('toggleBornes').checked) {
    const toLoad = bornesTilesIndex.tiles.filter(t => t.count > 0 && !loadedBornesTiles.has(t.gx + '_' + t.gy) && intersects(t));
    toLoad.forEach(loadBornesTile);
  }
}

async function loadTitreTile(tileMeta) {
  const key = tileMeta.gx + '_' + tileMeta.gy;
  if (loadedTitreTiles.has(key)) return;
  loadedTitreTiles.add(key);
  try {
    const res = await fetch(tileMeta.file);
    const gj = await res.json();
    L.geoJSON(gj, {
      style: styleTitre,
      onEachFeature: (feature, lyr) => lyr.on('click', () => showTitreInfo(feature.properties, lyr))
    }).addTo(titresLayerGroup);
  } catch (e) {
    loadedTitreTiles.delete(key);
    console.error('Erreur tuile titre', tileMeta.file, e);
  }
}

async function loadBornesTile(tileMeta) {
  const key = tileMeta.gx + '_' + tileMeta.gy;
  if (loadedBornesTiles.has(key)) return;
  loadedBornesTiles.add(key);
  try {
    const res = await fetch(tileMeta.file);
    const gj = await res.json();
    L.geoJSON(gj, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 4, color: '#0b3a36', weight: 1, fillColor: '#35e0d0', fillOpacity: 0.95
      }),
      onEachFeature: (feature, lyr) => lyr.on('click', () => showBorneInfo(feature.properties))
    }).addTo(bornesLayerGroup);
  } catch (e) {
    loadedBornesTiles.delete(key);
    console.error('Erreur tuile borne', tileMeta.file, e);
  }
}

function styleTitre(feature) {
  const nature = (feature.properties.Nature || '').toUpperCase();
  let color = '#ffb020';
  if (nature === 'R') color = '#ff8a3d';
  else if (nature === 'T') color = '#35c7ff';
  return { color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.12 };
}

// ---------------------------------------------------------------------
// Info sheet (parcelle / borne)
// ---------------------------------------------------------------------
function showTitreInfo(props, layer) {
  const rows = [
    ['N° Titre', props.Num], ['Indice', props.indice], ['Complément', props.complement],
    ['Nature', props.Nature], ['Type', props.Type],
    ['Surface calculée (m²)', props.Surf_Calc], ['Surface adoptée (m²)', props.Surf_Adop],
    ['Feuille (Mappe)', props.Mappe], ['Stade', props.stade], ['Désignation', props.TIT],
  ].filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');

  document.getElementById('infoContent').innerHTML =
    `<h3>Titre N° ${props.Num ?? ''}</h3>` +
    rows.map(r => `<div class="info-row"><span>${r[0]}</span><span>${escapeHtml(String(r[1]))}</span></div>`).join('');
  openInfoSheet();

  if (layer) {
    if (highlightLayer) map.removeLayer(highlightLayer);
    highlightLayer = L.geoJSON(layer.feature, { style: { color: '#ffffff', weight: 4, fillOpacity: 0.05 } }).addTo(map);
  }
}

function showBorneInfo(props) {
  const rows = [
    ['N° Borne', props.Num], ['Titre associé', props.Num_Titre],
    ['Nature titre', props.Nature_Titre], ['Indice', props.indice_Titre],
  ].filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');

  document.getElementById('infoContent').innerHTML =
    `<h3>Borne ${props.Num ?? ''}</h3>` +
    rows.map(r => `<div class="info-row"><span>${r[0]}</span><span>${escapeHtml(String(r[1]))}</span></div>`).join('');
  openInfoSheet();
}

function openInfoSheet() {
  document.getElementById('infoSheet').classList.remove('hidden');
}
function closeInfoSheet() {
  document.getElementById('infoSheet').classList.add('hidden');
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------------------------------------------------------------------
// Recherche par N° de titre
// ---------------------------------------------------------------------
async function ensureSearchIndex() {
  if (searchIndex) return searchIndex;
  if (searchIndexLoading) return searchIndexLoading;
  showToast(true, 'Chargement de l\u2019index de recherche…');
  searchIndexLoading = fetch('search_index.json')
    .then(r => r.json())
    .then(data => { searchIndex = data; showToast(false); return data; })
    .catch(e => { console.error(e); showToast(false); return []; });
  return searchIndexLoading;
}

async function runSearch(query) {
  query = query.trim();
  const resultsEl = document.getElementById('searchResults');
  if (!query) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

  const idx = await ensureSearchIndex();
  const q = query.toLowerCase();
  const matches = idx.filter(e =>
    String(e.num).includes(q) || (e.mappe || '').toLowerCase().includes(q) || (e.tit || '').toLowerCase().includes(q)
  ).slice(0, 30);

  resultsEl.innerHTML = matches.length === 0
    ? '<div class="res-empty">Aucun titre trouvé</div>'
    : matches.map((m, i) =>
        `<div class="res-item" data-i="${i}"><b>Titre ${escapeHtml(String(m.num))}</b>` +
        `<div>${escapeHtml(m.mappe || '—')} ${m.indice ? '· indice ' + escapeHtml(m.indice) : ''} ${m.nature ? '· ' + escapeHtml(m.nature) : ''}</div></div>`
      ).join('');
  resultsEl.querySelectorAll('.res-item').forEach(el => {
    el.addEventListener('click', () => goToSearchResult(matches[parseInt(el.dataset.i)]));
  });
  resultsEl.classList.remove('hidden');
}

async function goToSearchResult(m) {
  document.getElementById('searchResults').classList.add('hidden');
  document.getElementById('searchInput').blur();
  map.setView([m.lat, m.lon], 18);
  const tileMeta = tilesIndex.tiles.find(t => t.file === m.file);
  if (tileMeta) await loadTitreTile(tileMeta);
  titresLayerGroup.eachLayer(sub => {
    if (sub.eachLayer) sub.eachLayer(lyr => {
      if (lyr.feature && String(lyr.feature.properties.Num) === String(m.num) &&
          (lyr.feature.properties.Mappe || '') === (m.mappe || '')) {
        showTitreInfo(lyr.feature.properties, lyr);
      }
    });
  });
}

// ---------------------------------------------------------------------
// Géolocalisation
// ---------------------------------------------------------------------
function toggleGps() {
  const btn = document.getElementById('btnLocate');
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    btn.classList.remove('active');
    return;
  }
  if (!navigator.geolocation) { alert('La géolocalisation n\u2019est pas disponible sur cet appareil/navigateur.'); return; }
  btn.classList.add('active');
  let first = true;
  gpsWatchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    updateGpsMarker(latitude, longitude, accuracy);
    if (first) { map.setView([latitude, longitude], 18); first = false; }
  }, err => {
    console.error(err);
    alert('Position indisponible : ' + err.message);
    btn.classList.remove('active');
    gpsWatchId = null;
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
}

function updateGpsMarker(lat, lon, accuracy) {
  const latlng = [lat, lon];
  lastGpsLatLng = L.latLng(lat, lon);
  if (!gpsMarker) {
    gpsMarker = L.circleMarker(latlng, { radius: 8, color: '#ffffff', weight: 2, fillColor: '#4c8dff', fillOpacity: 1 }).addTo(map);
    gpsAccuracyCircle = L.circle(latlng, { radius: accuracy, color: '#4c8dff', weight: 1, fillOpacity: 0.08 }).addTo(map);
  } else {
    gpsMarker.setLatLng(latlng);
    gpsAccuracyCircle.setLatLng(latlng);
    gpsAccuracyCircle.setRadius(accuracy);
  }
  updateTargetLine();
}

// ---------------------------------------------------------------------
// Réticule central + coordonnées Lambert Nord Maroc en direct
// ---------------------------------------------------------------------
function updateCrosshairReadout() {
  if (!map) return;
  const c = map.getCenter();
  const el = document.getElementById('coordReadout');
  if (!el || el.classList.contains('hidden')) return;
  try {
    const [x, y] = proj4('EPSG:4326', 'EPSG:26191', [c.lng, c.lat]);
    el.querySelector('.coord-x').textContent = 'X ' + x.toFixed(2);
    el.querySelector('.coord-y').textContent = 'Y ' + y.toFixed(2);
  } catch (e) { /* ignore */ }
}

function lockTarget() {
  const c = map.getCenter();
  targetLatLng = L.latLng(c.lat, c.lng);
  if (!targetMarker) {
    targetMarker = L.marker(targetLatLng, {
      icon: L.divIcon({ className: 'target-icon', html: '🎯', iconSize: [26, 26] })
    }).addTo(map);
  } else {
    targetMarker.setLatLng(targetLatLng);
  }
  document.getElementById('btnClearTarget').classList.remove('hidden');
  updateTargetLine();
}

function clearTarget() {
  targetLatLng = null;
  if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
  if (targetLineLayer) { map.removeLayer(targetLineLayer); targetLineLayer = null; }
  document.getElementById('btnClearTarget').classList.add('hidden');
  document.getElementById('targetInfo').classList.add('hidden');
}

function updateTargetLine() {
  if (!targetLatLng) return;
  const infoEl = document.getElementById('targetInfo');
  if (!lastGpsLatLng) {
    infoEl.innerHTML = 'Point cible fixé. Activez le GPS 📍 pour voir la distance et le gisement.';
    infoEl.classList.remove('hidden');
    return;
  }
  if (targetLineLayer) map.removeLayer(targetLineLayer);
  targetLineLayer = L.polyline([lastGpsLatLng, targetLatLng], { color: '#ff5a5a', weight: 3, dashArray: '6,6' }).addTo(map);

  // Distance et gisement calculés en projection Lambert (plan), convention
  // topographique marocaine : gisement en grades, sens horaire depuis le Nord.
  const [x1, y1] = proj4('EPSG:4326', 'EPSG:26191', [lastGpsLatLng.lng, lastGpsLatLng.lat]);
  const [x2, y2] = proj4('EPSG:4326', 'EPSG:26191', [targetLatLng.lng, targetLatLng.lat]);
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let gisementRad = Math.atan2(dx, dy);
  if (gisementRad < 0) gisementRad += 2 * Math.PI;
  const gisementGrades = gisementRad * (200 / Math.PI);

  infoEl.innerHTML =
    `<div class="ti-row"><span>🎯 Distance vers la cible</span><b>${dist.toFixed(2)} m</b></div>` +
    `<div class="ti-row"><span>Gisement</span><b>${gisementGrades.toFixed(2)} gr</b></div>`;
  infoEl.classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Mesure de distance (deux points ou plus, au clic)
// ---------------------------------------------------------------------
function toggleMeasure() {
  measureActive = !measureActive;
  const btn = document.getElementById('btnMeasure');
  btn.classList.toggle('active', measureActive);
  if (!measureActive) {
    measurePoints = [];
    measureLayer.clearLayers();
    document.getElementById('measureInfo').classList.add('hidden');
  } else {
    closeInfoSheet();
  }
}

function handleMapClickForMeasure(latlng) {
  measurePoints.push(latlng);
  measureLayer.clearLayers();
  measurePoints.forEach(p => {
    L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#ffe14d', fillOpacity: 1 }).addTo(measureLayer);
  });
  if (measurePoints.length > 1) {
    L.polyline(measurePoints, { color: '#ffe14d', weight: 3 }).addTo(measureLayer);
  }
  let total = 0;
  for (let i = 1; i < measurePoints.length; i++) total += measurePoints[i - 1].distanceTo(measurePoints[i]);

  const infoEl = document.getElementById('measureInfo');
  if (measurePoints.length >= 2) {
    infoEl.innerHTML = `<b>${total.toFixed(2)} m</b> — ${measurePoints.length} point(s) · touchez 📏 pour effacer`;
    infoEl.classList.remove('hidden');
  } else {
    infoEl.innerHTML = 'Touchez un 2ᵉ point sur la carte pour mesurer la distance';
    infoEl.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------
function wireUI() {
  document.getElementById('btnMenu').addEventListener('click', () => document.getElementById('panel').classList.toggle('hidden'));
  document.getElementById('btnClosePanel').addEventListener('click', () => document.getElementById('panel').classList.add('hidden'));

  document.getElementById('toggleTitres').addEventListener('change', e => {
    if (e.target.checked) map.addLayer(titresLayerGroup); else map.removeLayer(titresLayerGroup);
  });
  document.getElementById('toggleBornes').addEventListener('change', e => {
    if (e.target.checked) { map.addLayer(bornesLayerGroup); onMapMoved(); } else map.removeLayer(bornesLayerGroup);
  });
  document.getElementById('toggleCrosshair').addEventListener('change', e => {
    document.getElementById('crosshairWrap').classList.toggle('hidden', !e.target.checked);
    if (e.target.checked) updateCrosshairReadout();
  });

  document.querySelectorAll('input[name="basemap"]').forEach(r => {
    r.addEventListener('change', e => {
      if (e.target.value === 'sat') { map.removeLayer(osmLayer); satLayer.addTo(map); }
      else { map.removeLayer(satLayer); osmLayer.addTo(map); }
    });
  });

  document.getElementById('btnSearch').addEventListener('click', () => runSearch(document.getElementById('searchInput').value));
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(e.target.value); });
  document.getElementById('searchInput').addEventListener('input', e => {
    if (e.target.value.trim() === '') document.getElementById('searchResults').classList.add('hidden');
  });

  document.getElementById('btnLocate').addEventListener('click', toggleGps);
  document.getElementById('btnOverview').addEventListener('click', fitToFullBounds);
  document.getElementById('btnMeasure').addEventListener('click', toggleMeasure);
  document.getElementById('btnTarget').addEventListener('click', lockTarget);
  document.getElementById('btnClearTarget').addEventListener('click', clearTarget);
  document.getElementById('btnCloseInfo').addEventListener('click', closeInfoSheet);
  document.getElementById('infoSheet').querySelector('.sheet-handle').addEventListener('click', closeInfoSheet);

  map.on('click', e => { if (measureActive) handleMapClickForMeasure(e.latlng); });
}

function showToast(show, text) {
  const el = document.getElementById('loadingToast');
  el.textContent = text || 'Chargement des parcelles…';
  el.classList.toggle('hidden', !show);
}

function showDataError() {
  const el = document.getElementById('dataError');
  const isFileProtocol = location.protocol === 'file:';
  el.innerHTML = isFileProtocol
    ? '⚠️ Les données (tiles_index.json…) ne se chargent pas. Vous avez probablement ouvert ce fichier en double-cliquant dessus. Ouvrez ce dossier avec l\u2019extension "Live Server" dans VS Code, ou déposez-le sur Vercel/Netlify/GitHub Pages.'
    : '⚠️ Impossible de charger les données des titres (tiles_index.json). Vérifiez que tout le dossier a bien été déposé au même endroit que index.html.';
  el.classList.remove('hidden');
}

function updateStatusInfo() {
  const el = document.getElementById('statusInfo');
  if (!el) return;
  const z = map.getZoom();
  if (z < TITRES_MIN_ZOOM) {
    el.textContent = `Zoom ${z} — zoomez (≥ ${TITRES_MIN_ZOOM}) pour afficher les titres et bornes.`;
  } else {
    el.textContent = `Zoom ${z} — ${loadedTitreTiles.size} tuile(s) de titres, ${loadedBornesTiles.size} tuile(s) de bornes chargées.`;
  }
}
