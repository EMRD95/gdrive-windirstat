const API_BASE = 'https://www.googleapis.com/drive/v3';

export async function* scanDrive(accessToken, onProgress) {
  let pageToken = null;
  let total = 0;
  const fields = 'nextPageToken, files(id, name, mimeType, parents, quotaBytesUsed, trashed, modifiedTime, driveId, teamDriveId)';
  const q = "trashed = false";

  do {
    const params = new URLSearchParams({
      pageSize: '1000',
      fields,
      q,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
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
    const files = (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType || 'application/octet-stream',
      parents: f.parents || [],
      size: parseInt(f.quotaBytesUsed || '0', 10),
      trashed: !!f.trashed,
      modifiedTime: f.modifiedTime || null,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    }));

    total += files.length;
    if (onProgress) onProgress({ loaded: total, batch: files.length });
    yield files;

    pageToken = data.nextPageToken || null;
  } while (pageToken);
}
