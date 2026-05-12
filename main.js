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
const TREEMAP_VISIBLE_KEY = 'ds_treemap_visible';

// === DOM refs ===
const $ = id => document.getElementById(id);
const els = {
  signin: $('google-signin'),
  signout: $('signout'),
  main: $('main'),
  btnScan: $('btn-scan'),
  btnResume: $('btn-resume'),
  btnExport: $('btn-export'),
  search: $('search'),
  btnClearSearch: $('btn-clear-search'),
  btnToggleTreemap: $('btn-toggle-treemap'),
  btnCloseTreemap: $('btn-close-treemap'),
  progressArea: $('progress-area'),
  progressBar: $('progress-bar'),
  status: $('status'),
  statsBar: $('stats-bar'),
  statFiles: $('stat-files'),
  statFolders: $('stat-folders'),
  statSize: $('stat-size'),
  statTime: $('stat-time'),
  breadcrumbs: $('breadcrumbs'),
  btnUp: $('btn-up'),
  crumbs: $('crumbs'),
  mainPane: $('main-pane'),
  viewList: $('view-list'),
  viewTreemap: $('view-treemap'),
  listBody: $('list-body'),
  paneDivider: $('pane-divider'),
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

let accessToken = localStorage.getItem('ds_access_token');
let tokenClient = null;
let renderer = null;
let currentTree = null;
let selectedNode = null;
let searchQuery = '';
let sortState = { col: 'size', dir: 'desc' };
let treemapVisible = localStorage.getItem(TREEMAP_VISIBLE_KEY) !== '0';
// Tracks which folders are expanded in the list (by node id)
const expandedFolders = new Set();
// List-side navigation stack. Treemap stays static on the whole drive;
// this only drives the list pane + breadcrumbs.
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
      localStorage.setItem('ds_access_token', accessToken);
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
  localStorage.removeItem('ds_access_token');
  accessToken = null;
}

function onSignedIn() {
  els.signin.classList.add('hidden');
  els.signout.classList.remove('hidden');
  els.main.classList.remove('hidden');
  els.intro.classList.add('hidden');
  requestAnimationFrame(() => { if (renderer) renderer.resize(); });
  checkCache();
  toast('Signed in successfully', 'success');
}

let pollInterval = null;
function startAuthPoll() {
  if (pollInterval) return;
  let checks = 0;
  pollInterval = setInterval(() => {
    checks++;
    const tok = localStorage.getItem('ds_access_token');
    if (tok && tok !== accessToken) {
      accessToken = tok;
      onSignedIn();
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (checks > 30) { clearInterval(pollInterval); pollInterval = null; }
  }, 500);
}

function onSignedOut() {
  clearAuth();
  els.signin.classList.remove('hidden');
  els.signout.classList.add('hidden');
  els.main.classList.add('hidden');
  els.intro.classList.remove('hidden');
  currentTree = null;
  selectedNode = null;
  listPath = [];
  if (renderer) { renderer.tree = null; }
  hideInfoCard();
}

function checkCache() {
  hasCache().then(ok => {
    els.btnResume.classList.toggle('hidden', !ok);
  });
}

// === UI helpers ===
function setStatus(msg) { els.status.textContent = msg; }
function updateProgress(pct) {
  els.progressArea.classList.remove('hidden');
  els.progressBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
}
function hideProgress() { els.progressArea.classList.add('hidden'); }

function updateBreadcrumbs() {
  if (!currentTree) return;
  els.crumbs.innerHTML = '';
  // Always show root as first crumb, then listPath
  const path = listPath.length ? listPath : [currentTree];
  // On mobile, hide the whole breadcrumbs row when we're at root — "My Drive" alone is noise.
  // When the user drills into a folder the row reappears so they can navigate up.
  if (isMobileView() && path.length <= 1) {
    els.breadcrumbs.classList.add('hidden');
  } else if (currentTree) {
    els.breadcrumbs.classList.remove('hidden');
  }
  path.forEach((node, idx) => {
    const span = document.createElement('span');
    span.className = 'crumb';
    span.textContent = node.name || 'My Drive';
    if (idx < path.length - 1) {
      span.onclick = () => {
        listPath = path.slice(0, idx + 1);
        updateBreadcrumbs();
        renderList();
        // After jumping up, show the folder we landed in as the context
        const here = listCurrentNode();
        if (here) { selectedNode = here; showInfoCard(here); }
        else hideInfoCard();
      };
    }
    els.crumbs.appendChild(span);
    if (idx < path.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'sep'; sep.textContent = '/';
      sep.style.pointerEvents = 'none';
      els.crumbs.appendChild(sep);
    }
  });
}

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
      // Ensure a valid data-mobile-view attribute
      if (!els.mainPane.dataset.mobileView) els.mainPane.dataset.mobileView = 'list';
    }
    // Re-evaluate breadcrumbs visibility (mobile hides when at root)
    if (currentTree) updateBreadcrumbs();
    requestAnimationFrame(() => renderer?.resize());
  };
  applyMobileMode();
  window.addEventListener('resize', applyMobileMode);
  window.addEventListener('orientationchange', applyMobileMode);
}

// === Draggable divider ===
function initDivider() {
  const saved = parseFloat(localStorage.getItem(DIVIDER_STORAGE_KEY));
  if (!Number.isNaN(saved) && saved > 10 && saved < 90) {
    els.viewList.style.height = saved + '%';
  }

  let dragging = false;
  let startY = 0;
  let startListHeight = 0;
  let paneHeight = 0;

  const onDown = (e) => {
    dragging = true;
    startY = e.clientY;
    startListHeight = els.viewList.getBoundingClientRect().height;
    paneHeight = els.mainPane.getBoundingClientRect().height;
    els.paneDivider.classList.add('dragging');
    document.body.classList.add('dragging-divider');
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    let newListHeight = startListHeight + dy;
    const minH = 80;
    const maxH = paneHeight - 80 - 6; // reserve 80px for treemap + 6 for divider
    newListHeight = Math.max(minH, Math.min(maxH, newListHeight));
    const pct = (newListHeight / paneHeight) * 100;
    els.viewList.style.height = pct + '%';
    renderer?.resize();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    els.paneDivider.classList.remove('dragging');
    document.body.classList.remove('dragging-divider');
    // Persist
    const pct = (els.viewList.getBoundingClientRect().height / els.mainPane.getBoundingClientRect().height) * 100;
    localStorage.setItem(DIVIDER_STORAGE_KEY, pct.toFixed(1));
  };

  els.paneDivider.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  // Touch
  els.paneDivider.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    onDown({ clientY: e.touches[0].clientY, preventDefault: () => e.preventDefault() });
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!dragging || e.touches.length !== 1) return;
    onMove({ clientY: e.touches[0].clientY });
  }, { passive: true });
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', onUp);

  // Double-click to reset to 45/55
  els.paneDivider.addEventListener('dblclick', () => {
    els.viewList.style.height = '45%';
    localStorage.setItem(DIVIDER_STORAGE_KEY, '45');
    renderer?.resize();
  });
}

// === Scan ===
async function doScan() {
  if (!accessToken) { tokenClient.requestAccessToken(); return; }
  els.btnScan.disabled = true;
  els.btnResume.disabled = true;
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
      els.btnResume.disabled = false;
      els.btnExport.disabled = false;
      checkCache();
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
    els.btnResume.disabled = false;
    els.btnExport.disabled = false;
    worker.terminate();
  }
}

async function doResume() {
  const files = await loadFiles();
  if (!files.length) { setStatus('No cached data'); return; }
  setStatus('Loading cache...');
  updateProgress(30);

  const worker = new Worker('worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.type === 'tree') {
      setStatus('Loaded from cache');
      updateProgress(100);
      currentTree = e.data.tree;
      showTree(e.data.tree);
      updateStats(e.data.tree, e.data.fileCount, e.data.folderCount, null);
      hideProgress();
      worker.terminate();
    }
  };
  const chunk = 5000;
  for (let i = 0; i < files.length; i += chunk) {
    worker.postMessage({ type: 'batch', files: files.slice(i, i + chunk), rootName: 'My Drive' });
  }
  worker.postMessage({ type: 'finish' });
}

function showTree(tree) {
  els.breadcrumbs.classList.remove('hidden');
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
  updateBreadcrumbs();
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
els.btnCloseTreemap.addEventListener('click', () => setTreemapVisible(false));

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
  updateBreadcrumbs();
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
els.btnResume.addEventListener('click', doResume);
els.btnExport.addEventListener('click', doExport);
els.btnUp.addEventListener('click', () => goUpList());

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
    updateBreadcrumbs();
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
initDivider();
initMobile();
initTheme();
initCookieNotice();
initGIS();

// === Dev harness: ?dev=1 injects a synthetic tree and skips auth ===
if (new URLSearchParams(location.search).get('dev') === '1') {
  const mkFile = (id, name, size, mime = 'application/octet-stream') => ({
    id, name, size, mimeType: mime, isFolder: false,
    modifiedTime: '2025-01-15T10:00:00Z',
  });
  const mkFolder = (id, name, children) => {
    const size = children.reduce((s, c) => s + c.size, 0);
    return {
      id, name, size, isFolder: true, children,
      mimeType: 'application/vnd.google-apps.folder',
      modifiedTime: '2025-01-10T10:00:00Z',
    };
  };
  const files = [];
  const types = [
    ['image/jpeg', 'photo', 2_000_000, 10_000_000],
    ['video/mp4', 'clip', 50_000_000, 200_000_000],
    ['application/pdf', 'doc', 500_000, 3_000_000],
    ['audio/mpeg', 'song', 3_000_000, 8_000_000],
    ['text/plain', 'note', 1000, 50_000],
    ['application/zip', 'backup', 10_000_000, 300_000_000],
  ];
  for (let i = 0; i < 60; i++) {
    const [mime, base, lo, hi] = types[i % types.length];
    const ext = mime.split('/')[1].split('+')[0];
    files.push(mkFile('f' + i, `${base}_${i}.${ext}`, Math.floor(lo + Math.random() * (hi - lo)), mime));
  }
  files.push(mkFolder('fol1', 'Projects', [
    mkFile('p1', 'readme.md', 12345, 'text/markdown'),
    mkFile('p2', 'archive.zip', 150_000_000, 'application/zip'),
    mkFile('p3', 'data.csv', 8_000_000, 'text/csv'),
  ]));
  files.push(mkFolder('fol2', 'Photos 2024', Array.from({ length: 15 }, (_, i) =>
    mkFile('ph' + i, `IMG_${1000 + i}.jpg`, 3_000_000 + Math.floor(Math.random() * 5_000_000), 'image/jpeg')
  )));
  const tree = mkFolder('root', 'My Drive', files);

  els.signin.classList.add('hidden');
  els.signout.classList.remove('hidden');
  els.main.classList.remove('hidden');
  els.intro.classList.add('hidden');
  currentTree = tree;
  showTree(tree);
  updateStats(tree, files.filter(f => !f.isFolder).length, files.filter(f => f.isFolder).length, 0);
}
