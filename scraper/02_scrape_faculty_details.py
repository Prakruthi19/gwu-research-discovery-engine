"""
Stage 2 — visit each seed's profile page, extract the remaining fields, then
cross-match research interests, and write data/faculty_details.json (the file
the server's seed.js consumes).

Two detail extractors, dispatched by the seed's `source`:

  facultyprofiles  (the research portal)
    Title / department / research interests already came from the API in stage 1.
    Here we only need what isn't in the API: email (mailto) and bio (the ABOUT
    "whitebox", found via stable data-qa attributes — the only reliable hooks
    on this hashed-class React app).

  linked  (Drupal directories, e.g. GSEHD)
    Extract name / title / department / bio / image / email using the ordered
    SELECTOR_CANDIDATES in sites.py, failing soft to None. With DEBUG_DUMP_HTML=1
    any weakly-extracted page is dumped to scraper/debug_html/ for tuning.

Cross-match
    The 54 portal experts are the ONLY source of curated research tags. We build
    a normalized-name -> tags index from them and attach those tags to ANY
    faculty (e.g. a GSEHD person who's also a research-active expert) whose name
    matches. Directory faculty with no match keep an empty interest list — search
    still matches their department/title/bio text.

Run:
  python scraper/02_scrape_faculty_details.py
  DEBUG_DUMP_HTML=1 SCRAPE_LIMIT=5 python scraper/02_scrape_faculty_details.py   # tuning
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common  # noqa: E402
from sites import SITES  # noqa: E402

SELECTORS_BY_SOURCE = {s.key: s.selectors for s in SITES}

# For tuning: cap how many profiles we visit. 0 = no limit (full run).
SCRAPE_LIMIT = int(os.environ.get("SCRAPE_LIMIT", "0"))


# --- Detail extractor: facultyprofiles -------------------------------------
async def detail_facultyprofiles(page, seed: dict) -> dict:
    """Add email + bio from the portal profile page (tags/title came from API)."""
    record = dict(seed)
    record["email"] = await common.email_on_page(page)
    # The ABOUT section is a "whitebox" div; grab its body text minus the header.
    bio = await page.evaluate(
        r"""() => {
            const boxes = [...document.querySelectorAll('div[data-qa~="whitebox"]')];
            const about = boxes.find(d => {
                const h = d.querySelector('h2[data-qa="whiteBoxHeaderText"]');
                return h && h.innerText.trim().toUpperCase() === 'ABOUT';
            });
            if (!about) return null;
            const header = about.querySelector('h2');
            const full = (about.innerText || '').trim();
            // Strip the leading "ABOUT" heading line.
            return full.replace(/^ABOUT\s*/i, '').trim() || null;
        }"""
    )
    record["bio"] = bio
    img = await common.first_attr(
        page, ["img[src*='profile']", "main img", "article img"], "src"
    ) if seed.get("has_thumbnail") else None
    record["image_url"] = common.absolute_url(seed["profile_url"], img)
    record.pop("has_thumbnail", None)
    return record


# --- Detail extractor: linked (Drupal) -------------------------------------
async def detail_linked(page, seed: dict) -> dict:
    """Extract fields from a Drupal profile page via candidate selectors."""
    sel = SELECTORS_BY_SOURCE.get(seed["source"], {})
    record = dict(seed)

    name = await common.first_text(page, sel.get("name", ["h1"]))
    record["name"] = name or seed.get("name") or "N/A"
    record["title"] = await common.first_text(page, sel.get("title", []))
    record["department"] = await common.first_text(page, sel.get("department", []))
    record["bio"] = await common.first_text(page, sel.get("bio", []))
    record["email"] = await common.email_on_page(page)
    img = await common.first_attr(page, sel.get("image", []), "src")
    record["image_url"] = common.absolute_url(seed["profile_url"], img)
    record.setdefault("research_interests", [])
    return record


def extractor_for(seed: dict):
    """Pick a detail extractor by the seed's source/strategy."""
    if seed["source"] == "facultyprofiles":
        return detail_facultyprofiles
    return detail_linked


def build_tag_index(seeds: list[dict]) -> dict[str, list[str]]:
    """normalized-name -> research interests, from the portal experts only."""
    index: dict[str, list[str]] = {}
    for s in seeds:
        if s.get("source") == "facultyprofiles" and s.get("research_interests"):
            key = common.normalize_name(s.get("name"))
            if key:
                index[key] = s["research_interests"]
    return index


def is_weak(record: dict) -> bool:
    """True if extraction looks incomplete (used to trigger debug HTML dumps)."""
    return not record.get("email") and not record.get("bio") and not record.get("title")


async def main() -> None:
    seeds = common.read_json(common.URLS_FILE, [])
    if not seeds:
        print(f"No seeds found. Run 01_scrape_faculty_urls.py first ({common.URLS_FILE}).")
        return

    if SCRAPE_LIMIT:
        seeds = seeds[:SCRAPE_LIMIT]
        print(f"[limit] processing first {len(seeds)} seeds only")

    tag_index = build_tag_index(common.read_json(common.URLS_FILE, []))
    print(f"[cross-match] {len(tag_index)} tagged experts indexed by name")

    records: list[dict] = []
    enriched = 0
    async with common.browser_page() as page:
        for i, seed in enumerate(seeds, 1):
            url = seed["profile_url"]
            print(f"[{i}/{len(seeds)}] {seed['source']:16} {seed.get('name','?')}")
            if not await common.goto_settled(page, url):
                records.append({**seed, "email": None, "bio": None})
                continue

            extractor = extractor_for(seed)
            record = await extractor(page, seed)

            # Cross-match: fill interests from the portal index if we have none.
            if not record.get("research_interests"):
                match = tag_index.get(common.normalize_name(record.get("name")))
                if match:
                    record["research_interests"] = match
                    record["interests_source"] = "facultyprofiles_crossmatch"
                    enriched += 1

            await common.maybe_dump_html(page, url.rsplit("/", 1)[-1], is_weak(record))
            records.append(record)

    common.write_json(common.DETAILS_FILE, records)
    print(f"\n[done] {len(records)} faculty -> {common.DETAILS_FILE}")
    print(f"       {sum(1 for r in records if r.get('research_interests'))} have research interests "
          f"({enriched} via cross-match)")
    print(f"       {sum(1 for r in records if r.get('email'))} have email, "
          f"{sum(1 for r in records if r.get('bio'))} have bio")


if __name__ == "__main__":
    asyncio.run(main())


