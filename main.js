import { hasCache, loadFiles, saveFiles, clearFiles } from './db.js';
import { scanDrive } from './scanner.js';
import { TreemapRenderer, formatBytes, colorCategoryFor } from './treemap.js';
import { CLIENT_ID as CFG_CLIENT_ID } from './config.js';

// === CONFIG ===
// CLIENT_ID is loaded from config.js (gitignored). Copy config.example.js to
// config.js and paste your Google OAuth client ID there.
const CLIENT_ID = (CFG_CLIENT_ID || '').trim();
// drive.metadata.readonly — metadata only (name, size, parents, mime). We
// never fetch file contents. drive.file wouldn't work here: that scope only
// exposes files the app itself created/opened, not the user's existing Drive.
const SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
// Derived capability flag — true only when the scope grants write access.
// Controls visibility of Move to Trash. To enable write ops, switch SCOPE
// to 'https://www.googleapis.com/auth/drive' (also restricted) and this
// flag will flip automatically.
const CAN_WRITE = SCOPE.endsWith('/auth/drive') || SCOPE.endsWith('/drive.file');
const DIVIDER_STORAGE_KEY = 'ds_list_pane_height_pct';
const LEFT_PANE_WIDTH_KEY = 'ds_left_pane_width_pct';
const LIST_DETAIL_SPLIT_KEY = 'ds_list_detail_split_pct';
const LAYOUT_KEY = 'ds_layout';
const TREEMAP_VISIBLE_KEY = 'ds_treemap_visible';

// === DOM refs ===
const $ = id => document.getElementById(id);
const els = {
  signin: $('google-signin'),
  signout: $('signout'),
  main: $('main'),
  btnScan: $('btn-scan'),
  btnExport: $('btn-export'),
  search: $('search'),
  btnClearSearch: $('btn-clear-search'),
  btnToggleTreemap: $('btn-toggle-treemap'),
  btnToggleLayout: $('btn-toggle-layout'),
  btnLayoutLabel: $('btn-layout-label'),
  progressArea: $('progress-area'),
  progressBar: $('progress-bar'),
  status: $('status'),
  statsBar: $('stats-bar'),
  statFiles: $('stat-files'),
  statFolders: $('stat-folders'),
  statSize: $('stat-size'),
  statTime: $('stat-time'),
  mainPane: $('main-pane'),
  viewList: $('view-list'),
  viewTreemap: $('view-treemap'),
  listBody: $('list-body'),
  paneDivider: $('pane-divider'),
  listDetailDivider: $('list-detail-divider'),
  infoCard: $('info-card'),
  infoCardTitle: $('info-card-title'),
  infoCardBody: $('info-card-body'),
  infoCardActions: $('info-card-actions'),
  btnOpenDrive: $('btn-open-drive'),
  btnDelete: $('btn-delete'),
  btnCloseDetails: $('btn-close-details'),
  mobileTabs: $('mobile-tabs'),
  canvas: $('treemap'),
  intro: $('intro'),
  btnTheme: $('btn-theme'),
  cookieNotice: $('cookie-notice'),
  cookieAccept: $('cookie-accept'),
};

// Hide write-only UI (Move to Trash) when the current OAuth scope can't perform
// writes. Flip SCOPE to /auth/drive to bring it back.
if (!CAN_WRITE && els.btnDelete) {
  els.btnDelete.style.display = 'none';
}

let accessToken = sessionStorage.getItem('ds_access_token');
let tokenClient = null;
let renderer = null;
let currentTree = null;
let selectedNode = null;
let searchQuery = '';
let sortState = { col: 'size', dir: 'desc' };
let treemapVisible = localStorage.getItem(TREEMAP_VISIBLE_KEY) !== '0';
// Layout override: null = auto (follow viewport), 'horizontal' | 'vertical' = forced
let layoutOverride = localStorage.getItem(LAYOUT_KEY) || null;
if (layoutOverride && !['horizontal', 'vertical'].includes(layoutOverride)) {
  layoutOverride = null;
}
// True while the synthetic marketing tree is on-screen. Used to show the demo
// strip and to reset stats cleanly when the user kicks off a real scan.
let inDemoMode = false;
// Tracks which folders are expanded in the list (by node id)
const expandedFolders = new Set();
// List-side navigation stack. Treemap stays static on the whole drive;
// this only drives the list pane.
let listPath = [];
const listCurrentNode = () => listPath[listPath.length - 1] || currentTree;

// === Toast ===
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// === Auth ===
let gisRetries = 0;
function initGIS() {
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    gisRetries++;
    if (gisRetries > 100) {
      setStatus('Google Sign-In failed to load. Check ad blockers.');
      return;
    }
    setTimeout(initGIS, 100);
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    prompt: '',
    callback: (resp) => {
      if (resp.error) {
        setStatus('Auth error: ' + resp.error);
        return;
      }
      accessToken = resp.access_token;
      sessionStorage.setItem('ds_access_token', accessToken);
      onSignedIn();
    },
  });

  if (!els.signin.querySelector('button')) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign in with Google';
    btn.onclick = () => { startAuthPoll(); tokenClient.requestAccessToken(); };
    els.signin.appendChild(btn);
  }

  if (accessToken) {
    startAuthPoll();
    fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    }).then(r => {
      if (r.ok) onSignedIn();
      else clearAuth();
    }).catch(() => clearAuth());
  }
}

function clearAuth() {
  sessionStorage.removeItem('ds_access_token');
  accessToken = null;
}

async function onSignedIn() {
  // Leaving demo mode: clear everything synthetic so the user isn't looking at
  // placeholder residue before their real data lands.
  const wasDemo = inDemoMode;
  inDemoMode = false;
  if (wasDemo) {
    currentTree = null;
    selectedNode = null;
    listPath = [];
    searchQuery = '';
    if (els.search) els.search.value = '';
    if (els.listBody) els.listBody.innerHTML = '';
    if (renderer) {
      renderer.tree = null;
      renderer.hoveredId = null;
      renderer.selectedId = null;
      renderer.leafById && renderer.leafById.clear && renderer.leafById.clear();
      renderer.folderById && renderer.folderById.clear && renderer.folderById.clear();
      const ctx = renderer.ctx;
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, renderer.canvas.width, renderer.canvas.height);
      }
      if (renderer.cache) {
        const cctx = renderer.cache.getContext && renderer.cache.getContext('2d');
        if (cctx) cctx.clearRect(0, 0, renderer.cache.width, renderer.cache.height);
      }
    }
    hideInfoCard();
    updateStats(null, 0, 0, 0);
  }
  els.signin.classList.add('hidden');
  els.signout.classList.remove('hidden');
  els.main.classList.remove('hidden');
  els.intro.classList.add('hidden');
  requestAnimationFrame(() => { if (renderer) renderer.resize(); });
  toast('Signed in successfully', 'success');

  // Auto-restore from IndexedDB so refreshing the page doesn't wipe the view.
  // Scan Drive re-indexes from Google when the user wants fresh data.
  if (await hasCache()) {
    await loadFromCache();
  } else {
    doScan();
  }
}

let authPollCount = 0;
function startAuthPoll() {
  // Try silent re-authentication instead of relying on localStorage or polling it.
  if (!accessToken && tokenClient) {
      tokenClient.requestAccessToken({ prompt: '' }); // Silent refresh
  }
}

async function onSignedOut() {
  clearAuth();
  await clearFiles();
  els.signin.classList.remove('hidden');
  els.signout.classList.add('hidden');
  currentTree = null;
  selectedNode = null;
  listPath = [];
  if (renderer) { renderer.tree = null; }
  hideInfoCard();
  // Fall back to demo mode instead of a blank intro card — users always see
  // something interactive.
  loadDemo();
}

// === UI helpers ===
function setStatus(msg) { els.status.textContent = msg; }
function updateProgress(pct) {
  els.progressArea.classList.remove('hidden');
  els.progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
}
function hideProgress() { els.progressArea.classList.add('hidden'); }

function updateStats(tree, fileCount, folderCount, timeSec) {
  els.statsBar.classList.remove('hidden');
  els.statFiles.textContent = `${(fileCount || 0).toLocaleString()} files`;
  els.statFolders.textContent = `${(folderCount || 0).toLocaleString()} folders`;
  els.statSize.textContent = formatBytes(tree?.size || 0);
  if (timeSec != null) els.statTime.textContent = `${timeSec.toFixed(1)}s`;
}

// === List (flat, sorted) ===
function sortChildren(children) {
  const dir = sortState.dir === 'asc' ? 1 : -1;
  return [...children].sort((a, b) => {
    switch (sortState.col) {
      case 'name': {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return dir * a.name.localeCompare(b.name);
      }
      case 'size': return dir * (a.size - b.size);
      case 'type': return dir * ((a.mimeType || '').localeCompare(b.mimeType || ''));
      case 'date': return dir * ((a.modifiedTime || '').localeCompare(b.modifiedTime || ''));
      default: return 0;
    }
  });
}

function renderList() {
  const parent = listCurrentNode();
  els.listBody.innerHTML = '';
  document.querySelectorAll('.list-header .sortable').forEach(el => {
    el.classList.remove('asc', 'desc');
    if (el.dataset.sort === sortState.col) el.classList.add(sortState.dir);
  });
  if (!parent || !parent.children?.length) {
    els.listBody.innerHTML = '<div class="list-row" style="justify-content:center;color:var(--fg-2);padding:24px">No items</div>';
    return;
  }

  const searchLower = searchQuery ? searchQuery.toLowerCase() : '';
  const MAX_ROWS = 2000;
  const frag = document.createDocumentFragment();
  const counter = { emitted: 0, skipped: 0 };

  // When searching, bypass the expand tree and flat-filter everything (descendants too)
  if (searchLower) {
    const flat = [];
    const walk = (node) => {
      for (const c of (node.children || [])) {
        if (c.name && c.name.toLowerCase().includes(searchLower)) flat.push({ node: c, depth: 0 });
        if (c.children?.length) walk(c);
      }
    };
    walk(parent);
    const sorted = sortChildren(flat.map(f => f.node));
    for (const node of sorted) {
      if (counter.emitted >= MAX_ROWS) { counter.skipped++; continue; }
      frag.appendChild(buildRow(node, 0, parent.size || 1, /*expandable*/ false));
      counter.emitted++;
    }
    if (counter.skipped) frag.appendChild(buildOverflowRow(counter.skipped));
    els.listBody.appendChild(frag);
    return;
  }

  // Normal tree view — show children of current folder, expanding folders marked in expandedFolders
  emitTreeChildren(parent, 0, parent.size || 1, frag, counter, MAX_ROWS);
  if (counter.skipped) frag.appendChild(buildOverflowRow(counter.skipped));
  els.listBody.appendChild(frag);
}

function emitTreeChildren(parent, depth, rootSize, frag, counter, MAX_ROWS) {
  const parentSize = parent.size || 1;
  const children = sortChildren(parent.children);
  for (const node of children) {
    if (counter.emitted >= MAX_ROWS) { counter.skipped++; continue; }
    const expandable = node.isFolder && node.children?.length > 0;
    frag.appendChild(buildRow(node, depth, parentSize, expandable));
    counter.emitted++;
    // Recurse if this folder is expanded
    if (expandable && expandedFolders.has(node.id)) {
      emitTreeChildren(node, depth + 1, rootSize, frag, counter, MAX_ROWS);
    }
  }
}

function buildRow(node, depth, parentSize, expandable) {
  const row = document.createElement('div');
  row.className = 'list-row' + (node.isFolder ? ' folder' : '') + (selectedNode?.id === node.id ? ' selected' : '');
  row.dataset.id = node.id;
  row.dataset.depth = depth;

  const color = node.isFolder ? 'var(--folder)' : colorForMime(node.mimeType, node.name);
  const pct = parentSize > 0 ? (node.size / parentSize) * 100 : 0;
  const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  const typeText = node.isFolder
    ? `Folder${node.children?.length ? ` (${node.children.length})` : ''}`
    : (shortType(node.mimeType, node.name) || 'File');

  const indentPx = depth * 14;
  const isExpanded = expandable && expandedFolders.has(node.id);
  const toggleHtml = expandable
    ? `<button class="tree-toggle" data-toggle="${escapeHtml(node.id)}" title="${isExpanded ? 'Collapse' : 'Expand'}">${isExpanded ? '−' : '+'}</button>`
    : `<span class="tree-toggle placeholder"></span>`;

  row.innerHTML = `
    <div class="col-name">
      <span class="tree-indent" style="width:${indentPx}px"></span>
      ${toggleHtml}
      <span class="name-dot" style="background:${color}"></span>
      <span class="name-text" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>
    </div>
    <div class="col-size">${formatBytes(node.size)}</div>
    <div class="col-pct">
      <span class="pct-bar"><span class="pct-fill" style="width:${Math.min(100, pct).toFixed(1)}%;background:${color}"></span></span>
      <span class="pct-num">${pctStr}%</span>
    </div>
    <div class="col-type">${escapeHtml(typeText)}</div>
    <div class="col-date">${formatDate(node.modifiedTime)}</div>
  `;
  return row;
}

function buildOverflowRow(skipped) {
  const more = document.createElement('div');
  more.className = 'list-row';
  more.style.cssText = 'justify-content:center;color:var(--fg-2);padding:12px;font-style:italic';
  more.textContent = `+${skipped.toLocaleString()} more — collapse folders or narrow your search`;
  return more;
}

function shortType(mime, name) {
  if (!mime) {
    const ext = name?.split('.').pop();
    return ext && ext.length <= 6 ? ext.toUpperCase() : '';
  }
  if (mime.startsWith('application/vnd.google-apps.')) return 'Google ' + mime.slice(29).replace(/^./, c => c.toUpperCase());
  if (mime.startsWith('application/')) return mime.slice(12).toUpperCase();
  if (mime.includes('/')) {
    const [cls, sub] = mime.split('/');
    return `${sub.toUpperCase()} ${cls}`.trim();
  }
  return mime;
}

// === Selection + floating info card ===
function selectNode(node) {
  selectedNode = node;
  renderer?.selectNode(node.id);
  showInfoCard(node);

  // If the node lives inside collapsed folders, expand every ancestor so
  // its row exists in the list DOM. Only re-render if we actually changed
  // expansion state — avoids a pointless reflow for top-level files.
  let needsRerender = false;
  const path = findPathToId(currentTree, node.id);
  if (path && path.length > 1) {
    // path = [root, ...ancestors, node]. Expand every ancestor folder
    // EXCEPT the root (root is always implicit) and the node itself.
    for (let i = 1; i < path.length - 1; i++) {
      const ancestor = path[i];
      if (ancestor.isFolder && !expandedFolders.has(ancestor.id)) {
        expandedFolders.add(ancestor.id);
        needsRerender = true;
      }
    }
  }
  if (needsRerender) renderList();

  // Update list selection highlight + scroll into view
  document.querySelectorAll('.list-row.selected').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`.list-row[data-id="${CSS.escape(node.id)}"]`);
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function showInfoCard(node) {
  if (!node) { hideInfoCard(); return; }
  const currSize = listCurrentNode()?.size;
  const pct = currSize ? ((node.size / currSize) * 100) : 0;
  const pctStr = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  const typeColor = node.isFolder ? 'var(--folder)' : colorForMime(node.mimeType, node.name);
  const typeName = node.isFolder ? 'Folder' : (shortType(node.mimeType, node.name) || 'File');
  const childCount = node.children?.length || 0;

  els.infoCardTitle.textContent = node.name || 'Details';
  els.infoCardTitle.title = node.name || '';

  let extraHtml = '';
  if (node.id === '___other___' && node._originals) {
    extraHtml = `<div class="detail-group"><div class="detail-label">Files (${node._originals.length})</div><div class="detail-value" style="max-height:140px;overflow-y:auto;font-size:0.74rem">` +
      node._originals.map(f => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid var(--bg-3)"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(f.name)}</span><span style="color:var(--accent);white-space:nowrap">${formatBytes(f.size)}</span></div>`).join('') +
      `</div></div>`;
  }

  const folderBadge = node.isFolder ? '<span class="folder-badge">Folder</span>' : '';

  els.infoCardBody.innerHTML = `
    <div class="detail-group">
      <div class="detail-label">Name</div>
      <div class="detail-value">${escapeHtml(node.name)}${folderBadge}</div>
    </div>
    <div class="detail-group">
      <div class="detail-label">Size</div>
      <div class="detail-value size">${formatBytes(node.size)}</div>
      ${currSize ? `<div class="detail-pct">${pctStr}% of current folder</div>` : ''}
    </div>
    <div class="detail-group">
      <div class="detail-label">Type</div>
      <div class="detail-value type"><span class="type-dot" style="background:${typeColor}"></span>${escapeHtml(typeName)}</div>
    </div>
    ${node.isFolder && node.id !== '___other___' ? `<div class="detail-group"><div class="detail-label">Contains</div><div class="detail-value">${childCount.toLocaleString()} items</div></div>` : ''}
    ${node.modifiedTime ? `<div class="detail-group"><div class="detail-label">Modified</div><div class="detail-value">${formatDate(node.modifiedTime)}</div></div>` : ''}
    ${node.id && node.id !== '___other___' && node.id !== 'root' ? `<div class="detail-group"><div class="detail-label">File ID</div><div class="detail-value detail-id">${escapeHtml(node.id)}</div></div>` : ''}
    ${extraHtml}
  `;

  const canAct = node && node.id && node.id !== '___other___' && node.id !== 'root' && !node.isFolder;
  els.infoCardActions.classList.toggle('hidden', !canAct);
  if (canAct) {
    els.btnOpenDrive.textContent = node.isFolder ? 'Open folder in Drive' : 'Open in Drive';
    els.btnDelete.textContent = node.isFolder ? 'Move folder to Trash' : 'Move to Trash';
  }
  // On mobile, pop the details sheet open
  if (isMobileView()) els.infoCard.classList.add('sheet-open');
}

function hideInfoCard() {
  els.infoCardTitle.textContent = 'Details';
  els.infoCardTitle.title = '';
  els.infoCardBody.innerHTML = '<div class="info-card-empty">Click a cell in the treemap or a row in the list to see details.</div>';
  els.infoCardActions.classList.add('hidden');
  els.infoCard.classList.remove('sheet-open');
  selectedNode = null;
  renderer?.selectNode(null);
  document.querySelectorAll('.list-row.selected').forEach(r => r.classList.remove('selected'));
}

// === Treemap pane toggle ===
function applyTreemapVisibility() {
  els.mainPane.classList.toggle('treemap-hidden', !treemapVisible);
  els.btnToggleTreemap.classList.toggle('active', treemapVisible);
  if (treemapVisible) {
    // when re-showing, need to recompute canvas size
    requestAnimationFrame(() => renderer?.resize());
  }
}

function setTreemapVisible(visible) {
  treemapVisible = visible;
  localStorage.setItem(TREEMAP_VISIBLE_KEY, visible ? '1' : '0');
  applyTreemapVisibility();
}

// === Layout toggle (horizontal / vertical) ===
function getAutoLayout() {
  if (isMobileView()) return 'mobile';
  return 'vertical';
}

function getEffectiveLayout() {
  if (isMobileView()) return 'mobile';
  if (layoutOverride) return layoutOverride;
  return getAutoLayout();
}

function applyLayout() {
  const layout = getEffectiveLayout();
  if (layout === 'horizontal') {
    els.mainPane.dataset.layout = 'horizontal';
    // CSS height:100%!important handles vertical leftover, but nuke it explicitly
    els.viewList.style.removeProperty('height');
  } else {
    delete els.mainPane.dataset.layout;
    // Clean up horizontal-mode inline width so list-main fills properly
    els.viewList.style.removeProperty('width');
  }
  updateLayoutButton();
}

function updateLayoutButton() {
  if (!els.btnToggleLayout || !els.btnLayoutLabel) return;
  const layout = getEffectiveLayout();
  if (layout === 'mobile') {
    els.btnToggleLayout.style.display = 'none';
  } else {
    els.btnToggleLayout.style.display = '';
    els.btnLayoutLabel.textContent = layout === 'horizontal' ? 'Horizontal' : 'Vertical';
    // Active = user has set a manual override (not auto)
    els.btnToggleLayout.classList.toggle('active', !!layoutOverride);
  }
}

function toggleLayout() {
  if (isMobileView()) return;
  if (layoutOverride) {
    // Override is set — clear it, go back to auto
    layoutOverride = null;
    localStorage.removeItem(LAYOUT_KEY);
  } else {
    // No override — set to opposite of what auto would give us
    layoutOverride = getAutoLayout() === 'horizontal' ? 'vertical' : 'horizontal';
    localStorage.setItem(LAYOUT_KEY, layoutOverride);
  }
  applyLayout();
  requestAnimationFrame(() => renderer?.resize());
}

// === Mobile layout ===
const MOBILE_BREAKPOINT = 720;
function isMobileView() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function setMobileView(target) {
  if (!['list', 'treemap'].includes(target)) return;
  els.mainPane.dataset.mobileView = target;
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mobileTarget === target);
  });
  if (target === 'treemap') {
    // Treemap was hidden — force it visible on mobile since the tab bar governs it
    if (!treemapVisible) setTreemapVisible(true);
    requestAnimationFrame(() => renderer?.resize());
  }
}

function initMobile() {
  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.addEventListener('click', () => setMobileView(btn.dataset.mobileTarget));
  });
  els.btnCloseDetails.addEventListener('click', () => {
    els.infoCard.classList.remove('sheet-open');
  });
  // Close the sheet when tapping outside it on mobile
  document.addEventListener('click', (e) => {
    if (!isMobileView()) return;
    if (!els.infoCard.classList.contains('sheet-open')) return;
    // Ignore clicks inside the sheet, on list rows, on treemap canvas (selectNode re-opens it)
    if (e.target.closest('#info-card')) return;
    if (e.target.closest('.list-row')) return;
    if (e.target.closest('#treemap')) return;
    if (e.target.closest('.mobile-tab')) return;
    els.infoCard.classList.remove('sheet-open');
  });

  const applyMobileMode = () => {
    const mobile = isMobileView();
    els.mobileTabs.classList.toggle('hidden', !mobile);
    if (!mobile) {
      // Reset mobile-only state so desktop isn't affected
      els.infoCard.classList.remove('sheet-open');
    } else {
      // Mobile mode: nuke all inline size styles — absolute positioning handles sizing
      els.viewList.style.removeProperty('height');
      els.viewList.style.removeProperty('width');
      els.infoCard.style.removeProperty('height');
      // Ensure a valid data-mobile-view attribute
      if (!els.mainPane.dataset.mobileView) els.mainPane.dataset.mobileView = 'list';
    }
    // Apply layout (data-layout attribute) BEFORE checking flexDirection
    applyLayout();
    // Clean up inline styles from the OTHER layout now that computed style is final
    if (!mobile) {
      const isRow = getComputedStyle(els.mainPane).flexDirection === 'row';
      if (!isRow) {
        // Desktop (vertical): nuke leftover laptop width
        els.viewList.style.removeProperty('width');
      }
    }
    requestAnimationFrame(() => renderer?.resize());
  };
  applyMobileMode();
  window.addEventListener('resize', applyMobileMode);
  window.addEventListener('orientationchange', applyMobileMode);
}

// === Draggable divider (pane-divider: top/bottom on desktop, left/right on laptop) ===
function initDivider() {
  // Restore persisted positions for both layouts
  const savedHeight = parseFloat(localStorage.getItem(DIVIDER_STORAGE_KEY));
  if (!Number.isNaN(savedHeight) && savedHeight > 10 && savedHeight < 90) {
    els.viewList.style.height = savedHeight + '%';
  }
  const savedWidth = parseFloat(localStorage.getItem(LEFT_PANE_WIDTH_KEY));
  if (!Number.isNaN(savedWidth) && savedWidth > 20 && savedWidth < 80) {
    els.viewList.style.width = savedWidth + '%';
  }

  let dragging = false;
  let startX = 0, startY = 0;
  let startSize = 0;
  let paneSize = 0;
  let isRowLayout = false; // true = laptop (left/right), false = desktop (top/bottom)

  const onDown = (e) => {
    dragging = true;
    isRowLayout = getComputedStyle(els.mainPane).flexDirection === 'row';
    startX = e.clientX;
    startY = e.clientY;
    if (isRowLayout) {
      startSize = els.viewList.getBoundingClientRect().width;
      paneSize = els.mainPane.getBoundingClientRect().width;
    } else {
      startSize = els.viewList.getBoundingClientRect().height;
      paneSize = els.mainPane.getBoundingClientRect().height;
    }
    els.paneDivider.classList.add('dragging');
    document.body.classList.add(isRowLayout ? 'dragging-col-divider' : 'dragging-divider');
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!dragging) return;
    if (isRowLayout) {
      const dx = e.clientX - startX;
      let newW = startSize + dx;
      const minW = 280;
      const maxW = paneSize - 200 - 6;
      newW = Math.max(minW, Math.min(maxW, newW));
      const pct = (newW / paneSize) * 100;
      els.viewList.style.width = pct + '%';
    } else {
      const dy = e.clientY - startY;
      let newH = startSize + dy;
      const minH = 80;
      const maxH = paneSize - 80 - 6;
      newH = Math.max(minH, Math.min(maxH, newH));
      const pct = (newH / paneSize) * 100;
      els.viewList.style.height = pct + '%';
    }
    renderer?.resize();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    els.paneDivider.classList.remove('dragging');
    document.body.classList.remove('dragging-divider', 'dragging-col-divider');
    if (isRowLayout) {
      const pct = (els.viewList.getBoundingClientRect().width / els.mainPane.getBoundingClientRect().width) * 100;
      localStorage.setItem(LEFT_PANE_WIDTH_KEY, pct.toFixed(1));
    } else {
      const pct = (els.viewList.getBoundingClientRect().height / els.mainPane.getBoundingClientRect().height) * 100;
      localStorage.setItem(DIVIDER_STORAGE_KEY, pct.toFixed(1));
    }
  };

  els.paneDivider.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // Touch
  els.paneDivider.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    onDown({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, preventDefault: () => e.preventDefault() });
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!dragging || e.touches.length !== 1) return;
    onMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
  }, { passive: true });
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', onUp);

  // Double-click to reset
  els.paneDivider.addEventListener('dblclick', () => {
    const isRow = getComputedStyle(els.mainPane).flexDirection === 'row';
    if (isRow) {
      els.viewList.style.width = '48%';
      localStorage.setItem(LEFT_PANE_WIDTH_KEY, '48');
    } else {
      els.viewList.style.height = '45%';
      localStorage.setItem(DIVIDER_STORAGE_KEY, '45');
    }
    renderer?.resize();
  });
}

// === Draggable divider between file list and details (laptop mode only) ===
function initListDetailDivider() {
  if (!els.listDetailDivider) return;

  const saved = parseFloat(localStorage.getItem(LIST_DETAIL_SPLIT_KEY));
  if (!Number.isNaN(saved) && saved > 15 && saved < 85) {
    els.infoCard.style.height = saved + '%';
  }

  let dragging = false;
  let startY = 0;
  let startDetailHeight = 0;
  let paneBodyHeight = 0;

  const onDown = (e) => {
    dragging = true;
    startY = e.clientY;
    startDetailHeight = els.infoCard.getBoundingClientRect().height;
    paneBodyHeight = els.listDetailDivider.parentElement.getBoundingClientRect().height;
    els.listDetailDivider.classList.add('dragging');
    document.body.classList.add('dragging-divider');
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!dragging) return;
    // Dragging up = details get taller; dragging down = details get shorter
    const dy = startY - e.clientY;
    let newH = startDetailHeight + dy;
    const minH = 100;
    const maxH = paneBodyHeight - 120 - 6; // reserve for file list
    newH = Math.max(minH, Math.min(maxH, newH));
    const pct = (newH / paneBodyHeight) * 100;
    els.infoCard.style.height = pct + '%';
    renderer?.resize();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    els.listDetailDivider.classList.remove('dragging');
    document.body.classList.remove('dragging-divider');
    const pct = (els.infoCard.getBoundingClientRect().height / els.listDetailDivider.parentElement.getBoundingClientRect().height) * 100;
    localStorage.setItem(LIST_DETAIL_SPLIT_KEY, pct.toFixed(1));
  };

  els.listDetailDivider.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // Touch
  els.listDetailDivider.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    onDown({ clientY: e.touches[0].clientY, preventDefault: () => e.preventDefault() });
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!dragging || e.touches.length !== 1) return;
    onMove({ clientY: e.touches[0].clientY });
  }, { passive: true });
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', onUp);

  // Double-click to reset
  els.listDetailDivider.addEventListener('dblclick', () => {
    els.infoCard.style.height = '30%';
    localStorage.setItem(LIST_DETAIL_SPLIT_KEY, '30');
    renderer?.resize();
  });
}

// === Scan ===
async function doScan() {
  if (!accessToken) { tokenClient.requestAccessToken(); return; }
  els.btnScan.disabled = true;
  els.btnExport.disabled = true;
  setStatus('Scanning Google Drive...');
  updateProgress(5);
  const t0 = performance.now();

  await clearFiles();
  const worker = new Worker('worker.js', { type: 'module' });

  worker.onmessage = (e) => {
    const data = e.data;
    if (data.type === 'progress') {
      setStatus(`Indexed ${data.count.toLocaleString()} items...`);
    }
    if (data.type === 'tree') {
      const dt = (performance.now() - t0) / 1000;
      setStatus(`Done in ${dt.toFixed(1)}s`);
      updateProgress(100);
      currentTree = data.tree;
      showTree(data.tree);
      updateStats(data.tree, data.fileCount, data.folderCount, dt);
      els.btnScan.disabled = false;
      els.btnExport.disabled = false;
      worker.terminate();
      setTimeout(hideProgress, 800);
    }
  };

  let totalFiles = 0;
  let totalFolders = 0;
  try {
    for await (const files of scanDrive(accessToken, (info) => {
      totalFiles = info.loaded;
      setStatus(`Fetched ${totalFiles.toLocaleString()} files...`);
    })) {
      const folders = files.filter(f => f.isFolder).length;
      totalFolders += folders;
      await saveFiles(files);
      worker.postMessage({ type: 'batch', files, rootName: 'My Drive' });
      updateProgress(Math.min(85, totalFiles / 500));
    }
    worker.postMessage({ type: 'finish', fileCount: totalFiles, folderCount: totalFolders });
    setStatus('Building tree...');
  } catch (err) {
    setStatus('Error: ' + err.message);
    els.btnScan.disabled = false;
    els.btnExport.disabled = false;
    worker.terminate();
  }
}

// Restore the last-scanned drive from IndexedDB. Runs automatically on sign-in
// and on page refresh — scanning is only needed when the user wants to
// re-index their actual Drive.
async function loadFromCache() {
  const files = await loadFiles();
  if (!files.length) return;
  setStatus('Loading cached drive...');
  updateProgress(20);

  // Count folder vs file locally — cached entries already carry isFolder, so
  // we don't need the scanner's running totals (which is what caused the
  // old "0 files / 0 folders" bug in doResume).
  let fileCount = 0, folderCount = 0;
  for (const f of files) {
    if (f.isFolder) folderCount++; else fileCount++;
  }

  const worker = new Worker('worker.js', { type: 'module' });
  const t0 = performance.now();
  worker.onmessage = (e) => {
    if (e.data.type === 'tree') {
      const dt = (performance.now() - t0) / 1000;
      setStatus('Loaded from cache');
      updateProgress(100);
      currentTree = e.data.tree;
      showTree(e.data.tree);
      updateStats(e.data.tree, fileCount, folderCount, dt);
      worker.terminate();
      setTimeout(hideProgress, 600);
    }
  };

  const CHUNK = 5000;
  for (let i = 0; i < files.length; i += CHUNK) {
    worker.postMessage({ type: 'batch', files: files.slice(i, i + CHUNK), rootName: 'My Drive' });
  }
  worker.postMessage({ type: 'finish', fileCount, folderCount });
}

function showTree(tree) {
  listPath = [tree];
  if (!renderer) {
    renderer = new TreemapRenderer(els.canvas);
    // Treemap is static (whole drive). Clicking a cell only selects the file;
    // it never navigates.
    renderer.onClick = (leaf) => {
      const node = findNodeById(currentTree, leaf.id);
      if (node) selectNode(node);
    };
    window.addEventListener('resize', () => renderer.resize());
  }
  renderer.setTree(tree);
  renderList();
}

// === Search ===
els.search.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  els.btnClearSearch.classList.toggle('hidden', !searchQuery);
  renderList();
});
els.btnClearSearch.addEventListener('click', () => {
  els.search.value = '';
  searchQuery = '';
  els.btnClearSearch.classList.add('hidden');
  renderList();
});

// === Treemap toggle ===
els.btnToggleTreemap.addEventListener('click', () => setTreemapVisible(!treemapVisible));
els.btnToggleLayout.addEventListener('click', toggleLayout);

// === Info card actions ===
els.btnOpenDrive.addEventListener('click', () => {
  if (!selectedNode?.id || selectedNode.id === '___other___') return;
  const url = selectedNode.isFolder
    ? `https://drive.google.com/drive/folders/${selectedNode.id}`
    : `https://drive.google.com/file/d/${selectedNode.id}/view`;
  window.open(url, '_blank');
});
els.btnDelete.addEventListener('click', async () => {
  if (!selectedNode?.id || selectedNode.id === '___other___' || selectedNode.id === 'root') {
    toast('Cannot delete this item.', 'error');
    return;
  }
  if (!confirm(`Move "${selectedNode.name}" to Google Drive trash?`)) return;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${selectedNode.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const name = selectedNode.name;
    removeNodeFromTree(currentTree, selectedNode.id);
    hideInfoCard();
    renderer.render();
    renderList();
    toast(`Moved "${name}" to trash`, 'success');
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
});

function removeNodeFromTree(node, id) {
  if (!node.children) return false;
  const idx = node.children.findIndex(c => c.id === id);
  if (idx >= 0) { node.children.splice(idx, 1); return true; }
  for (const child of node.children) {
    if (removeNodeFromTree(child, id)) return true;
  }
  return false;
}

// === Export ===
function doExport() {
  if (!currentTree) return;
  const blob = new Blob([JSON.stringify(currentTree, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `drivestat-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

// === Keyboard nav ===
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideInfoCard();
  if (e.key === 'Backspace' && !e.target.matches('input')) {
    e.preventDefault();
    goUpList();
  }
});

function goUpList() {
  if (listPath.length <= 1) return;
  listPath.pop();
  renderList();
  const here = listCurrentNode();
  if (here) { selectedNode = here; showInfoCard(here); }
  else hideInfoCard();
}

// === Top-level events ===
els.signout.addEventListener('click', () => {
  if (accessToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  onSignedOut();
});
els.btnScan.addEventListener('click', doScan);
els.btnExport.addEventListener('click', doExport);

// === Sort handlers ===
document.querySelectorAll('.list-header .sortable').forEach(el => {
  el.addEventListener('click', () => {
    const col = el.dataset.sort;
    if (sortState.col === col) {
      sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.col = col;
      sortState.dir = col === 'name' ? 'asc' : 'desc';
    }
    renderList();
  });
});

// === List row events ===
els.listBody.addEventListener('click', (e) => {
  // Expand/collapse toggle button
  const toggleBtn = e.target.closest('.tree-toggle');
  if (toggleBtn && !toggleBtn.classList.contains('placeholder')) {
    e.stopPropagation();
    const id = toggleBtn.dataset.toggle;
    if (id) {
      if (expandedFolders.has(id)) expandedFolders.delete(id);
      else expandedFolders.add(id);
      renderList();
    }
    return;
  }
  const row = e.target.closest('.list-row');
  if (!row || !row.dataset.id) return;
  const id = row.dataset.id;
  const node = findNodeById(currentTree, id);
  if (node) selectNode(node);
});
els.listBody.addEventListener('dblclick', (e) => {
  // Ignore double-click on the toggle button itself
  if (e.target.closest('.tree-toggle')) return;
  const row = e.target.closest('.list-row');
  if (!row || !row.dataset.id) return;
  const id = row.dataset.id;
  const node = findNodeById(currentTree, id);
  if (node && node.isFolder && node.children?.length) {
    // Drill into this folder — list only; treemap stays static on the full drive
    listPath.push(node);
    renderList();
    selectedNode = node;
    showInfoCard(node);
  }
});

function findNodeById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  if (!root.children) return null;
  // Recursive search — list now shows descendants via expand/collapse
  for (const c of root.children) {
    const found = findNodeById(c, id);
    if (found) return found;
  }
  return null;
}

// Return [root, ..., node] or null. Used by selectNode to auto-expand
// every ancestor folder so the target row exists in the list DOM before
// we call scrollIntoView on it.
function findPathToId(root, id) {
  if (!root) return null;
  if (root.id === id) return [root];
  if (!root.children) return null;
  for (const c of root.children) {
    const sub = findPathToId(c, id);
    if (sub) return [root, ...sub];
  }
  return null;
}

// === Helpers ===
function colorForMime(mimeType, name) {
  return colorCategoryFor({ mimeType, name, isFolder: mimeType?.includes('folder') });
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === Theme ===
const THEME_STORAGE_KEY = 'ds_theme';
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_STORAGE_KEY, t); } catch (e) {}
  // Notify treemap so it can recompute colors against the new bg
  if (renderer && typeof renderer.onThemeChange === 'function') {
    renderer.onThemeChange(t);
  }
}
function initTheme() {
  if (!els.btnTheme) return;
  els.btnTheme.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}

// === Cookie / storage notice ===
const COOKIE_ACK_KEY = 'ds_cookie_ack';
function initCookieNotice() {
  if (!els.cookieNotice || !els.cookieAccept) return;
  let acked = false;
  try { acked = localStorage.getItem(COOKIE_ACK_KEY) === '1'; } catch (e) {}
  if (acked) return;
  els.cookieNotice.classList.remove('hidden');
  els.cookieAccept.addEventListener('click', () => {
    try { localStorage.setItem(COOKIE_ACK_KEY, '1'); } catch (e) {}
    els.cookieNotice.classList.add('hidden');
  }, { once: true });
}

// === Init ===
applyTreemapVisibility();
applyLayout();
initDivider();
initListDetailDivider();
initMobile();
initTheme();
initCookieNotice();
initGIS();

// === Demo tree generator ====================================================
// Builds a synthetic ~1.3 TB drive with ~120k files across realistic folders.
// Used for: (a) the logged-out landing page, so visitors see what DriveStat
// does before signing in; (b) ?dev=1 for local UI work without auth.
// Deterministic — same seed, same tree, so screenshots are reproducible.
function buildDemoTree({ tiny = false } = {}) {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(0xC0FFEE);
  const rInt = (lo, hi) => Math.floor(lo + rand() * (hi - lo));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  let _id = 0;
  const nextId = () => 'demo' + (++_id).toString(36);

  const baseDate = new Date('2020-01-01').getTime();
  const spanMs = Date.now() - baseDate;
  const randDate = () => new Date(baseDate + Math.floor(rand() * spanMs)).toISOString();

  const mkFile = (name, size, mime) => ({
    id: nextId(), name, size, mimeType: mime, isFolder: false,
    modifiedTime: randDate(),
  });
  const mkFolder = (name, children) => ({
    id: nextId(), name,
    size: children.reduce((s, c) => s + c.size, 0),
    isFolder: true, children,
    mimeType: 'application/vnd.google-apps.folder',
    modifiedTime: randDate(),
  });

  // Lognormal-ish draw: u² bias toward lo so most files are small.
  const szLog = (lo, hi) => {
    const u = rand();
    return Math.floor(lo * Math.pow(hi / lo, u * u));
  };

  const movieTitles = [
    'Inception', 'Interstellar', 'Dune', 'Arrival', 'Blade_Runner_2049', 'The_Matrix',
    'Parasite', 'Whiplash', 'Oppenheimer', 'Tenet', 'Everything_Everywhere', 'Mad_Max_Fury_Road',
    'La_La_Land', 'Spirited_Away', 'Akira', 'Drive', 'Sicario', 'Her',
    'Ex_Machina', 'Annihilation', 'Prisoners', 'Nightcrawler', 'Uncut_Gems', 'The_Social_Network',
    'Gone_Girl', 'Zodiac', 'Fight_Club', 'Se7en', 'Heat', 'Collateral',
    'No_Country_for_Old_Men', 'There_Will_Be_Blood', 'The_Master', 'Phantom_Thread', 'Moonlight',
    'Birdman', 'The_Revenant', 'Gravity', 'Chernobyl', 'Severance',
  ];
  const tvShows = [
    'Breaking_Bad', 'Better_Call_Saul', 'The_Wire', 'The_Sopranos', 'Mr_Robot',
    'Succession', 'The_Bear', 'Fargo', 'True_Detective', 'Atlanta',
  ];
  const artists = [
    'Radiohead', 'Boards_of_Canada', 'Burial', 'Aphex_Twin', 'Kendrick_Lamar',
    'Tyler_the_Creator', 'Four_Tet', 'Jon_Hopkins', 'Nils_Frahm', 'Floating_Points',
    'Bonobo', 'Caribou', 'Thom_Yorke', 'FKA_twigs', 'James_Blake',
    'Oneohtrix_Point_Never', 'Flying_Lotus', 'Tame_Impala', 'Arctic_Monkeys', 'The_National',
  ];
  const albumWords = ['Kid', 'Amnesiac', 'OK', 'Rainbows', 'Pool', 'Moon', 'Night', 'Slow', 'Blue', 'Ghost', 'Echo', 'Light', 'Shadow', 'Drift'];
  const trackWords = ['Intro', 'Ascent', 'Horizon', 'Transit', 'Eclipse', 'Signal', 'Mirror', 'Static', 'Return', 'Waves', 'Dust', 'Bloom'];
  const projects = [
    'portfolio-site', 'drivestat', 'ml-playground', 'rust-raytracer', 'note-app',
    'shader-toy', 'wasm-experiments', 'go-microservice', 'next-dashboard', 'graphql-api',
  ];
  const workspaces = ['Invoices', 'Contracts', 'Reports', 'Briefs', 'Notes', 'Research', 'Drafts'];
  const resolutions = ['4K', '1080p', '2160p', 'HDR'];

  const children = [];

  // Movies (~320 GB)
  (() => {
    const items = [];
    const n = tiny ? 6 : 42;
    for (let i = 0; i < n; i++) {
      const title = movieTitles[i % movieTitles.length];
      const year = 2005 + (i * 7) % 20;
      const res = pick(resolutions);
      items.push(mkFile(`${title}.${year}.${res}.mkv`, szLog(4_000_000_000, 20_000_000_000), 'video/x-matroska'));
    }
    children.push(mkFolder('Movies', items));
  })();

  // TV Shows (~450 GB, deep hierarchy)
  (() => {
    const seriesFolders = [];
    const seriesCount = tiny ? 2 : tvShows.length;
    for (let s = 0; s < seriesCount; s++) {
      const seasonFolders = [];
      const seasons = tiny ? 1 : 3;
      for (let se = 1; se <= seasons; se++) {
        const eps = [];
        const epCount = tiny ? 5 : 10;
        for (let ep = 1; ep <= epCount; ep++) {
          const num = String(ep).padStart(2, '0');
          eps.push(mkFile(`${tvShows[s]}.S${String(se).padStart(2, '0')}E${num}.1080p.mkv`,
            szLog(1_200_000_000, 2_500_000_000), 'video/x-matroska'));
        }
        seasonFolders.push(mkFolder(`Season ${se}`, eps));
      }
      seriesFolders.push(mkFolder(tvShows[s], seasonFolders));
    }
    children.push(mkFolder('TV Shows', seriesFolders));
  })();

  // Raw Footage (~100 GB)
  (() => {
    const items = [];
    const n = tiny ? 10 : 60;
    for (let i = 0; i < n; i++) {
      const kind = pick(['interview', 'bRoll', 'drone', 'handheld', 'timelapse']);
      items.push(mkFile(`${kind}_${String(i).padStart(3, '0')}.mov`,
        szLog(800_000_000, 4_000_000_000), 'video/quicktime'));
    }
    children.push(mkFolder('Raw Footage', items));
  })();

  // Photos (~180 GB, tens of thousands of small files)
  (() => {
    const years = tiny ? [2024] : [2020, 2021, 2022, 2023, 2024, 2025];
    const yearFolders = [];
    for (const y of years) {
      const monthFolders = [];
      const months = tiny ? 3 : 12;
      for (let m = 1; m <= months; m++) {
        const monthName = new Date(y, m - 1, 1).toLocaleString('en', { month: 'long' });
        const eventFolders = [];
        const eventCount = tiny ? 2 : rInt(2, 5);
        for (let e = 0; e < eventCount; e++) {
          const eventName = pick(['Trip', 'Birthday', 'Wedding', 'Hike', 'Concert', 'Dinner', 'Beach', 'Workshop', 'Party', 'Family']);
          const photos = [];
          const photoCount = tiny ? 20 : rInt(80, 400);
          for (let p = 0; p < photoCount; p++) {
            const num = 1000 + p;
            const r = rand();
            if (r < 0.70) {
              photos.push(mkFile(`IMG_${num}.jpg`, szLog(1_500_000, 8_000_000), 'image/jpeg'));
            } else if (r < 0.95) {
              photos.push(mkFile(`IMG_${num}.cr2`, szLog(20_000_000, 45_000_000), 'image/x-canon-cr2'));
            } else {
              photos.push(mkFile(`VID_${num}.mp4`, szLog(80_000_000, 400_000_000), 'video/mp4'));
            }
          }
          eventFolders.push(mkFolder(`${String(m).padStart(2, '0')}-${e + 1} ${eventName}`, photos));
        }
        monthFolders.push(mkFolder(`${String(m).padStart(2, '0')} ${monthName}`, eventFolders));
      }
      yearFolders.push(mkFolder(String(y), monthFolders));
    }
    children.push(mkFolder('Photos', yearFolders));
  })();

  // Music (~60 GB)
  (() => {
    const artistFolders = [];
    const artistCount = tiny ? 3 : artists.length;
    for (let a = 0; a < artistCount; a++) {
      const albumFolders = [];
      const albumCount = tiny ? 1 : rInt(2, 6);
      for (let al = 0; al < albumCount; al++) {
        const tracks = [];
        const trackCount = tiny ? 5 : rInt(8, 16);
        for (let t = 0; t < trackCount; t++) {
          const num = String(t + 1).padStart(2, '0');
          const word = pick(trackWords);
          if (rand() < 0.45) {
            tracks.push(mkFile(`${num} ${word}.flac`, szLog(25_000_000, 70_000_000), 'audio/flac'));
          } else {
            tracks.push(mkFile(`${num} ${word}.mp3`, szLog(4_000_000, 12_000_000), 'audio/mpeg'));
          }
        }
        const albumName = `${pick(albumWords)} ${pick(albumWords)}`;
        albumFolders.push(mkFolder(albumName, tracks));
      }
      artistFolders.push(mkFolder(artists[a], albumFolders));
    }
    children.push(mkFolder('Music', artistFolders));
  })();

  // Backups (~200 GB)
  (() => {
    const items = [];
    const n = tiny ? 4 : 18;
    for (let i = 0; i < n; i++) {
      const kind = pick(['laptop_full', 'desktop_full', 'nas_snapshot', 'photos_archive', 'vm_disk']);
      const ext = pick(['tar.gz', 'zip', '7z', 'img']);
      items.push(mkFile(`${kind}_2024_${String(i).padStart(2, '0')}.${ext}`,
        szLog(4_000_000_000, 30_000_000_000),
        ext === 'zip' ? 'application/zip' : 'application/x-archive'));
    }
    children.push(mkFolder('Backups', items));
  })();

  // Documents (~8 GB)
  (() => {
    const folders = [];
    for (const ws of workspaces) {
      const items = [];
      const n = tiny ? 5 : rInt(30, 120);
      for (let i = 0; i < n; i++) {
        const r = rand();
        const name = `${ws.toLowerCase()}_${String(i).padStart(3, '0')}`;
        if (r < 0.4) {
          items.push(mkFile(`${name}.pdf`, szLog(200_000, 8_000_000), 'application/pdf'));
        } else if (r < 0.6) {
          items.push(mkFile(`${name}.docx`, szLog(30_000, 2_000_000),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
        } else if (r < 0.75) {
          items.push(mkFile(`${name}.xlsx`, szLog(40_000, 3_000_000),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
        } else if (r < 0.85) {
          items.push(mkFile(`${name}.pptx`, szLog(500_000, 15_000_000),
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
        } else {
          items.push(mkFile(`${name}.md`, szLog(1_000, 80_000), 'text/markdown'));
        }
      }
      folders.push(mkFolder(ws, items));
    }
    children.push(mkFolder('Documents', folders));
  })();

  // Downloads (~40 GB, mixed)
  (() => {
    const items = [];
    const n = tiny ? 12 : 180;
    for (let i = 0; i < n; i++) {
      const r = rand();
      if (r < 0.25) {
        items.push(mkFile(`installer_${i}.exe`, szLog(20_000_000, 500_000_000), 'application/x-msdownload'));
      } else if (r < 0.45) {
        items.push(mkFile(`setup_${i}.dmg`, szLog(50_000_000, 800_000_000), 'application/octet-stream'));
      } else if (r < 0.65) {
        items.push(mkFile(`screenshot_${i}.png`, szLog(300_000, 4_000_000), 'image/png'));
      } else if (r < 0.85) {
        items.push(mkFile(`archive_${i}.zip`, szLog(5_000_000, 300_000_000), 'application/zip'));
      } else {
        items.push(mkFile(`doc_${i}.pdf`, szLog(100_000, 10_000_000), 'application/pdf'));
      }
    }
    children.push(mkFolder('Downloads', items));
  })();

  // Code (~6 GB, the node_modules classic)
  (() => {
    const projectFolders = [];
    const projectCount = tiny ? 2 : projects.length;
    for (let p = 0; p < projectCount; p++) {
      const subfolders = [];
      const srcFiles = [];
      const srcN = tiny ? 10 : rInt(40, 160);
      for (let i = 0; i < srcN; i++) {
        const ext = pick(['js', 'ts', 'tsx', 'py', 'rs', 'go', 'css']);
        const mime = ext === 'py' ? 'text/x-python' : 'text/plain';
        srcFiles.push(mkFile(`module_${String(i).padStart(3, '0')}.${ext}`,
          szLog(500, 30_000), mime));
      }
      subfolders.push(mkFolder('src', srcFiles));
      if (!tiny) {
        const nmFolders = [];
        const pkgCount = rInt(30, 80);
        for (let pk = 0; pk < pkgCount; pk++) {
          const pkgFiles = [];
          const fileCount = rInt(8, 40);
          for (let f = 0; f < fileCount; f++) {
            pkgFiles.push(mkFile(`index_${f}.js`, szLog(200, 50_000), 'text/javascript'));
          }
          pkgFiles.push(mkFile('package.json', szLog(500, 4_000), 'application/json'));
          pkgFiles.push(mkFile('README.md', szLog(200, 20_000), 'text/markdown'));
          nmFolders.push(mkFolder(`pkg-${pk}`, pkgFiles));
        }
        subfolders.push(mkFolder('node_modules', nmFolders));
      }
      const assets = [];
      const assetN = tiny ? 3 : rInt(10, 40);
      for (let i = 0; i < assetN; i++) {
        assets.push(mkFile(`asset_${i}.png`, szLog(50_000, 2_000_000), 'image/png'));
      }
      subfolders.push(mkFolder('assets', assets));
      projectFolders.push(mkFolder(projects[p], subfolders));
    }
    children.push(mkFolder('Code', projectFolders));
  })();

  const tree = mkFolder('My Drive (demo)', children);
  tree.id = 'root';

  let fileCount = 0, folderCount = 0;
  (function walk(n) {
    if (n.isFolder) { folderCount++; (n.children || []).forEach(walk); }
    else fileCount++;
  })(tree);

  return { tree, fileCount, folderCount };
}

// Mount the demo tree in the main view. Safe to call on pageload (no auth) or
// after sign-out. Injects a subtle dismissable notice into the file list.
function loadDemo({ tiny = false } = {}) {
  const t0 = performance.now();
  const { tree, fileCount, folderCount } = buildDemoTree({ tiny });
  const dt = (performance.now() - t0) / 1000;
  inDemoMode = true;
  els.main.classList.remove('hidden');
  els.intro.classList.add('hidden');
  currentTree = tree;
  showTree(tree);
  updateStats(tree, fileCount, folderCount, dt);
  // Inject demo notice at the top of the file list
  injectDemoNotice();
  // Ensure the treemap sizes itself correctly after going visible.
  requestAnimationFrame(() => { if (renderer) renderer.resize(); });
  console.log(`[demo] ${fileCount.toLocaleString()} files, ${folderCount.toLocaleString()} folders, ${(tree.size / 1024 ** 4).toFixed(2)} TiB in ${dt.toFixed(2)}s`);
}

// Inject a subtle dismissable banner into list-body so the user knows
// they're looking at synthetic data. Dismissing it removes it for the session.
function injectDemoNotice() {
  if (!els.listBody) return;
  // Don't double-inject
  if (els.listBody.querySelector('.demo-notice')) return;
  const notice = document.createElement('div');
  notice.className = 'demo-notice';
  notice.innerHTML = `
    <span class="demo-notice-text"><strong>Synthetic demo data</strong> — sign in to scan your own Google Drive.</span>
    <button class="demo-notice-dismiss" title="Dismiss" aria-label="Dismiss demo notice">×</button>
  `;
  notice.querySelector('.demo-notice-dismiss').addEventListener('click', () => {
    notice.remove();
    requestAnimationFrame(() => renderer?.resize());
  });
  els.listBody.prepend(notice);
}

// === Dev harness & landing demo =============================================
// `?dev=1[&tiny=1]` forces demo mode even if a token is present (useful for
// screenshots). Otherwise, demo mode is the landing experience for logged-out
// visitors. Signed-in visitors go straight to the usual empty-pane-until-scan
// flow via initGIS → onSignedIn.
{
  const params = new URLSearchParams(location.search);
  const forceDev = params.get('dev') === '1';
  const tiny = params.get('tiny') === '1';

  if (forceDev) {
    loadDemo({ tiny });
  } else if (!accessToken) {
    loadDemo();
  }
}
