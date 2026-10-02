# LLM Research-Interest Enrichment

## Why
The scraper captured faculty research interests from a **fixed taxonomy**
(108 broad field terms). Two gaps result:

1. **67 of 121 faculty have *no* research interests at all** — so they only
   match a search on their title/department/bio, and most searches miss them.
2. The taxonomy is coarse: searching "AI" or "deep learning" finds nothing
   because the only related term is the broad "Machine learning".

The enrichment pipeline (`server/scripts/enrich_interests.js`) uses an LLM
(OpenAI) to read each under-tagged faculty member's **bio** and infer specific
research interests, then writes them back to the database.

## Scope (what we send to the LLM)
Only the faculty who **lack** scraped interests — the 67 above. Everyone who
already has good tags is skipped (don't pay to re-derive what we have). Where a
bio exists (32 of the 67) we use it; otherwise we fall back to the title.

## Safeguard: no hallucinated interests
Many of the no-interest faculty are **administrative staff** ("Assistant
Director of Admissions", "Program Coordinator"), not researchers. The prompt
**explicitly allows an empty result** — if the bio/title shows no research
signal, the model returns `[]` and we add nothing. We never force the model to
invent interests for a non-researcher.

## Provenance: the `source` column
Every faculty↔interest link carries a `source`:

| source      | meaning                                        |
|-------------|------------------------------------------------|
| `"scraped"` | came from the GWU site (original seed)         |
| `"llm"`     | inferred from the bio by this pipeline         |

Plus an optional `confidence` (0–1) the model assigns. This makes LLM tags
**distinguishable and reversible** — you can delete every `source="llm"` row
without touching scraped data. (This is exactly why the schema uses an explicit
`FacultyResearchInterest` join table instead of an implicit many-to-many.)

## Cost-reduction techniques used
The job is tiny (cents), but it's built to scale cheaply:

| Technique | What it does |
|-----------|--------------|
| **Pre-filter** | Only process faculty missing interests — skip the rest entirely (biggest saving). |
| **Trim payload** | Send only `name + title + bio`, not the whole record. |
| **Batch ~12 per request** | Amortize the system-prompt tokens across many faculty instead of re-paying per call. The middle ground between one-giant-call (fragile) and one-call-each (wasteful). |
| **Key results by `profile_url`** | So a batched response maps cleanly back to records. |
| **Mini model** (`gpt-4o-mini`) | ~15–20× cheaper than flagship; plenty for keyword extraction. |
| **JSON mode + capped output** | Strict JSON, max 6 interests each — no wasted tokens, no re-parsing. |
| **Idempotent** | Re-running skips faculty that already have `source="llm"` rows, so you never pay twice. |

Further options (not enabled, overkill here): OpenAI **Batch API** (−50%,
async), prompt caching, or **embeddings** to map bios onto the existing 108
terms instead of generating new ones.

## Running it
```bash
cd server
export OPENAI_API_KEY=sk-...        # read from env; never written to disk

# 1. Dry run on a few — calls the API, prints extractions, writes NOTHING
node scripts/enrich_interests.js --limit 5 --dry-run

# 2. Real run on a few — writes source="llm" rows for 5 faculty
node scripts/enrich_interests.js --limit 5

# 3. Full run on all under-tagged faculty
node scripts/enrich_interests.js

# Roll back everything the LLM added:
#   DELETE FROM "FacultyResearchInterest" WHERE source = 'llm';
```

Flags: `--limit N` (process at most N faculty), `--dry-run` (no DB writes),
`--batch N` (faculty per API request, default 12).
