# R1 search-engine indexing policy

In-product discovery (Latest Links and exact search) must not become
search-engine indexing of link-card data. Feature Inventory Order 79.

## Policy by page

| Page or response | Indexable | Mechanism |
| --- | --- | --- |
| `index.html` (Make Link) | Yes | Listed in `sitemap.xml`. |
| Legal pages (when added) | Yes | Add to `sitemap.xml`. |
| `latest.html` (Latest Links and search) | No | `<meta name="robots" content="noindex, nofollow">`. Not blocked in `robots.txt`, so crawlers can read the tag. |
| Search results | No | The query never enters the page URL, so there is no result URL to index. |
| `admin.html` | No | `noindex, nofollow` meta tag and `Disallow: /admin` in `robots.txt`. |
| Short host `op4n.me` (redirects, not-found and unavailable pages) | No | The Worker sends `X-Robots-Tag: noindex, nofollow` on every response and serves `robots.txt` with `Disallow: /`. |
| Unlisted, inactive, withheld, or sensitive links | No | Never listed or rendered on any indexable page. |
| `discover.html`, `showcase/*` | PENDING | Follows the launch decision in Order 95. |
| Any Staging host | No | The deploy replaces `robots.txt` with `Disallow: /`, removes `sitemap.xml`, and adds `X-Robots-Tag: noindex, nofollow` to every page via `_headers`. |

Checks: `tests/prototype-smoke.mjs` asserts the meta tags on `latest.html`
and `admin.html`. `tests/server/redirect-worker.test.mjs` covers the Worker
headers and `robots.txt`. `tests/staging-smoke.mjs` checks Staging robots.

## Removing content indexed in error

1. Confirm the page now sends `noindex` (meta tag or `X-Robots-Tag`) and is
   not blocked in `robots.txt`; a blocked page cannot be de-indexed by crawl.
2. In Google Search Console for the `op4n.com` or `op4n.me` property, open
   **Removals → New request → Temporarily remove URL** and submit the exact URL
   or prefix. This hides it for about six months.
3. Use **URL Inspection → Request indexing** so the crawler sees the `noindex`.
4. For a link that should not exist publicly at all, disable it from Admin;
   the short link then shows the unavailable page.
5. Record the URL, date, and reason in the support log; reply from
   support@op4n.com if a person reported it.
