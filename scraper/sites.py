"""
Site registry for the GWU faculty scraper.

Each entry describes ONE data source and which crawl strategy fits it. Add a
new school by appending a SiteConfig — the stage-1/stage-2 scripts dispatch on
`strategy` and need no other changes.

Strategies implemented today:
  * "facultyprofiles_api" — POST /api/users on the research portal. Returns the
    54 richly-tagged experts WITH research interests, title, department, school
    in a single JSON call. This is the only source of curated research tags, so
    it also seeds the cross-match index used to enrich directory faculty.
  * "linked" — a Drupal directory whose listing links out to one profile page
    per person (e.g. GSEHD /directory/<slug>). We collect those links in stage 1
    and visit each in stage 2.

Strategy reserved for later (the harder sites):
  * "inline_ajax" — Business / Law / SEAS etc. render faculty as cards via a
    Drupal "Views" AJAX pager with no per-person page. Each needs its own
    reverse-engineering; left out of the first end-to-end build on purpose.

SELECTOR_CANDIDATES: ordered CSS selectors per field for "linked" profile pages.
The first that yields text wins; otherwise we fail soft. Tune against the HTML
that `DEBUG_DUMP_HTML=1` saves into scraper/debug_html/.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SiteConfig:
    key: str                      # short id, also used as `source` on records
    school: str                   # human-readable school/college name
    strategy: str                 # "facultyprofiles_api" | "linked"
    enabled: bool = True

    # --- facultyprofiles_api ---
    base_url: str = ""

    # --- linked ---
    listing_urls: list[str] = field(default_factory=list)
    # Regex (root-relative path) identifying an individual profile link.
    profile_href_pattern: str = ""
    # Per-field candidate selectors for the profile page.
    selectors: dict[str, list[str]] = field(default_factory=dict)


# Drupal sites label fields inconsistently, so candidates include both common
# Drupal field classes and a few generic fallbacks. These were grounded by
# inspecting real GSEHD profile markup; tune others as they're enabled.
_GENERIC_PROFILE_SELECTORS: dict[str, list[str]] = {
    "name": ["h1", ".page-title h1", ".field--name-title"],
    "title": [
        ".field--name-field-position",
        ".field--name-field-title",
        ".field--name-field-job-title",
        "[class*='position']",
        "[class*='job-title']",
    ],
    "department": [
        ".field--name-field-department",
        ".field--name-field-departments",
        "[class*='department']",
    ],
    "bio": [
        ".field--name-body",
        ".field--name-field-bio",
        ".field--name-field-biography",
        "article .field--type-text-with-summary",
    ],
    "image": [
        ".field--name-field-image img",
        ".field--name-field-photo img",
        "article img",
    ],
}


SITES: list[SiteConfig] = [
    SiteConfig(
        key="facultyprofiles",
        school="GWU Research Portal (Symplectic Elements)",
        strategy="facultyprofiles_api",
        base_url="https://facultyprofiles.gwu.edu",
    ),
    SiteConfig(
        key="gsehd",
        school="Graduate School of Education & Human Development",
        strategy="linked",
        listing_urls=["https://gsehd.gwu.edu/directory"],
        profile_href_pattern=r"^/directory/[a-z0-9\-]+$",
        # GSEHD-specific markup (verified against real profiles). The position
        # line lives in `.person-title`; the headshot's alt ends in "headshot".
        selectors={
            "name": ["h1"],
            "title": [".person-title"],
            "department": [".field--name-field-department"],  # absent on GSEHD -> null
            "bio": [".field--name-field-gw-person-biography", ".field--name-body"],
            "image": ["img[alt*='headshot']", "img[src*='/styles/']"],
        },
    ),
    # --- Reserved for later passes (inline_ajax); disabled for the first build.
    # SiteConfig("business", "School of Business", "inline_ajax",
    #            listing_urls=["https://business.gwu.edu/faculty-directory"], enabled=False),
    # SiteConfig("law", "GW Law", "inline_ajax",
    #            listing_urls=["https://www.law.gwu.edu/full-time-faculty"], enabled=False),
    # SiteConfig("seas", "School of Engineering & Applied Science", "inline_ajax",
    #            listing_urls=["https://www.seas.gwu.edu/faculty-directory"], enabled=False),
]


def enabled_sites() -> list[SiteConfig]:
    return [s for s in SITES if s.enabled]
