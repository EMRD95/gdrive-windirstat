const API_BASE = 'https://www.googleapis.com/drive/v3';

// Enumerate files that live in THIS user's My Drive and count against THEIR
// storage quota. Skips:
//   - Shared drives / Team Drives (quota is billed to the drive, not the user)
//   - "Shared with me" files owned by someone else (they count against the owner)
//   - Trashed items
// For file sizes we prefer `size` (true byte count) over `quotaBytesUsed`
// because Workspace docs (Google Docs/Sheets/Slides) report quotaBytesUsed=0
// even though they have a non-zero on-disk footprint for Drive purposes, and
// some owned binaries can come back with a stale quotaBytesUsed.
export async function* scanDrive(accessToken, onProgress) {
  let pageToken = null;
  let total = 0;
  const fields = 'nextPageToken, files(id, name, mimeType, parents, size, quotaBytesUsed, trashed, modifiedTime, ownedByMe, shared, driveId)';
  // 'me' in owners = files where the current user is an owner of record.
  // Combined with NOT driveId filter below, this keeps us inside My Drive.
  const q = "'me' in owners and trashed = false";

  do {
    const params = new URLSearchParams({
      pageSize: '1000',
      fields,
      q,
      // Important: keep shared drives OUT. Shared drive files do NOT count
      // against the user's personal storage quota — they count against the
      // organization. Including them would double-count in a storage view.
      includeItemsFromAllDrives: 'false',
      supportsAllDrives: 'false',
      // Explicit 'user' corpus = My Drive + the user's own files only.
      corpora: 'user',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${API_BASE}/files?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive API ${res.status}: ${text}`);
    }

    const data = await res.json();
    const files = (data.files || [])
      // Defence in depth: Drive sometimes returns items in a shared drive
      // even with corpora=user if the user is listed as an owner somewhere
      // upstream. Drop anything with a driveId to be safe.
      .filter(f => !f.driveId)
      .map(f => {
        // Drive returns both fields as strings. Note: the string "0" is
        // truthy in JS, so a naive `f.size || f.quotaBytesUsed` short-
        // circuits to 0 and silently kills sizes for every Workspace doc.
        // Parse both independently and take the larger.
        const sizeNum = Number(f.size) || 0;
        const quotaNum = Number(f.quotaBytesUsed) || 0;
        const sz = Math.max(sizeNum, quotaNum);
        return {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType || 'application/octet-stream',
          parents: f.parents || [],
          size: sz,
          trashed: !!f.trashed,
          modifiedTime: f.modifiedTime || null,
          isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        };
      });

    total += files.length;
    if (onProgress) onProgress({ loaded: total, batch: files.length });
    yield files;

    pageToken = data.nextPageToken || null;
  } while (pageToken);
}
