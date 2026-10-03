// Privacy + safety guardrails for the LLM enrichment pipeline.
//
//   faculty record ──▶ INPUT GUARDRAILS ──▶ OpenAI ──▶ OUTPUT GUARDRAILS ──▶ Postgres
//
// Input side: the model never learns WHO it is reading about.
//   * Pseudonymous ids ("p1", "p2", …) replace profile URLs. The id → person
//     mapping stays in this process and is never sent.
//   * Names, emails, phone numbers and links are redacted from free text
//     (the bio can mention any of them), and the person's own name is
//     removed from their bio so the text can't be traced back by search.
//   * Only the minimum fields go out: title + trimmed bio.
//
// Output side: the model's answer is untrusted input.
//   * Unknown or duplicate ids are dropped (a reply can't write to someone
//     who wasn't in the batch).
//   * Every tag is checked for shape, length, characters, PII and confidence
//     before it may reach the database.
//
// Pure functions only (no network, no DB) so they're unit-tested directly.

export const MAX_BIO_CHARS = 1500;
export const MAX_TITLE_CHARS = 200;
export const MAX_INTERESTS = 6;
export const MAX_TAG_CHARS = 60;
export const MAX_TAG_WORDS = 6;
export const DEFAULT_MIN_CONFIDENCE = 0.5;

// --- Redaction ---------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// "jane [at] gwu [dot] edu", "jane(at)gwu(dot)edu"
const OBFUSCATED_EMAIL =
  /[A-Z0-9._%+-]+\s*[[(]\s*at\s*[\])]\s*[A-Z0-9.-]+(?:\s*[[(]\s*dot\s*[\])]\s*[A-Z0-9-]+)+/gi;
// Stops before trailing punctuation so "see www.lab.org, call" keeps its comma.
const URL = /\b(?:https?:\/\/|www\.)\S*[^\s.,;:!?)\]'"]/gi;
// US/intl phone shapes: 202-555-0123, (202) 555 0123, +1 202.555.0123
const PHONE = /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// Zero-width / control characters can hide text from a human reviewer.
const INVISIBLE = new RegExp(
  "[" + [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x2029], [0x2060, 0x2060], [0xfeff, 0xfeff]]
    .map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`)
    .join("") + "]",
  "gu"
);

const HONORIFICS = new Set(["dr", "prof", "professor", "mr", "mrs", "ms", "mx", "phd", "md", "jr", "sr", "ii", "iii", "iv"]);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nameTokens(name) {
  if (!name) return [];
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z'-]+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length >= 2 && !HONORIFICS.has(t.toLowerCase()));
}

// Removes contact details and (optionally) the person's own name from text.
export function redact(text, { name } = {}) {
  if (text == null) return null;
  let out = String(text).replace(INVISIBLE, "");
  out = out
    .replace(EMAIL, "[EMAIL]")
    .replace(OBFUSCATED_EMAIL, "[EMAIL]")
    .replace(URL, "[LINK]")
    .replace(PHONE, "[PHONE]");

  const tokens = nameTokens(name);
  if (tokens.length) {
    // Full name first (so "Jane Q. Doe" collapses to one marker), then each
    // part on its own ("Doe's lab", "Professor Jane").
    const full = new RegExp(
      `\\b${tokens.map(escapeRegExp).join("[\\s.,A-Za-z]{0,6}?\\s")}\\b`,
      "gi"
    );
    out = out.replace(full, "[NAME]");
    for (const t of tokens) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(t)}\\b`, "gi"), "[NAME]");
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

// --- Request payload -----------------------------------------------------------

// Turns a batch of faculty records into what the model sees, plus the
// private id → record map used to route answers back.
export function buildPayload(batch) {
  const idMap = new Map();
  const people = batch.map((f, i) => {
    const id = `p${i + 1}`;
    idMap.set(id, f);
    const title = redact(f.title, { name: f.name });
    const bio = redact(f.bio, { name: f.name });
    return {
      id,
      title: title ? title.slice(0, MAX_TITLE_CHARS) : null,
      bio: bio ? bio.slice(0, MAX_BIO_CHARS) : null,
    };
  });
  return { people, idMap };
}

// --- Response validation -------------------------------------------------------

const TAG_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} '&()/,.+-]*$/u;

// Returns a rejection reason, or null if the tag is acceptable.
export function checkTag(name, confidence, { minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (typeof name !== "string") return "not a string";
  const tag = name.replace(/\s+/g, " ").trim();
  if (tag.length < 2) return "too short";
  if (tag.length > MAX_TAG_CHARS) return "too long";
  if (tag.split(" ").length > MAX_TAG_WORDS) return "too many words";
  if (/\[(EMAIL|LINK|PHONE|NAME)\]/i.test(tag)) return "contains a redaction marker";
  // Non-global copies: .test() on a /g regex is stateful between calls.
  if (tag.includes("@") || new RegExp(EMAIL.source, "i").test(tag)) return "looks like an email";
  if (new RegExp(URL.source, "i").test(tag) || /\.(com|edu|org|net|gov)\b/i.test(tag)) {
    return "looks like a link";
  }
  if (new RegExp(PHONE.source).test(tag)) return "looks like a phone number";
  if (!TAG_SHAPE.test(tag)) return "unexpected characters";
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "missing confidence";
  if (confidence < 0 || confidence > 1) return "confidence out of range";
  if (confidence < minConfidence) return `confidence below ${minConfidence}`;
  return null;
}

// Validates the model's parsed JSON against the batch that was sent.
// Returns { accepted: Map<id, [{name, confidence}]>, rejected: [{id, tag, reason}] }.
export function validateResults(parsed, idMap, opts = {}) {
  const accepted = new Map();
  const rejected = [];
  const results = Array.isArray(parsed?.results) ? parsed.results : [];

  for (const r of results) {
    const id = r?.id;
    if (!idMap.has(id)) {
      rejected.push({ id, tag: null, reason: "unknown id" });
      continue;
    }
    if (accepted.has(id)) {
      rejected.push({ id, tag: null, reason: "duplicate id" });
      continue;
    }
    const seen = new Set();
    const clean = [];
    for (const i of Array.isArray(r.interests) ? r.interests : []) {
      const reason = checkTag(i?.name, i?.confidence, opts);
      if (reason) {
        rejected.push({ id, tag: i?.name ?? null, reason });
        continue;
      }
      const tag = i.name.replace(/\s+/g, " ").trim();
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      if (clean.length >= MAX_INTERESTS) {
        rejected.push({ id, tag, reason: `over the ${MAX_INTERESTS}-tag limit` });
        continue;
      }
      seen.add(key);
      clean.push({ name: tag, confidence: i.confidence });
    }
    accepted.set(id, clean);
  }
  return { accepted, rejected };
}
