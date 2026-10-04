# EcoSapien — Paper, thread, and wire

Artist portfolio hosted on GitHub Pages at [www.ecosapien.de](https://www.ecosapien.de/).

The homepage presents watercolour, charcoal, embroidery and filigree-wire jewellery. Artwork photographs have not been supplied yet, so the first published version identifies the three collections as being prepared.

## Study applications

The [Art application page](https://www.ecosapien.de/applications.html) publishes the 24-programme European art research comparison alongside the portfolio. Search by school, programme or material; filter by country and research priority; follow the official admissions links; or download the CSV.

The research was checked on 1 October 2026. Fees generally refer to 2026–27 and the ordinary non-EU fee category. Pending dates, uncertain qualification equivalence and unverified costs remain explicitly marked. The page does not submit applications.

The [All applications page](https://www.ecosapien.de/all-applications.html) adds a broad German public-university master's comparison for a Home Science / interior design background. The research snapshot is **4 October 2026**. Each route records the subject and qualification conditions, English/German requirements, intake, deadline evidence, tuition, semester contribution, additional costs and official sources. Courses needing an IELTS retake remain visible; mandatory work-experience barriers are separated. No suitable open winter 2026/27 route was verified for the stated profile. This is not an admission decision or a complete census of every German programme.

Search and filter by subject, intake, language and tuition. Both research catalogues are public and link each programme to its workspace entry. All account controls now live on the separate [Databases page](https://www.ecosapien.de/databases.html). Old `all-applications.html#login` links redirect there. The standalone offline HTML supports public research and filtering, with links to the hosted Databases page.

**Shared dashboard:** Databases combines 149 unique programmes from the 128 master’s routes and 24 art routes. Three overlaps reuse their existing IDs. Its progress totals, document-readiness ring, art/master’s bars and six-month deadline chart use the authenticated shared workspace. Ready/submitted slots count toward preparation; “Not required” slots are excluded. A file link alone never marks a slot complete. Published, user-confirmed, planning and unknown deadlines remain distinct.

**Accounts and storage:** Supabase Auth provides individual email/password website accounts. Only confirmed, invited accounts can join the workspace. The owner grants editor or viewer access from **People & agents**. Invitations reserve access for 30 days and do not send email. Editors share progress and documents; viewers can read/download. Membership is enforced in PostgreSQL and Storage, including for agent accounts. Supabase project administrators retain separate administrative access. The public portfolio studio remains public.

**Private documents:** Upload/download controls sit beside each programme’s progress bar and in its full checklist. Slots cover CV, statement, portfolio/proposal, degree, transcript, language, APS, reference and employment. Shared resources supply reusable files; programme files take priority. Each upload writes an immutable version into the private `application-documents` bucket, under workspace/application/slot/UUID. Files up to 50 MiB use TUS with 6 MiB chunks and retry within the open page. Upload metadata is not persisted in browser storage. Older versions remain downloadable and can be selected again. The server verifies an upload’s existence, size and MIME type before attaching it and marking its slot Ready. **Unfinished uploads → Finish linking** recovers a file whose bytes arrived but attachment did not finish. An incomplete file must be selected and uploaded again. Old Google Drive links remain references; no binary migration is implied. Uploading does not submit university applications.

**Attribution and sync:** The activity feed shows the latest 50 events, with person/agent identity supplied by the server. All history remains in PostgreSQL, including before/after field values. Realtime notifications trigger a refresh; a visible page also refreshes every 30 seconds. Progress saves after a 1.4-second debounce as individual fields. Different fields merge; the latest committed update to the same field wins. Retry reuses the same request UUID, so a lost response cannot duplicate a write. Slow refreshes cannot roll back newer acknowledged saves. Unsaved edits are merged over incoming updates and remain in page memory. Retry and progress backup controls are available after failures.

**Sessions and privacy:** Tokens, private state and pending edits are held in memory; `persistSession` is false. Reload normally requires sign-in. Account-confirmation and password-reset callbacks can establish a new in-memory session. Sign-out clears private fields, file/version lists, activity, members and credentials, aborts requests and fences late responses. Removed membership causes the UI to clear when the next request is denied. Downloads use authenticated Storage requests, not permanently public URLs. Downloaded copies, older browser records and other members’ copies are outside sign-out’s reach. See [application-privacy.html](https://www.ecosapien.de/application-privacy.html).

**Connection setup:** Follow [supabase-setup.html](https://www.ecosapien.de/supabase-setup.html). Apply the two migrations in `supabase/migrations/`, run a privately filled-in copy of `supabase/bootstrap-owner.example.sql`, configure confirmed email authentication and exact website redirect URLs, then fill `assets/supabase-config.js` with the project URL, public publishable/anon key and workspace UUID. Never commit a filled owner bootstrap, personal email address, password, session token, secret key, service-role key or document. The configuration rejects secret/service-role keys. The default Supabase mail service is restricted to organisation-team recipients; ordinary invitations/password resets require configured SMTP or individually verified administrator-created accounts. Keep email confirmation enabled. The bucket must stay private, with no broader overlapping Storage policies.

**Agent access:** Create a dedicated confirmed Auth account and invite it as **Agent**, normally with editor access. Store its configuration and credentials in a private environment file outside this repository, permission `0600`:

```text
ECOSAPIEN_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
ECOSAPIEN_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
ECOSAPIEN_WORKSPACE_ID=YOUR_WORKSPACE_UUID
ECOSAPIEN_AGENT_EMAIL=YOUR_DEDICATED_AGENT_EMAIL
ECOSAPIEN_AGENT_PASSWORD=YOUR_DEDICATED_AGENT_PASSWORD
```

Run `node --env-file=/absolute/private/agent.env tools/agent_workspace.mjs status`. Commands include `changes --after ID`, `snapshot --out /private/path.json`, `save --changes /private/changes.json`, `upload --record PROGRAMME_ID --slot cv --file /private/CV.pdf`, and `download --id FILE_UUID --out /private/CV.pdf`. A change file is an array such as `[{"record_id":"trier-gemstones","field":"stage","value":"Preparing"}]`. The helper refuses person accounts, admin keys and exports into the public website; output files are private and never overwritten. For lost-response retries, reuse the printed request/upload UUID with the same data. Agent actions use the same RPCs, RLS and attribution as the browser. Connecting a chat does not provision this member or start continuous monitoring.

**Migration and exports:** Private JSON backup version 4 contains the workspace ID, progress, checklists, deadlines, native file UUIDs and legacy Drive links. It contains no document bytes or credentials, and native file references can be restored only within their original workspace. Backups 1–3 remain compatible: v1 updates basic progress while preserving newer document work; v2/3 replace matching entries and any supplied library, retaining unmatched entries. The old `ecosapien-all-applications-v1` browser copy is never loaded automatically or imported into an arbitrary account. Import is explicit, warns that members will see it, and removes the local copy only after a confirmed save. CSV exports include every filtered row, private notes and file IDs when signed in, with formula cells neutralised. Binary documents need a separate backup. Supabase storage/bandwidth allowances apply independently of Google storage; all versions consume space.

**Build:** The site is static and the vendored browser SDK is committed, so serving it needs no build. To update dependencies, run `npm ci` and `npm run build:vendor`; exact Supabase/TUS versions and the lockfile are tracked, with third-party notices in `assets/vendor/LICENSES.txt`. The maintained research is `data/all-applications.json` and `programmes.csv`, with art mapping in `data/art-application-map.json`. Run `python3 tools/build_applications.py` to regenerate HTML/CSV/offline research and the Databases page from `tools/templates/databases.html`. No new research is part of the Supabase change.

**Validation:** `npm test` checks the combined catalogue/readiness/date rules, applies the actual migrations to PostgreSQL in PGlite, tests anonymous/uninvited/cross-workspace RLS, viewers, invitations, attribution, revocation, idempotent saves, private upload validation and immutable file history, and exercises the browser client with a synthetic SDK. For UI checks, serve this directory on `http://127.0.0.1:8765`, create an isolated Firefox profile, launch `firefox --headless --no-remote --profile /tmp/PROFILE --marionette`, and run `python3 tools/tests/check_private_workspace.py`. The UI test creates and removes an ignored HTML fixture, uses synthetic accounts/files and covers private-data clearing, migration retries, uploads/downloads, versions, agent updates, lost-response recovery, permissions, charts, exports and narrow layouts. Local tests do not replace live checks of Supabase email, Auth, Realtime, Storage/TUS, quota and website redirects. Verify these with the configured project before deployment.

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
- databases.html: combined art/master’s dashboard and shared Supabase workspace.
- all-applications.csv and all-applications-offline.html: full research downloads.
- data/all-applications.json and tools/build_applications.py: maintained master’s research and generator.
- data/art-application-map.json, data/databases.json, tools/build_databases.py and tools/templates/databases.html: combined catalogue, stable IDs and dashboard generator.
- assets/all-applications.css and assets/all-applications.js: public master’s comparison presentation and filters.
- assets/application-model.js, assets/databases.js and assets/databases.css: dashboard state rules, UI and layout.
- assets/supabase-config.js, assets/supabase-workspace.js and assets/application-account.js: public connection configuration, Supabase client and private account UI.
- assets/vendor/, package.json, package-lock.json and tools/build_vendor.mjs: pinned browser dependencies, bundle and licences.
- supabase/migrations/, supabase/bootstrap-owner.example.sql and tools/agent_workspace.mjs: database setup and scoped agent access.
- supabase-setup.html, application-privacy.html and assets/workspace-guide.css: current setup and privacy information.
- google-drive-setup.html and assets/drive-workspace.js: retained legacy Drive integration reference; not loaded by Databases.
- tools/tests/: PostgreSQL/RLS and synthetic SDK/UI tests; no real credentials or personal files.
- assets/applications.css and assets/applications.js: application-page presentation and filters.
- 404.html: missing-page screen.
- assets/favicon.svg: existing EcoSapien mark in the portfolio colours.
- assets/og-image.svg: updated brand graphic.
- robots.txt, sitemap.xml, llms.txt: discoverability.
- CNAME: existing www.ecosapien.de domain.
- .nojekyll: serve the static files directly.

No build step is required to serve the committed static site. You can preview the directory with python3 -m http.server 8000 and open http://localhost:8000/.

The original sustainability website remains in Git history before this replacement.
