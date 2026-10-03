"""
Shared crawler engine for the GWU faculty scraper.

Design notes (this project is also a teaching exercise):
  * GWU has no single faculty API. Data is spread across one research portal
    (facultyprofiles.gwu.edu, ~54 richly-tagged experts) and ~15 heterogeneous
    school directory sites (mostly Drupal). So the scraper is *config-driven*:
    each site is described in `sites.py`, and a small set of reusable
    "strategy" functions here know how to crawl each shape.
  * Profile pages differ site to site, so field extraction uses
    SELECTOR_CANDIDATES: an ordered list of candidate CSS selectors per field.
    The first one that yields text wins; if none do we fail soft (None / "N/A")
    rather than crash. Set DEBUG_DUMP_HTML=1 to save the raw HTML of any page
    we extracted weakly, so selectors can be tuned against reality.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

from playwright.async_api import async_playwright, Page

# --- Paths -----------------------------------------------------------------
SCRAPER_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRAPER_DIR.parent
DATA_DIR = REPO_ROOT / "data"
DEBUG_DIR = SCRAPER_DIR / "debug_html"

URLS_FILE = DATA_DIR / "faculty_urls.json"
DETAILS_FILE = DATA_DIR / "faculty_details.json"

DEBUG_DUMP_HTML = os.environ.get("DEBUG_DUMP_HTML") == "1"

# Politeness: pause between page loads so we don't hammer GWU's servers.
REQUEST_DELAY_MS = int(os.environ.get("SCRAPER_DELAY_MS", "600"))
NAV_TIMEOUT_MS = 45000

# Identifies the crawler honestly (the suffix) so site admins can see who we are.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 "
    "GWU-Research-Discovery-Engine/edu-scraper "
    "(+https://github.com/Prakruthi19/gwu-research-discovery-engine)"
)


# --- robots.txt ------------------------------------------------------------
# Every URL is checked against the host's robots.txt before we request it.
# We match the "*" group (we are not a named search engine) and implement
# RFC 9309 matching ourselves, because urllib.robotparser ignores the `*` and
# `$` wildcards GWU's sites use (e.g. `Disallow: */publications$`).
#   * robots.txt 404/410  -> everything allowed (standard behaviour)
#   * unreachable / 5xx   -> everything disallowed (fail closed)
_robots_cache: dict[str, list[tuple[bool, str]] | None] = {}


def _parse_robots(text: str) -> list[tuple[bool, str]]:
    """Return (allow?, pattern) rules from the groups that apply to '*'."""
    rules: list[tuple[bool, str]] = []
    agents: list[str] = []
    in_rules = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if in_rules:  # a new group starts after a group's rules
                agents, in_rules = [], False
            agents.append(value.lower())
        elif key in ("allow", "disallow"):
            in_rules = True
            if "*" in agents and value:
                rules.append((key == "allow", value))
    return rules


def _rule_matches(pattern: str, path: str) -> bool:
    anchored = pattern.endswith("$")
    body = re.escape(pattern.rstrip("$")).replace(r"\*", ".*")
    return re.match(body + ("$" if anchored else ""), path) is not None


def _load_robots(origin: str) -> list[tuple[bool, str]] | None:
    """Rules for an origin, or None when robots.txt couldn't be read."""
    if origin in _robots_cache:
        return _robots_cache[origin]
    from urllib.error import HTTPError
    from urllib.request import Request, urlopen

    rules: list[tuple[bool, str]] | None
    try:
        req = Request(f"{origin}/robots.txt", headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=20) as resp:
            rules = _parse_robots(resp.read().decode("utf-8", "replace"))
    except HTTPError as exc:
        rules = [] if 400 <= exc.code < 500 else None
    except Exception:
        rules = None
    _robots_cache[origin] = rules
    return rules


def robots_allowed(url: str) -> bool:
    """True if the host's robots.txt lets a generic crawler fetch this URL."""
    from urllib.parse import urlparse

    parts = urlparse(url)
    rules = _load_robots(f"{parts.scheme}://{parts.netloc}")
    if rules is None:
        return False
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    # Longest matching rule wins; on a tie, Allow wins (RFC 9309 §2.2.2).
    best: tuple[int, bool] | None = None
    for allow, pattern in rules:
        if _rule_matches(pattern, path):
            candidate = (len(pattern), allow)
            if best is None or candidate > best:
                best = candidate
    return True if best is None else best[1]


# --- Browser ---------------------------------------------------------------
@asynccontextmanager
async def browser_page():
    """Yield a ready-to-use Playwright page, cleaning up afterwards."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=USER_AGENT)
        page = await context.new_page()
        page.set_default_timeout(NAV_TIMEOUT_MS)
        try:
            yield page
        finally:
            await browser.close()


async def goto_settled(page: Page, url: str) -> bool:
    """Navigate and wait for the SPA/Drupal content to settle. Returns success."""
    if not robots_allowed(url):
        print(f"    ! skipped (disallowed by robots.txt): {url}")
        return False
    try:
        await page.goto(url, timeout=NAV_TIMEOUT_MS, wait_until="domcontentloaded")
    except Exception as exc:  # noqa: BLE001 - fail soft, log, keep going
        print(f"    ! navigation failed: {url} -> {exc!r}"[:140])
        return False
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:  # networkidle is best-effort
        pass
    if REQUEST_DELAY_MS:
        await page.wait_for_timeout(REQUEST_DELAY_MS)
    return True


# --- Field extraction ------------------------------------------------------
async def first_text(page: Page, selectors: list[str]) -> str | None:
    """Return trimmed innerText of the first candidate selector that matches."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            txt = (await loc.inner_text()).strip()
            if txt:
                return txt
        except Exception:
            continue
    return None


async def first_attr(page: Page, selectors: list[str], attr: str) -> str | None:
    """Return an attribute of the first candidate selector that matches."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0:
                continue
            val = await loc.get_attribute(attr)
            if val:
                return val.strip()
        except Exception:
            continue
    return None


async def email_on_page(page: Page) -> str | None:
    """Extract a mailto email, ignoring tracking/encoded junk."""
    href = await first_attr(page, ["a[href^=mailto]"], "href")
    if not href:
        return None
    addr = href.replace("mailto:", "").split("?")[0].strip()
    return addr or None


def absolute_url(base: str, maybe_relative: str | None) -> str | None:
    """Resolve a possibly root-relative URL (e.g. /sites/..img.jpg) against base."""
    if not maybe_relative:
        return None
    if maybe_relative.startswith(("http://", "https://", "data:")):
        return maybe_relative
    from urllib.parse import urljoin

    return urljoin(base, maybe_relative)


async def maybe_dump_html(page: Page, slug: str, weak: bool) -> None:
    """If DEBUG_DUMP_HTML and extraction was weak, save raw HTML for inspection."""
    if not (DEBUG_DUMP_HTML and weak):
        return
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-z0-9_.-]+", "_", slug.lower())[:80]
    out = DEBUG_DIR / f"{safe}.html"
    try:
        out.write_text(await page.content(), encoding="utf-8")
        print(f"    · dumped weak-extraction HTML -> {out.name}")
    except Exception:
        pass


# --- Cross-match helpers ---------------------------------------------------
def normalize_name(name: str | None) -> str:
    """
    Normalize a person's name for fuzzy cross-source matching.

    Lowercases, strips accents, drops honorifics/suffixes and punctuation so
    "Dr. Keith A. Crandall" and "Keith Crandall" collapse to the same key.
    """
    if not name:
        return ""
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    name = name.lower()
    name = re.sub(r"\b(dr|prof|professor|mr|mrs|ms|phd|md|jr|sr|ii|iii|iv)\b\.?", " ", name)
    name = re.sub(r"[^a-z\s]", " ", name)
    tokens = name.split()
    # Key on first + last token, which is stable across "First M. Last" variants.
    if len(tokens) >= 2:
        return f"{tokens[0]} {tokens[-1]}"
    return " ".join(tokens)


# --- JSON IO ---------------------------------------------------------------
def read_json(path: Path, default):
    if path.exists():
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
