# EcoSapien — Paper, thread, and wire

Artist portfolio hosted on GitHub Pages at [www.ecosapien.de](https://www.ecosapien.de/).

The homepage presents watercolour, charcoal, embroidery and filigree-wire jewellery. Artwork photographs have not been supplied yet, so the first published version identifies the three collections as being prepared.

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
- studio.html: browser editor and export tool.
- 404.html: missing-page screen.
- assets/favicon.svg: existing EcoSapien mark in the portfolio colours.
- assets/og-image.svg: updated brand graphic.
- robots.txt, sitemap.xml, llms.txt: discoverability.
- CNAME: existing www.ecosapien.de domain.
- .nojekyll: serve the static files directly.

No build tools or dependencies are required. You can preview the directory with python3 -m http.server 8000 and open http://localhost:8000/.

The original sustainability website remains in Git history before this replacement.
