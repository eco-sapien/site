# EcoSapien — Paper, thread, and wire

Artist portfolio hosted on GitHub Pages at [www.ecosapien.de](https://www.ecosapien.de/).

The homepage presents watercolour, charcoal, embroidery and filigree-wire jewellery. Artwork photographs have not been supplied yet, so the first published version identifies the three collections as being prepared.

## Study applications

The [Art application page](https://www.ecosapien.de/applications.html) publishes the 24-programme European art research comparison alongside the portfolio. Search by school, programme or material; filter by country and research priority; follow the official admissions links; or download the CSV.

The research was checked on 1 October 2026. Fees generally refer to 2026–27 and the ordinary non-EU fee category. Pending dates, uncertain qualification equivalence and unverified costs remain explicitly marked. The page does not submit applications.

The [All applications page](https://www.ecosapien.de/all-applications.html) adds a broad German public-university master's comparison for a Home Science / interior design background. The research snapshot is **4 October 2026**. Each route records the subject and qualification conditions, English/German requirements, intake, deadline evidence, tuition, semester contribution, additional costs and official sources. Courses needing an IELTS retake remain visible; mandatory work-experience barriers are separated. No suitable open winter 2026/27 route was verified for the stated profile. This is not an admission decision or a complete census of every German programme.

Search and filter by subject, intake, language and tuition. Save a shortlist, application stages and notes in the current browser. **Export filtered CSV + notes** includes all matching records, including cards beyond the first visible page. **Back up progress** downloads a JSON file that can be restored on another browser/device. These edits never publish to GitHub. Clearing browser storage removes local progress. The standalone offline HTML contains the research and tracker; move personal notes with the separate progress backup.

**Private documents:** open Google Drive to upload files into a folder with sharing set to **Restricted**. Save its link in the document shelf. The shelf can hold reusable CV, statement, portfolio/proposal, degree, transcript, English, APS, reference and work-evidence links. Each programme has its own folder, document links and checklist statuses, with shelf links used as defaults. Mark unused document slots **Not required** and follow the university’s actual upload list. Marking a document ready does not submit an application or establish eligibility.

This static page stores links and progress in the browser; it does not upload files to Drive, hold Google credentials or synchronise automatically. A progress backup includes private notes, checklists and links, not document files. Store it privately. The tracker retains the original local-storage key and accepts version 1 and version 2 backups. Restoring an older version 1 backup updates stages/notes without erasing newer document work. A version 2 restore replaces matching programme entries; unmatched entries remain. Personal CVs, letters, addresses and source documents must never be committed to this public repository.

The maintained dataset is `data/all-applications.json`. To update the comparison, edit that file, review the sources and run `python3 tools/build_applications.py`. This regenerates `all-applications.html`, `all-applications.csv` (UTF-8 BOM for Excel) and `all-applications-offline.html`. Keep published dates separate from projected annual dates; do not silently treat an unknown fee as zero. `assets/all-applications.js` handles local progress and filters; `assets/all-applications.css` extends the existing application-page theme.

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
- studio.html: browser editor and export tool; exported pages retain both application navigation links.
- applications.html: European art study routes and official application information.
- programmes.csv: the downloadable art comparison.
- all-applications.html: German public-university master's comparison and local application tracker.
- all-applications.csv and all-applications-offline.html: full research downloads.
- data/all-applications.json and tools/build_applications.py: maintained research data and dependency-free generator.
- assets/all-applications.css and assets/all-applications.js: master's comparison and tracker.
- assets/applications.css and assets/applications.js: application-page presentation and filters.
- 404.html: missing-page screen.
- assets/favicon.svg: existing EcoSapien mark in the portfolio colours.
- assets/og-image.svg: updated brand graphic.
- robots.txt, sitemap.xml, llms.txt: discoverability.
- CNAME: existing www.ecosapien.de domain.
- .nojekyll: serve the static files directly.

No build tools or dependencies are required. You can preview the directory with python3 -m http.server 8000 and open http://localhost:8000/.

The original sustainability website remains in Git history before this replacement.
