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

## Privacy guardrails
The model never learns **who** it is reading about. Both sides of the API call
go through `server/scripts/enrichment_guardrails.js` (unit-tested in
`server/test/guardrails.test.js`, run with `npm run test:unit`).

**Before sending (input):**

| Guardrail | What it does |
|-----------|--------------|
| Field whitelist | Only `title` + `bio` are sent. Name, email, profile URL, photo, school and department never leave the machine. |
| Pseudonymous ids | Each person is `p1`, `p2`, … for one batch. The id → person map stays in memory and is never sent, so the request contains no link back to a real profile. |
| Redaction | Emails (including `name [at] gwu [dot] edu`), phone numbers and links in the bio become `[EMAIL]`, `[PHONE]`, `[LINK]`. The person's own name becomes `[NAME]`. |
| Invisible-text strip | Zero-width and control characters are removed so nothing hidden rides along. |
| Length caps | Bio ≤ 1,500 chars, title ≤ 200 chars, batch ≤ 25 people. |
| `store: false` | Asks OpenAI not to keep the request in stored completions. |

**After receiving (output), treated as untrusted input:**

| Guardrail | What it does |
|-----------|--------------|
| Strict JSON schema | The reply must match an exact shape; refusals and truncated replies fail the batch. |
| Id check | Answers for unknown or duplicate ids are dropped, so a reply can't write to anyone outside the batch. |
| Tag checks | Rejects tags that look like emails, phones or links, contain redaction markers or odd characters, exceed 60 chars / 6 words, or have confidence outside 0–1 or below `--min-confidence` (default 0.5). At most 6 tags per person, deduplicated. |
| Prompt-injection rule | The prompt says bios are data, not instructions. The output checks above are the real defence. |
| Scraped tags win | An LLM tag never overwrites a link GWU itself published. |

See exactly what would be sent, with no API call and no database needed:

```bash
node scripts/enrich_interests.js --preview --limit 3
```

Residual risk: a very specific job title (e.g. "Director, Community Counseling
Services Center") can still hint at who someone is. Titles are kept because they
carry most of the research signal for people without a bio.

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
| **Trim payload** | Send only `title + bio` (redacted), not the whole record. |
| **Batch ~12 per request** | Amortize the system-prompt tokens across many faculty instead of re-paying per call. The middle ground between one-giant-call (fragile) and one-call-each (wasteful). |
| **Key results by pseudonymous id** | `p1`, `p2`, … map a batched response back to records without sending anything identifying. |
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
`--batch N` (faculty per API request, default 12, max 25), `--preview` (print the redacted payload, no API call), `--min-confidence X` (default 0.5).
