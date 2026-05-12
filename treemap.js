// WinDirStat-inspired palette: saturated but not neon, varied hues.
// Real WinDirStat auto-assigns extension -> color from a rotating palette;
// we seed the main categories and hash everything else so same-ext files share a color.
const COLORS = {
  image:   '#e14f9e', // pink/magenta  (classic WDS "media")
  video:   '#c84e4e', // brick red
  audio:   '#4fb3d9', // sky cyan
  doc:     '#4a7edb', // cornflower blue
  archive: '#e0b84c', // amber
  code:    '#8e6fd9', // violet
  pdf:     '#d97b3e', // orange
  sheet:   '#3ea66b', // green
  slide:   '#d9a84f', // mustard
  exe:     '#c24b52', // dark red
  other:   '#8b95a3', // slate-grey
};

// Stable per-extension color variation for the "other" bucket so same-ext files share a color
const extColorCache = new Map();
function colorForExt(ext) {
  if (!ext) return COLORS.other;
  if (extColorCache.has(ext)) return extColorCache.get(ext);
  // WinDirStat-style: each extension hashes to a stable, mid-saturation color from a wide palette
  let h = 0;
  for (let i = 0; i < ext.length; i++) h = (h * 31 + ext.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const sat = 45 + (h >> 8) % 20;  // 45-65 — saturated but not neon
  const light = 48 + (h >> 16) % 12; // 48-60 — mid brightness so bevels read
  const color = `hsl(${hue} ${sat}% ${light}%)`;
  extColorCache.set(ext, color);
  return color;
}

function extOf(name) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  if (i < 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

function colorForNode(node) {
  const m = node.mimeType || '';
  if (m.startsWith('image/')) return COLORS.image;
  if (m.startsWith('video/')) return COLORS.video;
  if (m.startsWith('audio/')) return COLORS.audio;
  if (m.includes('pdf')) return COLORS.pdf;
  if (m.includes('zip') || m.includes('compressed') || m.includes('archive') ||
      m.includes('tar') || m.includes('gzip') || m.includes('7z') || m.includes('rar')) return COLORS.archive;
  if (m.includes('spreadsheet') || m === 'application/vnd.google-apps.spreadsheet') return COLORS.sheet;
  if (m.includes('presentation') || m === 'application/vnd.google-apps.presentation') return COLORS.slide;
  if (m.includes('msword') || m.includes('wordprocessing') || m === 'application/vnd.google-apps.document') return COLORS.doc;
  const ext = extOf(node.name);
  if (['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','hpp','cs','php','sh','css','html','json','xml','yaml','yml','toml','md'].includes(ext)) return COLORS.code;
  if (['exe','msi','dmg','apk','deb','rpm','appimage'].includes(ext)) return COLORS.exe;
  if (m.startsWith('text/') || m.includes('document')) return COLORS.doc;
  return colorForExt(ext || m.split('/')[1] || 'other');
}

export function colorCategoryFor(node) {
  // exposed for main.js list view
  return colorForNode(node);
}

export function formatBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B','KB','MB','GB','TB','PB'];
  const i = Math.min(Math.floor(Math.log10(Math.abs(b))/3), u.length-1);
  return (b / 10**(i*3)).toFixed(i === 0 ? 0 : 2) + ' ' + u[i];
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Squarify treemap (one level). Items carry their node reference via .node
function squarify(items, x, y, w, h) {
  const n = items.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ node: items[0].node, size: items[0].size, x, y, w: Math.max(1, w), h: Math.max(1, h) }];
  }
  const total = items.reduce((s, it) => s + it.size, 0);
  if (total === 0) {
    return items.map((it) => ({ node: it.node, size: it.size, x, y, w: 1, h: 1 }));
  }
  const vertical = w >= h;
  const primary = vertical ? w : h;
  const secondary = vertical ? h : w;
  const rects = [];
  let remaining = items;
  let px = x, py = y;

  while (remaining.length > 0) {
    // Greedy row: keep adding items while aspect improves
    let row = [remaining[0]];
    let rowSum = remaining[0].size;
    let bestWorst = worstAspect(row, rowSum, secondary, primary, total);
    let i = 1;
    for (; i < remaining.length; i++) {
      const candidate = row.concat(remaining[i]);
      const candSum = rowSum + remaining[i].size;
      const aspect = worstAspect(candidate, candSum, secondary, primary, total);
      if (aspect > bestWorst) break;
      row = candidate;
      rowSum = candSum;
      bestWorst = aspect;
    }
    // Lay out the row
    const rowLen = (rowSum / total) * primary;
    let sub = 0;
    for (const it of row) {
      const secLen = rowSum ? (it.size / rowSum) * secondary : secondary / row.length;
      if (vertical) {
        rects.push({ node: it.node, size: it.size, x: px, y: py + sub, w: Math.max(1, rowLen), h: Math.max(1, secLen) });
      } else {
        rects.push({ node: it.node, size: it.size, x: px + sub, y: py, w: Math.max(1, secLen), h: Math.max(1, rowLen) });
      }
      sub += secLen;
    }
    if (vertical) px += rowLen; else py += rowLen;
    remaining = remaining.slice(row.length);
  }
  return rects;
}

function worstAspect(row, rowSum, secondary, primary, total) {
  if (rowSum === 0) return Infinity;
  const rowLen = (rowSum / total) * primary;
  let worst = 0;
  for (const it of row) {
    const secLen = (it.size / rowSum) * secondary;
    const a = Math.max(rowLen / secLen, secLen / rowLen);
    if (a > worst) worst = a;
  }
  return worst;
}

export class TreemapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.tree = null;
    this.leaves = [];         // flat list of FILE rects only (post recursive layout)
    this.leafById = new Map(); // id -> leaf rect, for fast lookup
    this.parentMap = new Map(); // id -> parent node (for tooltip "In:" label)
    this.grid = null;         // spatial hit-test grid
    this.gridW = 0; this.gridH = 0;
    this.gridCellW = 1; this.gridCellH = 1;
    this.selectedId = null;
    this.hoveredId = null;
    this.onHover = null;
    this.onClick = null;      // fired with (leaf) on file click — no zoom, just select
    this.onContextMenu = null;
    this.MIN_DRAW = 1.5;      // skip rects smaller than this (px)
    // Offscreen cache: full scene drawn once per layout, blitted every hover
    this.cache = document.createElement('canvas');
    this.cacheCtx = this.cache.getContext('2d', { alpha: false });
    this.cacheDirty = true;
    this._bindEvents();
  }

  // Read the legend background color from the CSS variable so the treemap's
  // fill matches the app theme without a hard-coded hex.
  _bgColor() {
    try {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg-1').trim();
      return v || '#161b22';
    } catch (e) {
      return '#161b22';
    }
  }

  // Called by main.js when the user toggles theme — forces a full redraw
  // so the background + bevel/shadow tints re-read CSS vars.
  onThemeChange() {
    this.cacheDirty = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.draw());
    } else {
      this.draw();
    }
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    // Bail out if pane is hidden / not laid out yet — resize will be called again
    if (rect.width < 1 || rect.height < 1) return;
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Offscreen cache matches backing store size
    this.cache.width = this.canvas.width;
    this.cache.height = this.canvas.height;
    this.cacheCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cacheDirty = true;
    this._layout();
    this._render();
  }

  setTree(tree) {
    this.tree = tree;
    this._buildParentMap(tree);
    this.resize();
  }

  _buildParentMap(root) {
    this.parentMap.clear();
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (!n?.children) continue;
      for (const c of n.children) {
        this.parentMap.set(c.id, n);
        if (c.children?.length) stack.push(c);
      }
    }
  }

  // Full-tree recursive layout. Every file in the drive becomes a leaf rect,
  // clustered inside its folder's region so siblings sit side-by-side
  // (classic WinDirStat behaviour). Folders themselves are never drawn.
  _layout() {
    this.leaves = [];
    this.leafById.clear();
    this.cacheDirty = true;
    if (!this.tree) return;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    if (W < 1 || H < 1) return;
    this._layoutNode(this.tree, 0, 0, W, H);
    // Populate lookup map in one pass
    for (let i = 0; i < this.leaves.length; i++) {
      this.leafById.set(this.leaves[i].id, this.leaves[i]);
    }
    this._buildGrid(W, H);
  }

  _layoutNode(node, x, y, w, h) {
    // Prune anything too small to be visible — saves massive work on deep dirs
    if (w < this.MIN_DRAW || h < this.MIN_DRAW) return;
    if (!node) return;

    // File leaf: record the rect and stop
    if (!node.isFolder) {
      if (!node.size || node.size <= 0) return;
      this.leaves.push({
        id: node.id,
        name: node.name,
        size: node.size,
        mimeType: node.mimeType,
        modifiedTime: node.modifiedTime,
        x, y, w, h,
        color: colorForNode(node),
      });
      return;
    }

    // Folder: squarify its children into this rect, recurse into each
    const kids = node.children;
    if (!kids || !kids.length) return;
    const items = [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.size > 0) items.push({ node: c, size: c.size });
    }
    if (!items.length) return;
    items.sort((a, b) => b.size - a.size);
    const rects = squarify(items, x, y, w, h);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      this._layoutNode(r.node, r.x, r.y, r.w, r.h);
    }
  }

  _buildGrid(W, H) {
    // Choose grid size based on leaf count: ~sqrt(n) cells, capped for memory
    const n = this.leaves.length;
    const cells = Math.max(16, Math.min(256, Math.ceil(Math.sqrt(n))));
    this.gridW = cells; this.gridH = cells;
    this.gridCellW = W / cells;
    this.gridCellH = H / cells;
    const grid = new Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = null;
    const cw = this.gridCellW, ch = this.gridCellH;
    for (let i = 0; i < n; i++) {
      const r = this.leaves[i];
      const gx0 = Math.max(0, Math.floor(r.x / cw));
      const gy0 = Math.max(0, Math.floor(r.y / ch));
      const gx1 = Math.min(cells - 1, Math.floor((r.x + r.w - 1) / cw));
      const gy1 = Math.min(cells - 1, Math.floor((r.y + r.h - 1) / ch));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const k = gy * cells + gx;
          if (!grid[k]) grid[k] = [];
          grid[k].push(i);
        }
      }
    }
    this.grid = grid;
  }

  _hitTest(x, y) {
    if (!this.grid) return null;
    const gx = Math.floor(x / this.gridCellW);
    const gy = Math.floor(y / this.gridCellH);
    if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return null;
    const bucket = this.grid[gy * this.gridW + gx];
    if (!bucket) return null;
    // Topmost = last inserted = deepest leaf at that point
    for (let i = bucket.length - 1; i >= 0; i--) {
      const r = this.leaves[bucket[i]];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }

  _bindEvents() {
    const tip = document.getElementById('tooltip');
    const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    // Shared tip-rendering logic. Re-uses the same DOM node; only rewrites innerHTML
    // when the hit id changes, so rapid pointer movement over the same cell is free.
    let lastTipId = null;
    const showTipAt = (x, y, rect, hit, touch) => {
      const tipW = 320, tipH = 110;
      let px, py;
      if (touch) {
        // Touch: position above finger so it's not covered by the hand.
        px = x - tipW / 2;
        py = y - tipH - 28;
        if (py < 4) py = y + 36; // not enough room above — put below finger
      } else {
        px = x + 18; py = y + 18;
        if (px + tipW > rect.width) px = x - tipW - 8;
        if (py + tipH > rect.height) py = y - tipH - 8;
      }
      if (px + tipW > rect.width) px = rect.width - tipW - 4;
      if (px < 4) px = 4;
      if (py < 4) py = 4;
      tip.style.left = px + 'px';
      tip.style.top = py + 'px';
      tip.style.display = 'block';
      if (lastTipId !== hit.id) {
        lastTipId = hit.id;
        const rootSize = this.tree?.size || 0;
        const pct = rootSize ? ((hit.size / rootSize) * 100).toFixed(2) : 0;
        const parent = this.parentMap.get(hit.id);
        tip.innerHTML = `
          <div class="tt-title">${escapeHtml(hit.name)}</div>
          <div class="tt-row"><span>Size</span><span class="tt-size">${formatBytes(hit.size)}</span></div>
          <div class="tt-row"><span>Share</span><span>${pct}%</span></div>
          <div class="tt-row"><span>Type</span><span>${hit.mimeType || 'File'}</span></div>
          ${parent ? `<div class="tt-row"><span>In</span><span>${escapeHtml(parent.name || '/')}</span></div>` : ''}
        `;
      }
    };
    const hideTip = () => {
      tip.style.display = 'none';
      lastTipId = null;
      if (this.hoveredId) { this.hoveredId = null; this._render(); }
    };

    // --- Mouse (desktop) ---
    let rafPending = false;
    let pendingEvent = null;

    this.canvas.addEventListener('mousemove', (e) => {
      pendingEvent = e;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const ev = pendingEvent;
        const rect = this.canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const hit = this._hitTest(x, y);
        if (hit) {
          if (this.hoveredId !== hit.id) {
            this.hoveredId = hit.id;
            this._render();
          }
          this.canvas.style.cursor = 'pointer';
          showTipAt(x, y, rect, hit, false);
          if (this.onHover) this.onHover(hit);
        } else {
          if (this.hoveredId) {
            this.hoveredId = null;
            this._render();
          }
          tip.style.display = 'none';
          lastTipId = null;
          this.canvas.style.cursor = 'crosshair';
        }
      });
    });

    this.canvas.addEventListener('mouseleave', hideTip);

    // --- Touch (mobile): press-and-hold to peek. Release to dismiss. ---
    // No click→select on touch — the tooltip IS the interaction, matching user intent.
    let touchActive = false;
    let touchRect = null;
    let touchRaf = false;
    let touchPending = null;

    const processTouch = () => {
      touchRaf = false;
      if (!touchPending || !touchActive) return;
      const t = touchPending;
      const x = t.clientX - touchRect.left;
      const y = t.clientY - touchRect.top;
      const hit = this._hitTest(x, y);
      if (hit) {
        if (this.hoveredId !== hit.id) {
          this.hoveredId = hit.id;
          this._render();
        }
        showTipAt(x, y, touchRect, hit, true);
      } else {
        tip.style.display = 'none';
        lastTipId = null;
        if (this.hoveredId) { this.hoveredId = null; this._render(); }
      }
    };

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchActive = true;
      touchRect = this.canvas.getBoundingClientRect();
      touchPending = e.touches[0];
      e.preventDefault(); // stops scroll + suppresses synthetic click/contextmenu
      if (!touchRaf) { touchRaf = true; requestAnimationFrame(processTouch); }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!touchActive || e.touches.length !== 1) return;
      touchPending = e.touches[0];
      e.preventDefault();
      if (!touchRaf) { touchRaf = true; requestAnimationFrame(processTouch); }
    }, { passive: false });

    const endTouch = () => {
      if (!touchActive) return;
      touchActive = false;
      touchPending = null;
      hideTip();
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);

    this.canvas.addEventListener('click', (e) => {
      // On coarse-pointer devices we handle interaction via touch handlers only.
      // Click still fires from touch in some edge cases; ignore it there.
      if (isCoarse) return;
      const rect = this.canvas.getBoundingClientRect();
      const hit = this._hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) return;
      // Files only, no drill. Just select.
      this.selectNode(hit.id);
      if (this.onClick) this.onClick(hit);
    });

    this.canvas.addEventListener('dblclick', (e) => {
      // No-op. Prevent text selection.
      e.preventDefault();
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const hit = this._hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && this.onContextMenu) this.onContextMenu(hit, e);
    });
  }

  selectNode(id) {
    this.selectedId = id;
    this._render();
  }

  // Public: re-layout + redraw (use after external tree mutation, e.g. delete)
  render() {
    this._layout();
    this._render();
  }

  // Render: expensive scene baked to offscreen cache, overlays drawn on top
  _render() {
    const ctx = this.ctx;

    // Safety: if canvas hasn't been sized yet (pane hidden), bail
    if (this.canvas.width < 1 || this.canvas.height < 1) return;
    if (this.cache.width < 1 || this.cache.height < 1) return;

    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;

    if (this.cacheDirty) {
      this._renderCache(W, H);
      this.cacheDirty = false;
    }

    // Blit the baked scene — fast, no DOM reflow
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.cache, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Hover + selection overlays (cheap)
    if (this.hoveredId && this.hoveredId !== this.selectedId) {
      const r = this.leafById.get(this.hoveredId);
      if (r && r.w >= 2 && r.h >= 2) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
    }
    if (this.selectedId) {
      const r = this.leafById.get(this.selectedId);
      if (r && r.w >= 2 && r.h >= 2) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
    }
  }

  _renderCache(W, H) {
    const ctx = this.cacheCtx;
    ctx.fillStyle = this._bgColor();
    ctx.fillRect(0, 0, W, H);
    if (!this.leaves.length) return;

    // Batch fill by color — big speedup with thousands of files.
    // Visible leaves only; we already pruned at layout but double-check draw size.
    const batches = new Map(); // color -> indices
    for (let i = 0; i < this.leaves.length; i++) {
      const r = this.leaves[i];
      if (r.w < this.MIN_DRAW || r.h < this.MIN_DRAW) continue;
      let arr = batches.get(r.color);
      if (!arr) { arr = []; batches.set(r.color, arr); }
      arr.push(i);
    }
    for (const [color, idxs] of batches) {
      ctx.fillStyle = color;
      for (let j = 0; j < idxs.length; j++) {
        const r = this.leaves[idxs[j]];
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }

    // Subtle bevel on bigger cells so the grid reads three-dimensional (real WDS look)
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < this.leaves.length; i++) {
      const r = this.leaves[i];
      if (r.w < 8 || r.h < 8) continue;
      ctx.fillRect(r.x, r.y, r.w, 1);
      ctx.fillRect(r.x, r.y, 1, r.h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < this.leaves.length; i++) {
      const r = this.leaves[i];
      if (r.w < 8 || r.h < 8) continue;
      ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
      ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    }

    // Labels only on big-enough cells
    for (let i = 0; i < this.leaves.length; i++) {
      const r = this.leaves[i];
      if (r.w < 60 || r.h < 22) continue;
      drawLabel(ctx, r);
    }
  }
}

function drawLabel(ctx, r) {
  const brightness = getBrightness(r.color);
  const textColor = brightness > 170 ? '#111' : '#fff';
  const padding = 4;
  const fontSize = Math.min(12, Math.max(9, Math.floor(r.h / 3.6)));
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  ctx.clip();
  // Dark strip behind text for legibility
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  const stripH = r.h > 40 ? fontSize * 2 + 6 : fontSize + 4;
  ctx.fillRect(r.x + padding, r.y + padding, r.w - padding * 2, stripH);
  ctx.fillStyle = textColor;
  ctx.font = `${r.h > 50 ? 'bold ' : ''}${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const availableW = r.w - padding * 2 - 2;
  const maxChars = Math.floor(availableW / (fontSize * 0.58));
  ctx.fillText(truncate(r.name, maxChars), r.x + padding + 1, r.y + padding + fontSize, availableW);
  if (r.h > 40) {
    ctx.font = `${Math.max(9, fontSize - 1)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.globalAlpha = 0.9;
    ctx.fillText(formatBytes(r.size), r.x + padding + 1, r.y + padding + fontSize * 2 + 2, availableW);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function getBrightness(color) {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  if (color.startsWith('hsl')) {
    // crude: pull lightness
    const m = color.match(/(\d+)%\s*\)/);
    if (m) return parseInt(m[1], 10) * 2.55;
  }
  return 128;
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '\u2026';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
