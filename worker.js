const nodes = new Map();
const children = new Map();

function getOrCreate(id, defaults) {
  if (nodes.has(id)) return nodes.get(id);
  const n = { id, name: id, size: 0, isFolder: false, children: [], ...defaults };
  nodes.set(id, n);
  children.set(id, []);
  return n;
}

self.onmessage = function (e) {
  const { type, files, rootName, fileCount, folderCount } = e.data;

  if (type === 'batch') {
    for (const f of files) {
      const n = getOrCreate(f.id, {
        name: f.name,
        isFolder: f.isFolder,
        size: f.isFolder ? 0 : f.size,
        mimeType: f.isFolder ? 'application/vnd.google-apps.folder' : f.mimeType,
        modifiedTime: f.modifiedTime || null,
      });
      n.size = f.isFolder ? (n.size || 0) : f.size;
      n.isFolder = f.isFolder;
      n.name = f.name;
      n.mimeType = f.isFolder ? 'application/vnd.google-apps.folder' : f.mimeType;
      if (f.modifiedTime) n.modifiedTime = f.modifiedTime;

      const pars = f.parents && f.parents.length ? f.parents : ['root'];
      for (const p of pars) {
        getOrCreate(p, { name: '', isFolder: true, size: 0 });
        const ch = children.get(p);
        if (!ch.includes(f.id)) ch.push(f.id);
      }
    }
    self.postMessage({ type: 'progress', count: nodes.size });
  }

  if (type === 'finish') {
    const rootId = 'root';
    getOrCreate(rootId, { name: rootName || 'My Drive', isFolder: true, size: 0 });

    // attach orphans to root
    for (const [id, ch] of children) {
      if (id !== rootId && !nodes.has(id)) {
        const rootCh = children.get(rootId);
        if (!rootCh.includes(id)) rootCh.push(id);
      }
    }

    // aggregate sizes bottom-up using DFS
    const visited = new Set();
    function dfs(id) {
      if (visited.has(id)) return nodes.get(id)?.size || 0;
      visited.add(id);
      const n = nodes.get(id);
      if (!n) return 0;
      let total = n.size || 0;
      for (const cid of (children.get(id) || [])) {
        total += dfs(cid);
      }
      n.size = total;
      n.children = (children.get(id) || [])
        .map(cid => nodes.get(cid))
        .filter(Boolean)
        .sort((a, b) => b.size - a.size);
      return total;
    }

    dfs(rootId);
    const tree = nodes.get(rootId);
    self.postMessage({ type: 'tree', tree, fileCount, folderCount });
  }
};
