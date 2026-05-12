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
  // Match Google Drive's convention: binary units (1024-based) labeled
  // as GB/MB/etc (not GiB). Google's storage page does the same, so a
  // 24.71 GB file on drive.google.com reads as 24.71 GB here too.
  const u = ['B','KB','MB','GB','TB','PB'];
  const i = Math.min(Math.floor(Math.log(Math.abs(b)) / Math.log(1024)), u.length - 1);
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + u[i];
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
    this.folderById = new Map(); // id -> folder bounding rect (for selection outline)
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
    // Van Wijk 1999 cushion parameters — reverse-engineered from WinDirStat's
    // CTreeMap::DrawCushion (windirstat/windirstat, Controls/TreeMap.cpp + .h).
    // Pure Lambert shading, NO specular. The metallic look comes from:
    //   1. An overbright factor (brightness / PALETTE_BRIGHTNESS ≈ 1.467)
    //      that pushes channels over 255.
    //   2. NormalizeColor() redistribution of the overflow into the other
    //      two channels instead of clamping — this washes highlights toward
    //      white while keeping hue saturation on the dim side.
    //   3. All source colors pre-normalized to palette brightness 0.6 so the
    //      overbright factor produces a consistent look across the palette.
    //
    // Defaults match TreeMap.h:222-233 (DefaultOptions).
    //   height       = 0.88  (our initial ridge = height * scaleFactor)
    //   scaleFactor  = 0.91  (per-level attenuation of ridge height)
    //   ambientLight = 0.13  (Ia;  Is = 1 - Ia)
    //   lightSource  = (-1, -1, 10), normalized → (-0.09901, -0.09901, 0.99015)
    //   brightness   = 0.88
    //   PALETTE_BRIGHTNESS = 0.6 (TreeMap.cpp:37)
    this.cushionH   = 0.88 * 0.91;         // initial ridge height at root
    this.cushionF   = 0.91;                // decay per nesting level
    this.cushionLx  = -0.09901475;         // -1 / sqrt(102)
    this.cushionLy  = -0.09901475;         // -1 / sqrt(102)
    this.cushionLz  =  0.99014746;         // 10 / sqrt(102)
    this.cushionIa  = 0.13;
    this.cushionIs  = 1 - 0.13;
    // Bumped from WinDirStat's 0.88 default — at our typical display sizes
    // the cushion-averaged pixel reads a touch darker than WDS on Windows,
    // so a small overbright bump restores the expected brightness without
    // blowing out the highlight overflow behavior.
    this.cushionBrightness = 0.95;
    this.cushionPaletteBrightness = 0.6;
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
  // Surface coefficients (sx1, sx2, sy1, sy2) for van Wijk cushion shading
  // accumulate during descent: each folder adds its own parabolic bump,
  // attenuated by `f^depth`, so leaves inherit the full hierarchy's surface.
  _layout() {
    this.leaves = [];
    this.leafById.clear();
    this.folderById.clear();
    this.cacheDirty = true;
    if (!this.tree) return;
    const W = this.canvas.width / this.dpr;
    const H = this.canvas.height / this.dpr;
    if (W < 1 || H < 1) return;
    this._layoutNode(this.tree, 0, 0, W, H, 0, 0, 0, 0, this.cushionH);
    // Populate lookup map in one pass
    for (let i = 0; i < this.leaves.length; i++) {
      this.leafById.set(this.leaves[i].id, this.leaves[i]);
    }
    this._buildGrid(W, H);
  }

  _layoutNode(node, x, y, w, h, sx1, sx2, sy1, sy2, bumpH) {
    // Prune anything too small to be visible — saves massive work on deep dirs
    if (w < this.MIN_DRAW || h < this.MIN_DRAW) return;
    if (!node) return;

    // van Wijk 1999: every rect at every level adds its own parabolic bump.
    // Accumulating coefficients down the tree produces the signature
    // WinDirStat look — big folder cushions with small sub-bumps on top.
    const x2 = x + w, y2 = y + h;
    const nSx1 = sx1 + 4 * bumpH * (x2 + x) / w;
    const nSx2 = sx2 - 4 * bumpH / w;
    const nSy1 = sy1 + 4 * bumpH * (y2 + y) / h;
    const nSy2 = sy2 - 4 * bumpH / h;

    // File leaf: freeze final surface + rect, then stop
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
        sx1: nSx1, sx2: nSx2, sy1: nSy1, sy2: nSy2,
      });
      return;
    }

    // Folder: squarify children inside this rect, recurse w/ attenuated bump
    const kids = node.children;
    if (!kids || !kids.length) return;
    // Record this folder's bounding rect so clicking it in the list view
    // can outline its whole cluster in the treemap.
    this.folderById.set(node.id, { x, y, w, h });
    const items = [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.size > 0) items.push({ node: c, size: c.size });
    }
    if (!items.length) return;
    items.sort((a, b) => b.size - a.size);
    const rects = squarify(items, x, y, w, h);
    const childH = bumpH * this.cushionF;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      this._layoutNode(r.node, r.x, r.y, r.w, r.h, nSx1, nSx2, nSy1, nSy2, childH);
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
      if (!r) continue; // stale grid index (leaves rebuilt); skip
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
      } else {
        // Folder selection — outline the whole cluster so the user can see
        // which region on the treemap contains the folder's files.
        const f = this.folderById.get(this.selectedId);
        if (f && f.w >= 2 && f.h >= 2) {
          ctx.save();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
          ctx.restore();
        }
      }
    }
  }

  _renderCache(W, H) {
    const ctx = this.cacheCtx;
    if (!this.leaves.length) {
      ctx.fillStyle = this._bgColor();
      ctx.fillRect(0, 0, W, H);
      return;
    }

    // --- Van Wijk 1999 per-pixel cushion shading ---
    // Each leaf carries accumulated surface coefficients (sx1, sx2, sy1, sy2).
    // The height field z(x,y) = -(sx2 x² + sx1 x + sy2 y² + sy1 y + const),
    // and the un-normalized outward normal is n = (-(2 sx2 x + sx1), -(2 sy2 y + sy1), 1).
    // Lambert shading with light L gives intensity = Ia + max(0, Is * L·n / |n|).
    // We bake this into an ImageData buffer (one pass over the whole canvas)
    // which is then blitted via drawImage on every interaction — O(1) hover cost.
    const dpr = this.dpr;
    const bw = this.cache.width, bh = this.cache.height;
    if (bw < 1 || bh < 1) return;

    const img = ctx.createImageData(bw, bh);
    const buf32 = new Uint32Array(img.data.buffer);

    // Background: parse once, fill whole buffer via Uint32 .fill (very fast)
    const bgRgb = parseCssColorRgb(this._bgColor());
    const bgPacked = packRgba(bgRgb.r, bgRgb.g, bgRgb.b);
    buf32.fill(bgPacked);

    const Lx = this.cushionLx, Ly = this.cushionLy, Lz = this.cushionLz;
    const Ia = this.cushionIa, Is = this.cushionIs;
    // WinDirStat's "metallic" trick: overbright the pixel past 1.0 then let
    // NormalizeColor redistribute per-channel overflow into the other two
    // channels. This is what washes highlights toward white while preserving
    // hue in shadow — it's NOT specular reflection, it's HDR-ish tone mapping.
    const brightnessFactor = this.cushionBrightness / this.cushionPaletteBrightness;

    for (let i = 0; i < this.leaves.length; i++) {
      const r = this.leaves[i];
      if (r.w < this.MIN_DRAW || r.h < this.MIN_DRAW) continue;

      // Pre-normalize this leaf's color to PALETTE_BRIGHTNESS so the
      // brightnessFactor multiply produces the intended WinDirStat look
      // regardless of what hue colorForNode() returned.
      const pal = paletteColor(r.color, this.cushionPaletteBrightness);
      const cr = pal.r, cg = pal.g, cb = pal.b;

      // Backing-pixel bounds (leaves are stored in CSS-pixel coords).
      // Clamp end to bw/bh in case of sub-pixel rounding overrun.
      const bx0 = Math.max(0, Math.floor(r.x * dpr));
      const by0 = Math.max(0, Math.floor(r.y * dpr));
      const bx1 = Math.min(bw, Math.ceil((r.x + r.w) * dpr));
      const by1 = Math.min(bh, Math.ceil((r.y + r.h) * dpr));
      if (bx1 <= bx0 || by1 <= by0) continue;

      // Tiny tiles: shading adds noise, not info — flat-fill each row.
      if (r.w < 3 || r.h < 3) {
        const packed = packRgba(cr, cg, cb);
        for (let py = by0; py < by1; py++) {
          buf32.fill(packed, py * bw + bx0, py * bw + bx1);
        }
        continue;
      }

      // Shaded tile — inner loop hot path.
      // Mirrors CTreeMap::DrawCushion (TreeMap.cpp:811-855) exactly:
      //   ny = -(2*surface[1]*(y+0.5) + surface[3])
      //   nx = -(2*surface[0]*(x+0.5) + surface[2])
      //   cosa = min((nx*Lx + ny*Ly + Lz)/sqrt(nx²+ny²+1), 1)
      //   pixel = Ia + max(Is*cosa, 0)
      //   pixel *= brightnessFactor
      //   R = colR*pixel ...  NormalizeColor(R,G,B)
      const sx1 = r.sx1, sx2 = r.sx2, sy1 = r.sy1, sy2 = r.sy2;
      for (let py = by0; py < by1; py++) {
        const yCss = (py + 0.5) / dpr;
        const ny = -(2 * sy2 * yCss + sy1);
        const rowBase = py * bw;
        for (let px = bx0; px < bx1; px++) {
          const xCss = (px + 0.5) / dpr;
          const nx = -(2 * sx2 * xCss + sx1);
          let cosa = (Lx * nx + Ly * ny + Lz) /
                     Math.sqrt(nx * nx + ny * ny + 1);
          if (cosa > 1) cosa = 1;
          let diff = Is * cosa;
          if (diff < 0) diff = 0;
          const pixel = (Ia + diff) * brightnessFactor;

          let R = (cr * pixel) | 0;
          let G = (cg * pixel) | 0;
          let B = (cb * pixel) | 0;

          // --- CColorSpace::NormalizeColor (TreeMap.h:61-95) inlined ---
          // If a channel exceeds 255, split its overflow/2 into each of
          // the other two; if that in turn overflows, push the remainder
          // into the last channel. Only one channel can overflow at a time
          // because total brightness * brightnessFactor <= 1.467 * 3 * 0.6 < 3.
          if (R > 255) {
            const h = (R - 255) >> 1;
            R = 255; G += h; B += h;
            if (G > 255) { B += G - 255; G = 255; }
            else if (B > 255) { G += B - 255; B = 255; }
          } else if (G > 255) {
            const h = (G - 255) >> 1;
            G = 255; R += h; B += h;
            if (R > 255) { B += R - 255; R = 255; }
            else if (B > 255) { R += B - 255; B = 255; }
          } else if (B > 255) {
            const h = (B - 255) >> 1;
            B = 255; R += h; G += h;
            if (R > 255) { G += R - 255; R = 255; }
            else if (G > 255) { R += G - 255; G = 255; }
          }
          if (R > 255) R = 255;
          if (G > 255) G = 255;
          if (B > 255) B = 255;

          // Little-endian RGBA -> ABGR in memory
          buf32[rowBase + px] = (0xff << 24) | ((B & 0xff) << 16) | ((G & 0xff) << 8) | (R & 0xff);
        }
      }
    }

    ctx.putImageData(img, 0, 0);

    // Hairline separator — a 1-px dark edge between tiles helps the cushions
    // read as distinct shapes. Cheap: only medium+ leaves draw it.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < this.leaves.length; i++) {
      const r = this.leaves[i];
      if (r.w < 4 || r.h < 4) continue;
      ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
      ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    }

    // Labels on tiles removed — hover tooltip carries the file info.
    // WinDirStat itself doesn't draw per-tile text either; the treemap is
    // purely a visual density map and text lives in the list pane.
  }
}

// --- Color parsing helpers for the shader ---
const _cssColorCache = new Map();
let _cssColorProbe = null;
function parseCssColorRgb(color) {
  const hit = _cssColorCache.get(color);
  if (hit) return hit;
  if (!_cssColorProbe) {
    _cssColorProbe = document.createElement('canvas');
    _cssColorProbe.width = 1; _cssColorProbe.height = 1;
  }
  const g = _cssColorProbe.getContext('2d');
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = color;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  const rgb = { r: d[0], g: d[1], b: d[2] };
  _cssColorCache.set(color, rgb);
  return rgb;
}

function packRgba(r, g, b) {
  // ImageData is little-endian on every real browser: bytes are R,G,B,A
  // which reads as a Uint32 of 0xAABBGGRR.
  return (0xff << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

// Mirrors CColorSpace::MakeBrightColor (TreeMap.h:37-58).
// Rescales any RGB to a specific brightness = (r+g+b)/3/255, then redistributes
// any per-channel overflow into the other channels (NormalizeColor).
// This is what EqualizeColors does to the WinDirStat palette up-front, and it's
// why the cushion shader looks consistent no matter which hue you feed it.
const _paletteColorCache = new Map();
function paletteColor(color, brightness) {
  const key = color + '|' + brightness;
  const hit = _paletteColorCache.get(key);
  if (hit) return hit;
  const rgb = parseCssColorRgb(color);
  let dr = rgb.r / 255, dg = rgb.g / 255, db = rgb.b / 255;
  const sum = dr + dg + db;
  if (sum > 0.0001) {
    const f = 3.0 * brightness / sum;
    dr *= f; dg *= f; db *= f;
  }
  let r = (dr * 255) | 0;
  let g = (dg * 255) | 0;
  let b = (db * 255) | 0;
  if (r > 255) {
    const h = (r - 255) >> 1;
    r = 255; g += h; b += h;
    if (g > 255) { b += g - 255; g = 255; }
    else if (b > 255) { g += b - 255; b = 255; }
  } else if (g > 255) {
    const h = (g - 255) >> 1;
    g = 255; r += h; b += h;
    if (r > 255) { b += r - 255; r = 255; }
    else if (b > 255) { r += b - 255; b = 255; }
  } else if (b > 255) {
    const h = (b - 255) >> 1;
    b = 255; r += h; g += h;
    if (r > 255) { g += r - 255; r = 255; }
    else if (g > 255) { r += g - 255; g = 255; }
  }
  if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  const out = { r, g, b };
  _paletteColorCache.set(key, out);
  return out;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
