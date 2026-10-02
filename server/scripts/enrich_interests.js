// LLM research-interest enrichment pipeline.
//
//   faculty with NO scraped interests  ->  OpenAI (read bio/title)
//     ->  inferred interests  ->  Prisma  ->  Postgres (source="llm")
//
// Scoped, batched, idempotent, and reversible. See ../../docs/llm-enrichment.md for the
// strategy + cost-reduction rationale.
//
// Usage (from server/):
//   node scripts/enrich_interests.js --limit 5 --dry-run   # preview, no writes
//   node scripts/enrich_interests.js --limit 5             # write 5
//   node scripts/enrich_interests.js                       # all candidates
// Flags: --limit N, --dry-run, --batch N (default 12), --force (re-do done ones)
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── config / args ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagVal = (f, d) => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY_RUN = hasFlag("--dry-run");
const FORCE = hasFlag("--force");
const LIMIT = Number(flagVal("--limit", "0")) || 0; // 0 = no limit
const BATCH_SIZE = Number(flagVal("--batch", "12")) || 12;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_BIO_CHARS = 1500;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DETAILS_PATH = join(__dirname, "..", "..", "data", "faculty_details.json");

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set in your environment.");
  process.exit(1);
}
const openai = new OpenAI(); // reads OPENAI_API_KEY from env

// ── prompt ───────────────────────────────────────────────────────────────--
const SYSTEM_PROMPT = `You label university faculty with their research interests.

For each person you are given a name, title, and (sometimes) a bio. Infer their
specific academic RESEARCH interests as short tags (1-4 words each, e.g.
"deep learning", "election security", "cancer genomics", "monetary policy").

Rules:
- Return AT MOST 6 interests per person, most specific/confident first.
- Base interests ONLY on the text given. Do NOT invent or pad.
- If the person is administrative/support staff (e.g. admissions, program
  coordination, marketing) or the text shows no research signal, return an
  EMPTY list for them. It is correct and expected to return [].
- confidence is 0..1 for how strongly the text supports the interest.`;

// Strict structured output so we never waste tokens on prose or re-parsing.
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "faculty_interests",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              profile_url: { type: "string" },
              interests: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    confidence: { type: "number" },
                  },
                  required: ["name", "confidence"],
                },
              },
            },
            required: ["profile_url", "interests"],
          },
        },
      },
      required: ["results"],
    },
  },
};

// ── helpers ────────────────────────────────────────────────────────────────
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function extractBatch(batch) {
  // Send only what's needed: name, title, trimmed bio, and the id (profile_url).
  const people = batch.map((f) => ({
    profile_url: f.profile_url,
    name: f.name,
    title: f.title ?? null,
    bio: f.bio ? String(f.bio).slice(0, MAX_BIO_CHARS) : null,
  }));

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Label these faculty. Return one results entry per profile_url:\n" +
          JSON.stringify(people, null, 2),
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content);
  return parsed.results ?? [];
}

// Write one faculty's inferred interests (dedupe by name, mark source="llm").
async function writeInterests(facultyId, interests) {
  for (const { name, confidence } of interests) {
    const clean = name.trim();
    if (!clean) continue;
    const interest = await prisma.researchInterest.upsert({
      where: { name: clean },
      update: {},
      create: { name: clean },
    });
    await prisma.facultyResearchInterest.upsert({
      where: {
        facultyId_researchInterestId: {
          facultyId,
          researchInterestId: interest.id,
        },
      },
      // Only (re)write LLM links; never overwrite a scraped link's source.
      update: { source: "llm", confidence },
      create: {
        facultyId,
        researchInterestId: interest.id,
        source: "llm",
        confidence,
      },
    });
  }
}

// ── main ─────────────────────────────────────────────────────────────────--
async function main() {
  const all = JSON.parse(readFileSync(DETAILS_PATH, "utf-8"));

  // Scope: faculty with NO scraped interests (the ones searches miss).
  let candidates = all.filter(
    (r) => r.profile_url && !(r.research_interests || []).length
  );

  // Map to DB rows by profile_url; skip any not seeded.
  const dbFaculty = await prisma.faculty.findMany({
    where: { profileUrl: { in: candidates.map((c) => c.profile_url) } },
    select: { id: true, profileUrl: true },
  });
  const idByUrl = new Map(dbFaculty.map((f) => [f.profileUrl, f.id]));

  // Idempotency: skip faculty that already have llm-sourced interests.
  if (!FORCE) {
    const done = await prisma.facultyResearchInterest.findMany({
      where: { source: "llm", facultyId: { in: [...idByUrl.values()] } },
      select: { facultyId: true },
      distinct: ["facultyId"],
    });
    const doneIds = new Set(done.map((d) => d.facultyId));
    candidates = candidates.filter((c) => {
      const id = idByUrl.get(c.profile_url);
      return id && !doneIds.has(id);
    });
  }

  if (LIMIT) candidates = candidates.slice(0, LIMIT);

  console.log(
    `Model ${MODEL} | ${candidates.length} faculty to enrich | ` +
      `batch ${BATCH_SIZE}${DRY_RUN ? " | DRY RUN (no writes)" : ""}`
  );
  if (!candidates.length) {
    console.log("Nothing to do.");
    return;
  }

  const batches = chunk(candidates, BATCH_SIZE);
  let added = 0;
  let emptied = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    console.log(`\nBatch ${b + 1}/${batches.length} (${batch.length} faculty)…`);
    let results;
    try {
      results = await extractBatch(batch);
    } catch (err) {
      console.error(`  ! batch failed, skipping: ${err.message}`);
      continue;
    }

    const byUrl = new Map(results.map((r) => [r.profile_url, r.interests]));
    for (const f of batch) {
      const interests = byUrl.get(f.profile_url) ?? [];
      const tags = interests.map((i) => `${i.name} (${i.confidence})`);
      if (!interests.length) {
        emptied++;
        console.log(`  – ${f.name}: [] (no research signal)`);
        continue;
      }
      console.log(`  ✓ ${f.name}: ${tags.join(", ")}`);
      if (!DRY_RUN) {
        const id = idByUrl.get(f.profile_url);
        if (id) {
          await writeInterests(id, interests);
          added += interests.length;
        }
      }
    }
  }

  console.log(
    `\nDone. ${DRY_RUN ? "(dry run) " : ""}` +
      `${added} interest links ${DRY_RUN ? "would be " : ""}written; ` +
      `${emptied} faculty returned [] (non-research / no signal).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
