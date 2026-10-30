# Clinched

Every Formula One title fight since 1950, scrubbed race by race. Static site with no build step.

    python3 -m http.server 8240

## Refresh the data

Download `f1db-csv.zip` from the latest [F1DB release](https://github.com/f1db/f1db/releases), unzip it, then:

    python3 build_data.py /path/to/unzipped/csv
    SITE_URL=https://your-domain python3 build_pages.py

The script prints how many final totals disagree with the official table. That number should be 0.

`template.html` is the source for the home and season pages. Edit it, not the generated `index.html` files, then re-run `build_pages.py`. That script also rewrites the guides, `sitemap.xml`, `robots.txt`, `llms.txt` and the share images in `og/`.

## Turn on ads

Follow the three steps at the top of `ads.js`, and fill in `ads.txt`. EU, UK and Swiss visitors also need a Google-certified consent banner, which you can switch on under Privacy & messaging in AdSense.

Data: F1DB, CC BY 4.0. Keep the credit in the footer.
