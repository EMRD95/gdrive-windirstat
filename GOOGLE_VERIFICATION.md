# Google OAuth Verification — Copy/Paste Kit

Everything you'll need when you submit DriveStat for Google's OAuth
verification (the "unverified app" warning removal).

> **Scope used:** `https://www.googleapis.com/auth/drive.file`
> This is a **sensitive** scope, not a **restricted** scope — so you need
> **Basic** OAuth verification, not the full CASA security assessment.
> Estimated review time: 3 – 6 business days once the form is complete.

---

## 1. OAuth consent screen — fields

Paste these into: https://console.cloud.google.com/apis/credentials/consent

### App information
| Field | Value |
| --- | --- |
| App name | DriveStat |
| User support email | support@drivestat.app |
| App logo | Upload `assets/logo-120.png` (120×120 min, square, < 1 MB) |
| App domain — Application home page | https://drivestat.app/ |
| App domain — Application privacy policy link | https://drivestat.app/privacy.html |
| App domain — Application terms of service link | https://drivestat.app/terms.html |
| Authorized domains | drivestat.app |
| Developer contact information | dev@drivestat.app |

### Scopes
Add only what you actually use:
- `openid` (non-sensitive)
- `https://www.googleapis.com/auth/userinfo.email` (non-sensitive)
- `https://www.googleapis.com/auth/userinfo.profile` (non-sensitive)
- `https://www.googleapis.com/auth/drive.file` **← sensitive, justification below**

### User type
- **External** (all Google users)
- Start in **Testing** mode, add test users, then click **Publish** → **Submit for verification** when ready.

---

## 2. Scope justification — `drive.file`

Paste this into the "How will the scopes be used?" field:

> DriveStat is a client-side Google Drive storage visualizer. After the user
> signs in and grants the drive.file scope, DriveStat calls files.list to
> enumerate the user's files and folders and reads only file metadata
> (id, name, size, mimeType, parents, modifiedTime). This metadata is used
> to render a WinDirStat-style treemap and a sortable tree view so the user
> can quickly see what's using their Drive storage and identify large or
> forgotten files. The user can then click "Open in Drive" to inspect a
> file, or "Move to Trash" which issues a single files.update call setting
> trashed=true on the selected file.
>
> File content is never downloaded, never transmitted to our servers, and
> never shared with any third party. All processing happens in the user's
> browser; the metadata index is cached in IndexedDB for fast reloads and
> is wiped when the user signs out or clears site data. We do not run a
> backend, do not operate a user database, and do not use analytics or
> tracking. This is disclosed in our privacy policy (linked on the consent
> screen) and a storage notice is shown in-app on first visit.
>
> drive.file is the least-privileged scope that allows a metadata scan of
> files the user has authorized the app to see; a narrower scope would not
> permit the core functionality (visualizing storage usage).

---

## 3. Demo video requirements

Google requires an unlisted YouTube video (not Drive, not Vimeo) showing
the full OAuth flow and how each sensitive scope is used.

### Must appear on-screen in this order:
1. **OAuth Client ID** visible. Either show the URL with `client_id=...`
   in it, or open DevTools → Network and point at the sign-in request.
2. **Your app's domain** in the URL bar (`drivestat.app`).
3. **The consent screen** showing the exact scopes the user will grant.
4. **Use of each sensitive scope** in the app:
   - Show a successful sign-in.
   - Click **Scan Drive** — narrate "this uses drive.file to list the
     metadata of files the user has opened with or created by the app."
   - Show the treemap and list render with the metadata.
   - Click a file → **Open in Drive** (proves read-only usage).
   - (Optional) Click **Move to Trash** → narrate "this uses drive.file
     to set trashed=true on the selected file; no content is modified."
5. Narrate that **no data leaves the browser** and point at the privacy policy link in the footer.

### Recording tips
- 60 – 120 seconds is plenty.
- Keep narration clear; Google reviewers skim.
- Upload to **YouTube** as **Unlisted** and paste the link in the form.
- Don't use a throwaway Google account the reviewer can't reach — use the
  dev contact address.

### Suggested script (read verbatim if you want)

> Hi, this is DriveStat, a client-side Google Drive visualizer at
> drivestat.app. I'm going to sign in with Google.
> [click Sign in with Google]
> You can see the consent screen shows the drive.file scope. I'll accept.
> [accept]
> Now I click Scan Drive. DriveStat uses the drive.file scope to call
> files.list and reads only metadata — filenames, sizes, MIME types, and
> the folder hierarchy. Nothing is downloaded, nothing is sent to any
> server we control. Everything you see is rendered from metadata in the
> browser.
> [show treemap + list]
> Clicking a file shows its details. "Open in Drive" opens Google's own
> Drive UI — DriveStat never opens file contents itself.
> [click Open in Drive]
> "Move to Trash" sets trashed=true on the selected file via files.update.
> That's the only write the app ever does, and only on explicit user
> action.
> [click Move to Trash, show confirmation]
> The privacy policy in the footer explains that nothing is collected,
> nothing is transmitted, and there are no analytics or trackers.
> Thanks for reviewing.

---

## 4. Domain verification

Before the consent screen lets you list `drivestat.app` as an authorized
domain, you must verify it in Google Search Console:

1. Go to https://search.google.com/search-console/welcome
2. Add **drivestat.app** as a Domain property (DNS TXT verification) or
   **https://drivestat.app** as a URL-prefix property (HTML file or meta
   tag verification).
3. If using the HTML file method, Google will give you a file like
   `googleXXXXXXXXXXXXXXXX.html`. Drop it in the repo root and deploy.
4. Wait for "Ownership verified" ✅.

Once verified, the Cloud Console will accept `drivestat.app` in the
Authorized domains list.

---

## 5. Post-verification checklist

- [ ] OAuth consent screen published (not in Testing)
- [ ] Privacy policy live at https://drivestat.app/privacy.html
- [ ] Terms live at https://drivestat.app/terms.html
- [ ] App domain `drivestat.app` verified in Search Console
- [ ] Authorized JavaScript origins in the OAuth client = production URL only (NOT localhost) for the production client ID
- [ ] Separate **dev** OAuth client for localhost/127.0.0.1 (keep it in Testing mode forever)
- [ ] Demo video unlisted on YouTube and linked in the form
- [ ] Logo uploaded (square, 120×120 PNG min)
- [ ] Support email auto-responder so the reviewer's questions get answered within the 3-day window — Google will re-open the case if you miss their reply

---

## 6. What happens if you don't verify

You can still use the app with the drive.file scope, but users will see an
"unverified app" warning screen with a yellow triangle and an
"Advanced → Go to app (unsafe)" expand. This warning disappears only
after verification. There is a **100 unique users** cap on unverified
sensitive-scope apps before Google will start blocking new grants.

---

## 7. If you ever add restricted scopes

Scopes like `drive`, `drive.readonly`, `drive.metadata.readonly`, and
`drive.metadata` are **restricted** — they trigger the full CASA
(Cloud Application Security Assessment), which costs money, requires an
annual audit, and can take months. Stay on `drive.file` if at all possible.
