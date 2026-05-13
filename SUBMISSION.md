# Google OAuth Verification — Submission Playbook

Step-by-step for submitting DriveStat for OAuth restricted-scope
verification. Every field answer is pre-written. Copy and paste.

**Goal:** get the app approved to use `drive.metadata.readonly`
publicly (past the 100-user test cap) without a CASA security
assessment, on the grounds that DriveStat is a purely client-side
application with no backend server.

---

## Pre-flight checklist

Confirm every item below before hitting Submit. Anything missing will
cause a rejection round-trip.

### Domain & site
- [ ] Live site responds at https://drivestat.em95.org/ with HTTP 200
- [ ] https://drivestat.em95.org/privacy.html loads
- [ ] https://drivestat.em95.org/terms.html loads
- [ ] https://drivestat.em95.org/verification.html loads
- [ ] `em95.org` verified in Google Search Console as a Domain property
      (TXT record) — this covers the `drivestat.em95.org` subdomain

### OAuth consent screen / Branding page
Path: https://console.cloud.google.com/auth/branding

- [ ] App name: `DriveStat`
- [ ] User support email: `em95org@gmail.com`
- [ ] App logo: uploaded (`assets/logo-120.png`, 120×120 square PNG)
- [ ] Application home page: `https://drivestat.em95.org/`
- [ ] Application privacy policy link: `https://drivestat.em95.org/privacy.html`
- [ ] Application terms of service link: `https://drivestat.em95.org/terms.html`
- [ ] Authorized domains: `em95.org`
- [ ] Developer contact email: `em95org@gmail.com`

### Audience
Path: https://console.cloud.google.com/auth/audience

- [ ] Audience type: External
- [ ] Status: Testing (submission moves it to "In production, pending
      verification")

### OAuth Client
Path: https://console.cloud.google.com/auth/clients

- [ ] Authorized JavaScript origins include `https://drivestat.em95.org`
- [ ] `https://emrd95.github.io` removed (legacy)
- [ ] `http://localhost:8765` kept for local development
- [ ] No redirect URIs needed (the app uses the GIS token client, not
      a redirect flow)

### Data Access (scopes)
Path: https://console.cloud.google.com/auth/scopes

- [ ] Only `https://www.googleapis.com/auth/drive.metadata.readonly`
      declared. No extras.
- [ ] Scope shows the red "Restricted" badge.

### Demo video
- [ ] Recorded per `VIDEO_SCRIPT.md`
- [ ] Uploaded to YouTube as **Unlisted**
- [ ] Link on hand

---

## Submission form — field by field

Path: https://console.cloud.google.com/auth/verification

Click **Edit App**, step through the wizard, and use these answers.

### OAuth consent screen
Already filled from the Branding page. Review, continue.

### Scopes
When asked to justify `drive.metadata.readonly`, paste this in the
"Why do you need this scope?" / scope justification box:

```
DriveStat is a treemap visualizer for a user's Google Drive
storage — the equivalent of WinDirStat for Windows or DaisyDisk for
macOS, but for Drive. To render an accurate whole-Drive view, the
app enumerates file metadata (name, size, parents, mimeType,
modifiedTime) across the user's Drive. drive.metadata.readonly is
the minimum scope that supports this, because drive.file only
surfaces files the user individually picks via Google Picker —
incompatible with a whole-Drive storage breakdown.

DriveStat requests only metadata. File contents, thumbnails, and
previews are never accessed. The scope is read-only; the app
cannot and does not modify user files.

DriveStat is a static single-page web application with no backend
server. All API calls are made from the user's browser directly to
www.googleapis.com. No Google user data is transmitted to, stored
by, or processed by any developer-controlled server.

Full technical evidence, including the data-flow diagram and
reproduction steps, is published at
https://drivestat.em95.org/verification.html, and the complete
source is public at github.com/EMRD95/gdrive-windirstat.
```

### "What features will you use?" / Application type
If a "storage analyzer" or "file manager" option is listed, pick the
closest match. If nothing fits well, **leave blank** — per Google's
own guidance, the verification team will classify it for you. Do NOT
pick "task automation" or "backup/migration" — those have stricter
requirements.

### Documentation / additional links
You can usually supply up to 3 links. Use:

1. `https://drivestat.em95.org/verification.html` — technical evidence
2. `https://github.com/EMRD95/gdrive-windirstat` — public source
3. (YouTube Unlisted URL) — demo video

### Data handling questionnaire

These are the questions Google most commonly asks for restricted
scopes. Exact wording varies. The answers are the same.

**Q. How will you use the data accessed?**
```
DriveStat uses Drive metadata (name, size, parents, mimeType,
modifiedTime) exclusively to render the user-facing treemap, file
list, and details sidebar. The treemap shows which folders and
files consume the most Drive quota so the user can decide what to
manually clean up in Google Drive's own UI. Metadata is held in
browser memory during the session and cached in IndexedDB on the
user's device so repeat visits do not require a full rescan.
```

**Q. Do you share data with any third parties? If so, who and why?**
```
No. DriveStat does not share Drive data with any third party. No
third party ever receives Drive data. The app is entirely
client-side; Drive API responses are received by the user's
browser directly from www.googleapis.com and are never forwarded
to any server.
```

**Q. Where is data stored? On your servers? In the user's browser?**
```
Only in the end user's browser. Specifically:
  - OAuth access token: localStorage key "ds_access_token"
  - Cached scan: IndexedDB database "DriveStatDB" / store "files"
  - UI preferences: localStorage keys ds_theme,
    ds_list_pane_height_pct, ds_treemap_visible, ds_cookie_ack
DriveStat does not operate any server that stores user data. There
is no developer-controlled database.
```

**Q. Do you transfer or process data on servers you or a third party
control?**
```
No. DriveStat is a static single-page web application served from
GitHub Pages (a static-file CDN). It has no server-side
application code. All Google Drive API requests are made from the
end user's browser directly to www.googleapis.com. No developer-
operated server receives, processes, or stores any Google user
data. This is reproducible by any reviewer: inspect the public
source at github.com/EMRD95/gdrive-windirstat, and observe in
DevTools Network tab that the only request destinations during a
full scan are accounts.google.com, apis.google.com,
www.googleapis.com, and the static-asset CDN.
```

**Q. How is the data secured?**
```
Drive API requests go from the browser directly to
www.googleapis.com over TLS; they never traverse a developer-
controlled network. The OAuth access token is held only in
localStorage on the user's device and is cleared on sign-out.
Cached metadata in IndexedDB is likewise scoped to the
drivestat.em95.org origin and isolated from other sites by the
browser's same-origin policy. Because no data is ever transmitted
to a developer-controlled server, there is no server-side storage
to secure or breach.
```

**Q. Retention / deletion policy?**
```
DriveStat does not retain user data on any developer-controlled
system because no such system exists. In-browser state is retained
only as long as the user keeps the browser site data for
drivestat.em95.org. The user can fully purge it at any time by:
(a) clicking Sign out in DriveStat, (b) clearing site data in the
browser, and (c) revoking DriveStat's access at
https://myaccount.google.com/permissions.
```

**Q. Which developer-specific Limited Use requirements does your app
satisfy?**
```
All four:
1. Use data only to provide or improve user-facing features that
   are prominent in the app's UI — the treemap, file list, and
   details panel are the primary UI.
2. Transfer data only as necessary to provide or improve
   user-facing features and only with user consent or to comply
   with law — no transfers occur.
3. Do not use data for serving ads — DriveStat has no ads.
4. Do not allow humans to read the data — there is no server and
   no operator with access; the data exists only on the user's
   own device.
```

### CASA section

If the form asks whether a CASA assessor LOA is on file or pending,
answer **No — client-side app exception**. There is usually a free-
form "Reason" field; paste:

```
DriveStat does not require a CASA security assessment because it
does not "access restricted data from or through a third-party
server" per the restricted-scope verification requirements. It is
a static single-page web application with no backend server
operated by or accessible to the developer. All Drive API requests
are made from the user's browser directly to www.googleapis.com;
no developer-controlled server receives, processes, or stores any
Google user data.

Technical evidence:
https://drivestat.em95.org/verification.html
Public source repository:
https://github.com/EMRD95/gdrive-windirstat
```

---

## What happens next

**Brand verification** (logo, domain, name): 2–5 business days. You
may get emails asking for a small fix (logo format, domain
mismatch). Respond same-day.

**Restricted scope review**: 2–6 weeks typical for client-side apps.
Google reviewers will likely test the site and poke around the repo.

**Possible outcomes**

1. **Approved.** The consent screen banner disappears, 100-user cap
   lifts. You're done.

2. **Clarification request.** Google asks a question, often about a
   specific UI interaction or wording in the privacy policy. Reply
   within 2 weeks or the submission gets closed. The reply field is
   in the verification console, same page you submitted from.

3. **"Please complete a CASA assessment."** Counter with the
   client-side exception argument:
   - Link verification.html again
   - Quote the requirement text verbatim: *"apps with ability to
     access restricted data from or through a third-party server"*
     — emphasize the app has no such server
   - Offer to record a DevTools walkthrough showing no requests to
     developer-controlled servers
   For purely client-side apps this usually flips on the second
   review pass.

4. **"Switch to drive.file."** Rare for visualization apps. Explain
   again that drive.file only exposes Picker-selected files, which
   cannot produce a whole-Drive view. If Google insists, the options
   are: (a) stay unverified under the 100-user cap, or (b) pay for
   CASA.

---

## If approved, post-approval checklist

- [ ] Remove the "unverified app" warning screenshot from README (it
      won't be seen anymore)
- [ ] Update verification.html status line to "Verified"
- [ ] Mark the verification date in CHANGELOG
- [ ] Calendar an annual reminder to re-check requirements (Google
      updates policies periodically even for client-side apps)

---

## Copy-paste quick reference

| Field | Value |
|---|---|
| App name | DriveStat |
| Support email | em95org@gmail.com |
| Home page | https://drivestat.em95.org/ |
| Privacy policy | https://drivestat.em95.org/privacy.html |
| Terms of service | https://drivestat.em95.org/terms.html |
| Authorized domain | em95.org |
| Developer contact | em95org@gmail.com |
| Scope | https://www.googleapis.com/auth/drive.metadata.readonly |
| Evidence doc | https://drivestat.em95.org/verification.html |
| Source repo | https://github.com/EMRD95/gdrive-windirstat |
