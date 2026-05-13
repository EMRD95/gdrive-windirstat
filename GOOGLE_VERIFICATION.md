# Google OAuth Verification — Copy/Paste Kit

Everything you'll need when you submit DriveStat for Google's OAuth
verification (the "unverified app" warning removal).

> **Scope used:** `https://www.googleapis.com/auth/drive.metadata.readonly`
> Google classifies this as a **restricted** scope. Full public verification
> requires the **CASA security assessment** (annual, paid, several months).
> Without CASA you can still run the app but stay below **100 unique users**
> and users will see the "unverified app" warning screen.
> See section 7 for scope-change options.

---

## 1. OAuth consent screen — fields

Paste these into: https://console.cloud.google.com/apis/credentials/consent

### App information
| Field | Value |
| --- | --- |
| App name | DriveStat |
| User support email | em95org@gmail.com |
| App logo | Upload `assets/logo-120.png` (120×120 min, square, < 1 MB) |
| App domain — Application home page | https://drivestat.em95.org/ |
| App domain — Application privacy policy link | https://drivestat.em95.org/privacy.html |
| App domain — Application terms of service link | https://drivestat.em95.org/terms.html |
| Authorized domains | drivestat.em95.org |
| Developer contact information | em95org@gmail.com |

### Scopes
Add only what you actually use:
- `openid` (non-sensitive)
- `https://www.googleapis.com/auth/userinfo.email` (non-sensitive)
- `https://www.googleapis.com/auth/userinfo.profile` (non-sensitive)
- `https://www.googleapis.com/auth/drive.metadata.readonly` **← restricted, justification below**

### User type
- **External** (all Google users)
- Start in **Testing** mode, add test users, then click **Publish** → **Submit for verification** when ready.

---

## 2. Scope justification — `drive.metadata.readonly`

Paste this into the "How will the scopes be used?" field:

> DriveStat is a client-side Google Drive storage visualizer. After the user
> signs in and grants the drive.metadata.readonly scope, DriveStat calls
> files.list to enumerate the user's files and folders and reads only
> file metadata (id, name, size, mimeType, parents, modifiedTime). This
> metadata is used to render a WinDirStat-style treemap and a sortable
> tree view so the user can quickly see what is using their Drive storage
> and identify large or forgotten files. From the details panel the user
> can click "Open in Drive" which opens Google's own Drive UI in a new
> tab — DriveStat itself never reads file contents and never performs
> any write operation.
>
> File content is never downloaded, never transmitted to our servers, and
> never shared with any third party. All processing happens in the user's
> browser; the metadata index is cached in IndexedDB for fast reloads and
> is wiped when the user signs out or clears site data. We do not run a
> backend, do not operate a user database, and do not use analytics or
> tracking. This is disclosed in our privacy policy (linked on the consent
> screen) and a storage notice is shown in-app on first visit.
>
> drive.metadata.readonly is the least-privileged scope that permits a
> metadata-only enumeration of the user's Drive for visualization
> purposes. Narrower scopes (drive.file, drive.appdata) cannot see
> files the app did not create, which would defeat the product's core
> purpose (showing the user what is filling up their whole Drive).

---

## 3. Demo video requirements

Google requires an unlisted YouTube video (not Drive, not Vimeo) showing
the full OAuth flow and how the restricted scope is used.

### Must appear on-screen in this order:
1. **OAuth Client ID** visible. Either show the URL with `client_id=...`
   in it, or open DevTools → Network and point at the sign-in request.
2. **Your app's domain** in the URL bar (`drivestat.em95.org`).
3. **The consent screen** showing the exact scopes the user will grant.
4. **Use of the restricted scope** in the app:
   - Show a successful sign-in.
   - Click **Scan Drive** — narrate: "this uses drive.metadata.readonly
     to call files.list and read only metadata — names, sizes,
     mimeTypes, parents, modifiedTime — for files in the user's Drive."
   - Show the treemap and list render with the metadata.
   - Click a file → **Open in Drive** opens Google's own Drive UI in a
     new tab. DriveStat performs no writes and never opens file
     contents.
5. Narrate that **no data leaves the browser** and point at the privacy policy link in the footer.

### Recording tips
- 60 – 120 seconds is plenty.
- Keep narration clear; Google reviewers skim.
- Upload to **YouTube** as **Unlisted** and paste the link in the form.
- Don't use a throwaway Google account the reviewer can't reach — use the
  dev contact address.

### Suggested script (read verbatim if you want)

> Hi, this is DriveStat, a client-side Google Drive visualizer at
> drivestat.em95.org. I'm going to sign in with Google.
> [click Sign in with Google]
> You can see the consent screen shows the drive.metadata.readonly scope. I'll accept.
> [accept]
> Now I click Scan Drive. DriveStat uses the drive.metadata.readonly scope to call
> files.list and reads only metadata — filenames, sizes, MIME types, and
> the folder hierarchy. Nothing is downloaded, nothing is sent to any
> server we control. Everything you see is rendered from metadata in the
> browser.
> [show treemap + list]
> Clicking a file shows its details. "Open in Drive" opens Google's own
> Drive UI in a new tab — DriveStat never opens file contents itself and
> never writes to Drive. The scope is metadata-read-only.
> [click Open in Drive]
> The privacy policy in the footer explains that nothing is collected,
> nothing is transmitted, and there are no analytics or trackers.
> Thanks for reviewing.

---

## 4. Domain verification

Before the consent screen lets you list `drivestat.em95.org` as an authorized
domain, you must verify it in Google Search Console:

1. Go to https://search.google.com/search-console/welcome
2. Add **drivestat.em95.org** as a Domain property (DNS TXT verification) or
   **https://drivestat.em95.org** as a URL-prefix property (HTML file or meta
   tag verification).
3. If using the HTML file method, Google will give you a file like
   `googleXXXXXXXXXXXXXXXX.html`. Drop it in the repo root and deploy.
4. Wait for "Ownership verified" ✅.

Once verified, the Cloud Console will accept `drivestat.em95.org` in the
Authorized domains list.

---

## 5. Post-verification checklist

- [ ] OAuth consent screen published (not in Testing)
- [ ] Privacy policy live at https://drivestat.em95.org/privacy.html
- [ ] Terms live at https://drivestat.em95.org/terms.html
- [ ] App domain `drivestat.em95.org` verified in Search Console
- [ ] Authorized JavaScript origins in the OAuth client = production URL only (NOT localhost) for the production client ID
- [ ] Separate **dev** OAuth client for localhost/127.0.0.1 (keep it in Testing mode forever)
- [ ] Demo video unlisted on YouTube and linked in the form
- [ ] Logo uploaded (square, 120×120 PNG min)
- [ ] Support email auto-responder so the reviewer's questions get answered within the 3-day window — Google will re-open the case if you miss their reply

---

## 6. What happens if you don't verify

You can still use the app with the drive.metadata.readonly scope, but users will see an
"unverified app" warning screen with a yellow triangle and an
"Advanced → Go to app (unsafe)" expand. This warning disappears only
after verification. There is a **100 unique users** cap on unverified
unverified restricted-scope apps before Google will start blocking new grants.

---

## 7. Scope trade-offs

`drive.metadata.readonly` is **restricted** (not sensitive). Restricted
scopes trigger the full CASA (Cloud Application Security Assessment),
which is a paid annual security audit and can take months.

If CASA is a blocker, the alternatives are:

- **Stay unverified.** The app works; users see the "unverified app"
  warning, and Google caps new grants at ~100 unique users. Fine for
  personal / small-scale use.
- **Switch to `drive.file`.** Sensitive scope, fast (3–6 business day)
  verification, no CASA. But `drive.file` only sees files the app
  created or the user explicitly opened via the Google Picker — it
  cannot enumerate the entire Drive, so the WinDirStat-style full-disk
  visualization no longer works.
- **Pay for CASA.** The honest long-term path for a public tool that
  scans full Drives. Budget: several thousand USD / year for the audit
  vendor, plus engineering time to meet the requirements.
