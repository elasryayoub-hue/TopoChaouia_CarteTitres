// =====================================================================
// TopoChaouia — Carte des Titres (visualisation terrain hors-bureau)
// =====================================================================

const TITRES_MIN_ZOOM = 13;     // en dessous de ce zoom, les titres ne sont pas affichés (trop de tuiles)
const TILE_BUFFER = 0.01;       // marge (degrés) autour de la vue pour précharger les tuiles voisines

let map, satLayer, osmLayer, titresLayerGroup, bornesLayer;
let tilesIndex = null;
let loadedTileKeys = new Set();
let searchIndex = null;
let searchIndexLoading = null;
let gpsWatchId = null;
let gpsMarker = null, gpsAccuracyCircle = null;
let highlightLayer = null;

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
init();

async function init() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    minZoom: 5,
    maxZoom: 20
  });
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
  bornesLayer = L.layerGroup().addTo(map);

  map.setView([32.9, -7.6], 12); // vue par défaut, ajustée après chargement de l'index

  wireUI();

  // Charger l'index des tuiles des titres
  try {
    const res = await fetch('tiles_index.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    tilesIndex = await res.json();
    fitToIndexBounds();
  } catch (e) {
    console.error('Erreur chargement tiles_index.json', e);
    showDataError();
  }

  // Charger les bornes (fichier unique, léger)
  loadBornes();

  map.on('moveend', onMapMoved);
  onMapMoved();
}

function fitToIndexBounds() {
  if (!tilesIndex) return;
  // On centre la vue sur le "noyau" des données (99% des parcelles) plutôt que
  // sur l'étendue brute : quelques titres isolés très éloignés feraient sinon
  // dézoomer la carte jusqu'à voir tout le Maroc, et les titres ne s'affichent
  // pas à un zoom aussi faible.
  const b = tilesIndex.core_bbox;
  if (b) {
    map.fitBounds([[b.minlat, b.minlon], [b.maxlat, b.maxlon]], { padding: [20, 20] });
  }
}

function fitToFullBounds() {
  if (!tilesIndex || !tilesIndex.full_bbox) return;
  const b = tilesIndex.full_bbox;
  map.fitBounds([[b.minlat, b.minlon], [b.maxlat, b.maxlon]], { padding: [20, 20] });
}

// ---------------------------------------------------------------------
// Chargement des tuiles de titres selon la vue courante
// ---------------------------------------------------------------------
function onMapMoved() {
  updateStatusInfo();

  if (!tilesIndex) return;
  const z = map.getZoom();

  const banner = document.getElementById('zoomBanner');
  if (z < TITRES_MIN_ZOOM) {
    banner.textContent = `Zoomez pour voir les titres (zoom ${z}/${TITRES_MIN_ZOOM})`;
    banner.classList.remove('hidden');
    return; // pas assez zoomé : on ne charge rien de plus (mais tuiles déjà chargées restent affichées)
  } else {
    banner.classList.add('hidden');
  }

  const b = map.getBounds();
  const minlon = b.getWest() - TILE_BUFFER;
  const maxlon = b.getEast() + TILE_BUFFER;
  const minlat = b.getSouth() - TILE_BUFFER;
  const maxlat = b.getNorth() + TILE_BUFFER;

  const toLoad = tilesIndex.tiles.filter(t => {
    const key = t.gx + '_' + t.gy;
    if (loadedTileKeys.has(key)) return false;
    if (t.count === 0) return false;
    return !(t.maxlon < minlon || t.minlon > maxlon || t.maxlat < minlat || t.minlat > maxlat);
  });

  if (toLoad.length === 0) return;

  showToast(true);
  Promise.all(toLoad.map(loadTitreTile)).finally(() => showToast(false));
}

async function loadTitreTile(tileMeta) {
  const key = tileMeta.gx + '_' + tileMeta.gy;
  if (loadedTileKeys.has(key)) return;
  loadedTileKeys.add(key); // marquer avant fetch pour éviter les doublons en cas d'appels concurrents
  try {
    const res = await fetch(tileMeta.file);
    const gj = await res.json();
    const layer = L.geoJSON(gj, {
      style: styleTitre,
      onEachFeature: (feature, lyr) => {
        lyr.on('click', () => showTitreInfo(feature.properties, lyr));
      }
    });
    layer.addTo(titresLayerGroup);
  } catch (e) {
    loadedTileKeys.delete(key); // permettre une nouvelle tentative plus tard
    console.error('Erreur chargement tuile', tileMeta.file, e);
  }
}

function styleTitre(feature) {
  const nature = (feature.properties.Nature || '').toUpperCase();
  let color = '#ffb020';
  if (nature === 'R') color = '#ff8a3d';
  else if (nature === 'T') color = '#35c7ff';
  return {
    color: color,
    weight: 2,
    opacity: 0.9,
    fillColor: color,
    fillOpacity: 0.12
  };
}

// ---------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------
async function loadBornes() {
  try {
    const res = await fetch('bornes_clean.geojson');
    const gj = await res.json();
    L.geoJSON(gj, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 4,
        color: '#0b3a36',
        weight: 1,
        fillColor: '#35e0d0',
        fillOpacity: 0.95
      }),
      onEachFeature: (feature, lyr) => {
        lyr.on('click', () => showBorneInfo(feature.properties));
      }
    }).addTo(bornesLayer);
  } catch (e) {
    console.error('Erreur chargement bornes', e);
  }
}

// ---------------------------------------------------------------------
// Info sheet (parcelle / borne)
// ---------------------------------------------------------------------
function showTitreInfo(props, layer) {
  const rows = [
    ['N° Titre', props.Num],
    ['Indice', props.indice],
    ['Complément', props.complement],
    ['Nature', props.Nature],
    ['Type', props.Type],
    ['Surface calculée (m²)', props.Surf_Calc],
    ['Surface adoptée (m²)', props.Surf_Adop],
    ['Feuille (Mappe)', props.Mappe],
    ['Stade', props.stade],
    ['Désignation', props.TIT],
  ].filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');

  document.getElementById('infoContent').innerHTML =
    `<h3>Titre N° ${props.Num ?? ''}</h3>` +
    rows.map(r => `<div class="info-row"><span>${r[0]}</span><span>${escapeHtml(String(r[1]))}</span></div>`).join('');
  document.getElementById('infoSheet').classList.remove('hidden');

  if (layer) {
    if (highlightLayer) map.removeLayer(highlightLayer);
    highlightLayer = L.geoJSON(layer.feature, { style: { color: '#ffffff', weight: 4, fillOpacity: 0.05 } }).addTo(map);
  }
}

function showBorneInfo(props) {
  const rows = [
    ['N° Borne', props.Num],
    ['Titre associé', props.Num_Titre],
    ['Nature titre', props.Nature_Titre],
    ['Indice', props.indice_Titre],
    ['Désignation', props.TIT],
  ].filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');

  document.getElementById('infoContent').innerHTML =
    `<h3>Borne ${props.Num ?? ''}</h3>` +
    rows.map(r => `<div class="info-row"><span>${r[0]}</span><span>${escapeHtml(String(r[1]))}</span></div>`).join('');
  document.getElementById('infoSheet').classList.remove('hidden');
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
    String(e.num).includes(q) ||
    (e.mappe || '').toLowerCase().includes(q) ||
    (e.tit || '').toLowerCase().includes(q)
  ).slice(0, 30);

  if (matches.length === 0) {
    resultsEl.innerHTML = '<div class="res-empty">Aucun titre trouvé</div>';
  } else {
    resultsEl.innerHTML = matches.map((m, i) =>
      `<div class="res-item" data-i="${i}"><b>Titre ${escapeHtml(String(m.num))}</b>` +
      `<div>${escapeHtml(m.mappe || '—')} ${m.indice ? '· indice ' + escapeHtml(m.indice) : ''} ${m.nature ? '· ' + escapeHtml(m.nature) : ''}</div></div>`
    ).join('');
    resultsEl.querySelectorAll('.res-item').forEach(el => {
      el.addEventListener('click', () => goToSearchResult(matches[parseInt(el.dataset.i)]));
    });
  }
  resultsEl.classList.remove('hidden');
}

async function goToSearchResult(m) {
  document.getElementById('searchResults').classList.add('hidden');
  document.getElementById('searchInput').blur();
  map.setView([m.lat, m.lon], 18);
  // s'assurer que la tuile est chargée puis afficher les infos
  const tileMeta = tilesIndex.tiles.find(t => t.file === m.file);
  if (tileMeta) await loadTitreTile(tileMeta);
  // retrouver le layer correspondant pour afficher l'info + surbrillance
  titresLayerGroup.eachLayer(sub => {
    if (sub.eachLayer) {
      sub.eachLayer(lyr => {
        if (lyr.feature && String(lyr.feature.properties.Num) === String(m.num) &&
            (lyr.feature.properties.Mappe || '') === (m.mappe || '')) {
          showTitreInfo(lyr.feature.properties, lyr);
        }
      });
    }
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
  if (!navigator.geolocation) {
    alert('La géolocalisation n\u2019est pas disponible sur cet appareil/navigateur.');
    return;
  }
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
  if (!gpsMarker) {
    gpsMarker = L.circleMarker(latlng, {
      radius: 8, color: '#ffffff', weight: 2, fillColor: '#4c8dff', fillOpacity: 1
    }).addTo(map);
    gpsAccuracyCircle = L.circle(latlng, { radius: accuracy, color: '#4c8dff', weight: 1, fillOpacity: 0.08 }).addTo(map);
  } else {
    gpsMarker.setLatLng(latlng);
    gpsAccuracyCircle.setLatLng(latlng);
    gpsAccuracyCircle.setRadius(accuracy);
  }
}

// ---------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------
function wireUI() {
  document.getElementById('btnMenu').addEventListener('click', () => {
    document.getElementById('panel').classList.toggle('hidden');
  });
  document.getElementById('btnClosePanel').addEventListener('click', () => {
    document.getElementById('panel').classList.add('hidden');
  });

  document.getElementById('toggleTitres').addEventListener('change', e => {
    if (e.target.checked) map.addLayer(titresLayerGroup); else map.removeLayer(titresLayerGroup);
  });
  document.getElementById('toggleBornes').addEventListener('change', e => {
    if (e.target.checked) map.addLayer(bornesLayer); else map.removeLayer(bornesLayer);
  });

  document.querySelectorAll('input[name="basemap"]').forEach(r => {
    r.addEventListener('change', e => {
      if (e.target.value === 'sat') { map.removeLayer(osmLayer); satLayer.addTo(map); }
      else { map.removeLayer(satLayer); osmLayer.addTo(map); }
    });
  });

  document.getElementById('btnSearch').addEventListener('click', () => runSearch(document.getElementById('searchInput').value));
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') runSearch(e.target.value);
  });
  document.getElementById('searchInput').addEventListener('input', e => {
    if (e.target.value.trim() === '') { document.getElementById('searchResults').classList.add('hidden'); }
  });

  document.getElementById('btnLocate').addEventListener('click', toggleGps);
  document.getElementById('btnOverview').addEventListener('click', fitToFullBounds);
  document.getElementById('zoomBanner').addEventListener('click', () => map.setZoom(TITRES_MIN_ZOOM));

  document.querySelector('.sheet-handle').parentElement.addEventListener('click', e => {
    if (e.target.classList.contains('sheet-handle')) {
      document.getElementById('infoSheet').classList.add('hidden');
      if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
    }
  });
}

function showToast(show, text) {
  const el = document.getElementById('loadingToast');
  if (text) el.textContent = text;
  else el.textContent = 'Chargement des parcelles…';
  el.classList.toggle('hidden', !show);
}

function showDataError() {
  const el = document.getElementById('dataError');
  const isFileProtocol = location.protocol === 'file:';
  el.innerHTML = isFileProtocol
    ? '⚠️ Les données (tiles_index.json…) ne se chargent pas. Vous avez probablement ouvert ce fichier en double-cliquant dessus. Les navigateurs bloquent ça par sécurité : ouvrez ce dossier avec l\u2019extension "Live Server" dans VS Code (clic droit sur index.html → "Open with Live Server"), ou déposez tout le dossier sur GitHub Pages.'
    : '⚠️ Impossible de charger les données des titres (tiles_index.json). Vérifiez que tout le dossier (tiles/, tiles_index.json, bornes_clean.geojson…) a bien été déposé au même endroit que index.html.';
}

function updateStatusInfo() {
  const el = document.getElementById('statusInfo');
  if (!el) return;
  const z = map.getZoom();
  if (z < TITRES_MIN_ZOOM) {
    el.textContent = `Zoom ${z} — zoomez (≥ ${TITRES_MIN_ZOOM}) pour afficher les titres fonciers.`;
  } else {
    el.textContent = `Zoom ${z} — ${loadedTileKeys.size} tuile(s) de titres chargée(s).`;
  }
}
