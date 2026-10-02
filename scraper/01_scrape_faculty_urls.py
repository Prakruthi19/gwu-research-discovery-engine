"""
Stage 1 — collect faculty "seeds" (name + profile URL + school) from every
enabled source in sites.py, writing data/faculty_urls.json.

Two strategies run here:

  facultyprofiles_api
    The research portal is a React app with NO stable CSS classes. But it's
    backed by `POST /api/users`, which returns every indexed expert in JSON —
    including research-interest TAGS, title, department and school. We grab all
    of that now (it's the richest source and feeds the cross-match in stage 2).
    The site reports a hard total of 54; we page through with perPage=100.

  linked
    A Drupal directory whose listing links to one profile page per person. We
    load each listing URL, collect links matching the site's
    `profile_href_pattern`, and resolve them to absolute URLs. Stage 2 visits
    each page for the remaining fields.

Run:  python scraper/01_scrape_faculty_urls.py
"""

import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
from sites import SiteConfig, enabled_sites  # noqa: E402


# --- Strategy: facultyprofiles_api -----------------------------------------
async def collect_facultyprofiles(page, site: SiteConfig) -> list[dict]:
    """Pull every indexed expert from the portal's JSON API (with tags)."""
    if not await common.goto_settled(page, f"{site.base_url}/search"):
        return []

    seeds: list[dict] = []
    start_from = 0
    per_page = 100
    while True:
        payload = {
            "params": {"by": "text", "category": "user"},
            "pagination": {"startFrom": start_from, "perPage": per_page},
        }
        result = await page.evaluate(
            """async ({base, body}) => {
                const r = await fetch(base + '/api/users', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(body),
                });
                if (!r.ok) return {error: r.status};
                const j = await r.json();
                return {total: j.pagination.total, resource: j.resource || []};
            }""",
            {"base": site.base_url, "body": payload},
        )
        if "error" in result:
            print(f"    ! API error {result['error']}")
            break

        for u in result["resource"]:
            slug = u.get("discoveryUrlId")
            if not slug:
                continue
            tags = [t.get("value") for t in (u.get("tags") or {}).get("explicit", []) if t.get("value")]
            positions = u.get("positions") or []
            seeds.append(
                {
                    "name": u.get("firstNameLastName") or "N/A",
                    "profile_url": f"{site.base_url}/{slug}",
                    "school": (u.get("customFilterOne") or [None])[0],
                    "source": site.key,
                    # Pre-filled rich fields from the API (rare luxury):
                    "title": positions[0].get("position") if positions else None,
                    "department": positions[0].get("department") if positions else None,
                    "research_interests": tags,
                    "has_thumbnail": bool(u.get("hasThumbnail")),
                }
            )

        start_from += per_page
        if start_from >= result["total"]:
            break

    return seeds


# --- Strategy: linked ------------------------------------------------------
async def collect_linked(page, site: SiteConfig) -> list[dict]:
    """Collect profile links from a Drupal directory listing."""
    pattern = re.compile(site.profile_href_pattern, re.IGNORECASE)
    seeds: dict[str, dict] = {}

    for listing_url in site.listing_urls:
        if not await common.goto_settled(page, listing_url):
            continue
        from urllib.parse import urlparse

        origin = "{0.scheme}://{0.netloc}".format(urlparse(listing_url))
        cards = await page.evaluate(
            """(pat) => {
                const re = new RegExp(pat, 'i');
                const out = [];
                for (const a of document.querySelectorAll('a[href]')) {
                    const href = a.getAttribute('href');
                    if (href && re.test(href)) {
                        out.push({href, name: (a.innerText || '').trim()});
                    }
                }
                return out;
            }""",
            pattern.pattern,
        )
        for c in cards:
            url = origin + c["href"]
            name = c["name"]
            # Listing link text is sometimes empty (image link); keep best name.
            if url not in seeds or (not seeds[url]["name"] and name):
                seeds[url] = {
                    "name": name or "N/A",
                    "profile_url": url,
                    "school": site.school,
                    "source": site.key,
                }
        print(f"    {listing_url} -> {len(cards)} links")

    return list(seeds.values())


STRATEGIES = {
    "facultyprofiles_api": collect_facultyprofiles,
    "linked": collect_linked,
}


async def main() -> None:
    all_seeds: list[dict] = []
    async with common.browser_page() as page:
        for site in enabled_sites():
            handler = STRATEGIES.get(site.strategy)
            if handler is None:
                print(f"[skip] {site.key}: strategy '{site.strategy}' not implemented")
                continue
            print(f"[{site.key}] strategy={site.strategy}")
            seeds = await handler(page, site)
            print(f"    collected {len(seeds)} seeds")
            all_seeds.extend(seeds)

    common.write_json(common.URLS_FILE, all_seeds)
    print(f"\n[done] {len(all_seeds)} faculty seeds -> {common.URLS_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
