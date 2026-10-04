# EcoSapien — Paper, thread, and wire

Artist portfolio hosted on GitHub Pages at [www.ecosapien.de](https://www.ecosapien.de/).

The homepage presents watercolour, charcoal, embroidery and filigree-wire jewellery. Artwork photographs have not been supplied yet, so the first published version identifies the three collections as being prepared.

## Study applications

The [Art application page](https://www.ecosapien.de/applications.html) publishes the 24-programme European art research comparison alongside the portfolio. Search by school, programme or material; filter by country and research priority; follow the official admissions links; or download the CSV.

The research was checked on 1 October 2026. Fees generally refer to 2026–27 and the ordinary non-EU fee category. Pending dates, uncertain qualification equivalence and unverified costs remain explicitly marked. The page does not submit applications.

The [All applications page](https://www.ecosapien.de/all-applications.html) adds a broad German public-university master's comparison for a Home Science / interior design background. The research snapshot is **4 October 2026**. Each route records the subject and qualification conditions, English/German requirements, intake, deadline evidence, tuition, semester contribution, additional costs and official sources. Courses needing an IELTS retake remain visible; mandatory work-experience barriers are separated. No suitable open winter 2026/27 route was verified for the stated profile. This is not an admission decision or a complete census of every German programme.

Search and filter by subject, intake, language and tuition. Both research catalogues are public and link each programme to its workspace entry. All account controls now live on the separate [Databases page](https://www.ecosapien.de/databases.html). Old `all-applications.html#login` links redirect there. The standalone offline HTML supports public research and filtering, with links to the hosted Databases page.

**Combined dashboard:** Databases contains 149 unique programmes from the 128 master’s routes and 24 art routes. Three overlapping entries share their existing master’s IDs, progress and folders. Google sign-in loads tracked applications, stages, notes, deadline overrides and document checklists from your Drive. The overview shows tracked applications, pending preparation, deadlines within 30 days, submissions and offers. Document-readiness charts count ready/submitted checklist slots, excluding **Not required**; a linked file alone does not mark work complete. The six-month deadline chart distinguishes published or user-confirmed dates from planning dates. Clicking a total, stage or month filters the list. Unknown dates remain unknown. Signed-out statistics display no private progress.

**Private documents:** beside each programme’s progress bar, choose a document type and use **Upload**, **Download** or **Open selected file**. **Manage documents, notes & deadline** opens its full checklist. Upload slots cover CV, statement, portfolio/proposal, degree, transcript, English, APS, reference and work evidence. **Shared resources** supplies reusable files; programme-specific files take priority. New uploads go to **EcoSapien Applications / programme / document type / file**, or **Shared documents / document type / file**, in your own My Drive using the narrow `drive.file` permission. Existing files and links are retained. Files up to 100 MB use resumable uploads. Replacement creates a new file and preserves its predecessor. Download returns original binary files or exports supported Google documents as PDF. Existing pasted links created outside the workspace may need **Open in Drive** because `drive.file` does not grant access to every Drive file. Follow each university’s exact document list; uploading here does not submit an application.

**Exports:** **Export filtered CSV + notes** includes all matching rows, including those beyond the visible page. **Back up progress** downloads private JSON containing notes, checklists, deadline overrides and file links. These exports do not contain document file contents. Personal edits never publish to GitHub.

**Connection setup:** follow [google-drive-setup.html](https://www.ecosapien.de/google-drive-setup.html) to enable Drive API and create a Google OAuth **Web application** client with `https://www.ecosapien.de` as an authorised JavaScript origin. Put the public ID in `assets/google-drive-config.js`, or paste it into the sign-in window for a browser-only setting. The repository intentionally has no client ID until the owner configures one. Never add a client secret, refresh token, service-account JSON or personal documents to this public repository. A chat connector does not configure website OAuth.

**Session and privacy:** access tokens, private state and unsaved edits stay in page memory only. Sign-out clears the private UI, aborts requests and fences late OAuth/Drive callbacks. Reconnecting to a different Google account is rejected until the user signs out. Google controls access to each account’s actual Drive data; a cosmetic local password is not used. App destinations are checked for ownership, expected parent and owner-only folder permissions. Existing pasted links retain their existing Google sharing settings. The public catalogue and portfolio studio remain public. See [application-privacy.html](https://www.ecosapien.de/application-privacy.html).

**Autosave and concurrency:** edits are coalesced after 1.4 seconds and saved as immutable JSON field-change records in **Tracker history**. Drive server creation times determine replay order (file ID breaks ties). Changes to different fields from concurrent devices survive; the latest save to the same field wins. Autosave retries reuse a generated Drive file ID, so a lost response cannot create a duplicate revision. Current-session acknowledged saves remain visible while Drive indexing catches up. All save records are retained for recovery; no automatic deletion or compaction is performed. Loading a long history costs more API requests; do not manually prune it without preserving a complete backup. **Sync now** refreshes an already-open page. Failed saves stay in memory with Retry and backup controls; closing or signing out with unfinished work prompts the user. Google access expires periodically and requires a user-triggered reconnect.

**Migration and backups:** versions 1, 2 and 3 are accepted. A backup includes private notes, checklists and links, not file contents or tokens. Version 1 restores stages/notes while preserving newer document work; versions 2/3 replace matching entries and the supplied shelf, retaining unmatched entries. The old `ecosapien-all-applications-v1` browser copy is never automatically loaded into the private UI or imported into an arbitrary signed-in account. The user chooses migration to the displayed account; its local copy is removed only after a confirmed Drive save. Until migrated or manually removed, older local notes remain unprotected on that browser. The only new persistent browser setting is an optional public OAuth client ID.

The maintained master’s dataset is `data/all-applications.json`; art research is in `programmes.csv` with stable IDs and verified date mappings in `data/art-application-map.json`. Run `python3 tools/build_applications.py` to regenerate the master’s HTML, CSV (UTF-8 BOM for Excel), offline HTML, combined `data/databases.json`, and `databases.html`. The generator also maintains dashboard links on art cards. The dashboard template is `tools/templates/databases.html`. Keep published dates separate from projected annual dates; do not silently treat an unknown fee as zero. `assets/all-applications.js` handles public research filters; `application-model.js` defines progress/date rules; `databases.js` renders the combined workspace; `application-account.js` handles sign-in and autosave; `drive-workspace.js` handles authenticated Drive requests. Styles extend the existing site theme.

**Validation:** run `node tools/tests/check_application_model.mjs` and `node tools/tests/check_drive_workspace.mjs` for catalogue, date/readiness and API-state checks with synthetic Drive responses. For UI checks, serve this directory on `http://127.0.0.1:8765`, create an isolated Firefox profile directory, launch Firefox with `--headless --no-remote --profile <directory> --marionette`, then run `python3 tools/tests/check_private_workspace.py`. Marionette uses local port 2828. Tests cover private-data clearing, migration recovery, correct programme/slot destinations, original-byte downloads, native PDF exports, cancellation, replacement retention, backup/export, account separation, token expiry, chart filters, responsive layout, navigation and offline research. All OAuth and Drive responses are mocked. Real Google consent, quota and authorised origins need verification with the owner’s configured Google client before calling that integration live-tested.

## Update your portfolio

1. Open [the portfolio studio](https://www.ecosapien.de/studio.html).
2. Edit the introduction and add your own photographs, captions and process notes. If you have a JSON backup from the local portfolio studio, use **Restore backup**.
3. Use **Save backup** to download an editable JSON copy.
4. Use **Download website** to download index.html.
5. Replace the repository's root index.html with that download and commit to the Pages publishing branch. Keep CNAME intact.
6. Wait for GitHub Pages to deploy, then reload the public site.

The studio stores drafts only in your browser. Editing it does not change the published website. Visitors cannot publish changes through the studio. The studio is a public editing tool, not an authenticated administration panel; do not treat its URL as private.

Keep your JSON backup and original photographs. Clearing browser storage can remove local drafts. The web images are resized to a maximum of 2000 pixels on the longest side. Each project can contain up to 12 JPEG, PNG or WebP photographs.

## Files

- index.html: public portfolio; styles, scripts and portfolio data are embedded.
- studio.html: browser editor and export tool; exported pages retain application and Databases navigation links.
- applications.html: European art study routes and official application information.
- programmes.csv: the downloadable art comparison.
- all-applications.html: public German master’s programme comparison.
- databases.html: combined art/master’s dashboard and private Google Drive workspace.
- all-applications.csv and all-applications-offline.html: full research downloads.
- data/all-applications.json and tools/build_applications.py: maintained master’s research and generator.
- data/art-application-map.json, data/databases.json, tools/build_databases.py and tools/templates/databases.html: combined catalogue, stable IDs and dashboard generator.
- assets/all-applications.css and assets/all-applications.js: public master’s comparison presentation and filters.
- assets/application-model.js, assets/databases.js and assets/databases.css: dashboard state rules, UI and layout.
- assets/google-drive-config.js, assets/drive-workspace.js and assets/application-account.js: public OAuth configuration, Drive client and private account UI.
- google-drive-setup.html, application-privacy.html and assets/workspace-guide.css: setup and privacy information.
- tools/tests/: synthetic Drive/OAuth tests; no real credentials or personal files.
- assets/applications.css and assets/applications.js: application-page presentation and filters.
- 404.html: missing-page screen.
- assets/favicon.svg: existing EcoSapien mark in the portfolio colours.
- assets/og-image.svg: updated brand graphic.
- robots.txt, sitemap.xml, llms.txt: discoverability.
- CNAME: existing www.ecosapien.de domain.
- .nojekyll: serve the static files directly.

No build tools or dependencies are required. You can preview the directory with python3 -m http.server 8000 and open http://localhost:8000/.

The original sustainability website remains in Git history before this replacement.
