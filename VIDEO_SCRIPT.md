# DriveStat — OAuth Verification Demo Video

Google requires a short video demonstrating the OAuth flow and the
app's use of the requested scope. Target: **~90–120 seconds**,
unlisted YouTube, 1080p screen recording.

## Setup before recording

- Use a **test Google account**, not your primary. Create one in
  advance and populate the Drive with a handful of files/folders so
  the treemap has something to show.
- Close all other browser tabs.
- Clear site data for drivestat.em95.org so the first-run state is
  clean (Settings → Privacy → Site settings → drivestat.em95.org →
  Clear data).
- Open DevTools **before** starting the recording:
  - Network tab, "Preserve log" ON, filter bar empty
  - Application tab ready in a second window/panel
- Window size: at least 1280×720. Zoom level 100%.
- Recording software: OBS Studio is free and works fine. Export as
  MP4 at 1080p.

## Shot list with narration

The narration below is verbatim. Speak clearly; no background music.

---

**[0:00 – 0:10] URL bar + landing page**

*Visual:* Browser window, URL bar clearly showing
`https://drivestat.em95.org/`. Scroll slowly down the landing page
showing the hero, feature cards, and footer.

> "This is DriveStat, a Google Drive storage visualizer hosted at
> drivestat.em95.org. It's a static single-page web app with no
> backend server."

---

**[0:10 – 0:25] OAuth consent screen**

*Visual:* Click "Sign in with Google". When the Google consent popup
appears, hold on it long enough that the viewer can read:
  - The DriveStat name and logo at the top
  - The scope being requested — "See information about your Google
    Drive files"
  - The home page and privacy policy links

> "The consent screen shows DriveStat's name, logo, and the single
> scope we request: drive.metadata.readonly. This is read-only
> access to file metadata — not file contents."

Click **Continue** / **Allow**.

---

**[0:25 – 0:45] Scan in progress with Network tab visible**

*Visual:* Bring up DevTools Network tab at the bottom/side of the
screen so it's visible while the scan runs. Point the mouse at the
request list as requests populate.

> "As the scan runs, the Network tab shows all requests. Every
> request goes either to accounts.google.com for the sign-in
> library, or to www.googleapis.com for Drive metadata. There are no
> requests to any server operated by the developer, because no such
> server exists."

Let the scan finish. A treemap fills the window.

---

**[0:45 – 1:10] Using the app**

*Visual:* Briefly demonstrate the core UI:
  - Hover over a large tile in the treemap — tooltip shows file info
  - Click a folder in the tree view on the left — details panel
    shows size/parent/modified time
  - Use the search box to filter
  - Click a file — details panel populates

> "The treemap, file list, and details sidebar are the entire
> product. Users see which files and folders use the most storage,
> so they can clean up manually in Drive's own UI."

---

**[1:10 – 1:30] Where data lives (Application tab)**

*Visual:* Switch DevTools to the Application tab.
  - Expand localStorage → drivestat.em95.org. Show the keys
    `ds_access_token`, `ds_theme`, etc.
  - Expand IndexedDB → DriveStatDB → files. Show that the scan cache
    lives here.

> "All data is in the browser. The OAuth token is in localStorage.
> The scanned file index is in IndexedDB, scoped to this origin.
> Nothing is ever uploaded off the device."

---

**[1:30 – 1:50] Sign out clears everything**

*Visual:* Click Sign out in the app header. The app returns to the
signed-out state. In DevTools, refresh the Application tab:
  - localStorage: `ds_access_token` is gone (preferences may remain)
  - IndexedDB: the files store is cleared or empty

> "Signing out clears the token and the cached index. The user can
> also fully revoke DriveStat's access from their Google account
> permissions page, which is linked from the privacy policy."

---

**[1:50 – 2:00] Closing — source + evidence**

*Visual:* Open a new tab to
`https://github.com/EMRD95/gdrive-windirstat` and briefly show the
repo file list. Then open
`https://drivestat.em95.org/verification.html`.

> "The complete source is public on GitHub, and the technical
> evidence for this submission is published at
> drivestat.em95.org/verification.html. Thanks for reviewing."

---

## After recording

1. Upload to YouTube as **Unlisted** (not Private — Google reviewers
   need to watch it without signing in to your channel).
2. In the description, add:
   ```
   OAuth verification demo for DriveStat (drivestat.em95.org).
   Source: https://github.com/EMRD95/gdrive-windirstat
   Technical evidence: https://drivestat.em95.org/verification.html
   ```
3. Copy the URL into the verification submission form.

## Common video rejection reasons (avoid)

- **URL bar not visible.** Google specifically wants to see the
  deployed domain matches the authorized domain. Keep the address
  bar in frame whenever you're on drivestat.em95.org.
- **Consent screen not shown or shown too briefly.** Give the viewer
  2–3 seconds to read it.
- **Scope shown in consent doesn't match submitted scope.** Only one
  scope is requested, so this should be automatic. Double-check.
- **Music / talking over explanation.** Reviewers skim; clear
  narration helps. No background music.
- **Private video.** Must be Unlisted.
