# GWU Research Discovery Engine — Build Instructions

## Project goal

A full-stack GraphQL learning project. Students search for GWU faculty by
research interest (e.g. "machine learning", "computational chemistry") and
get back matching professors. Primary goal is to **learn GraphQL deeply**
(schema design, resolvers, the N+1 problem, mutations, a real client) —
not just to ship a working app. Prioritize clarity and idiomatic patterns
over cleverness.

Repo: https://github.com/Prakruthi19/gwu-research-discovery-engine
(currently contains only a stage-1 Playwright scraper, `gwu_scraper.py`)

## Architecture

```
gwu-research-discovery-engine/
├── scraper/        # Python + Playwright — scrapes GWU faculty data
├── server/         # Node.js + Apollo Server + Prisma + PostgreSQL
└── client/         # React + Vite + Apollo Client
```

Decoupling note for the human (they're learning GraphQL, reinforce this if
relevant in commit messages / comments): GraphQL is the API contract layer
only. It does not talk to the database. Resolvers are plain functions that
call Prisma; Prisma talks to Postgres. Swapping Prisma for raw SQL or a
different DB would not require touching the GraphQL schema.

## Stack decisions (already made, don't relitigate)

- **DB**: PostgreSQL + Prisma ORM
- **Server**: Node.js, ES modules (`"type": "module"` in package.json),
  Apollo Server 5 (`@apollo/server`), standalone server mode
- **Client**: React + Vite, Apollo Client
- **Scraper**: Python + Playwright (already exists for stage 1)

## Current state / what's already built

The following files already exist (written by Claude in a prior session,
**not yet validated against a live Postgres instance or live GWU site**
due to sandbox network restrictions — verify and fix as needed):

### `scraper/01_scrape_faculty_urls.py`
Cleaned-up version of the user's original scraper. Visits
`https://facultyprofiles.gwu.edu/search`, extracts `.profile-item` name +
link, writes `data/faculty_urls.json`.

### `scraper/02_scrape_faculty_details.py`
**Unvalidated — the real DOM of an individual GWU profile page has never
been inspected.** Visits each URL from stage 1, tries multiple candidate
CSS selectors for department/bio/research_interests/email (defined in
`SELECTOR_CANDIDATES` dict), fails soft (records `"N/A"` / empty rather
than crashing), and has a `DEBUG_DUMP_HTML=1` env var mode that saves raw
HTML to `scraper/debug_html/` for any profile with weak extraction.

**First task: run this for real, inspect actual output / dumped HTML, and
fix `SELECTOR_CANDIDATES` to match the real markup.** Don't trust the
current selectors — they're educated guesses only.

### `server/prisma/schema.prisma`
Two models + explicit join table:
- `Faculty` (id, name, department, title, email, bio, profileUrl,
  imageUrl, timestamps)
- `ResearchInterest` (id, name unique)
- `FacultyResearchInterest` (explicit join table, not Prisma's implicit
  many-to-many, so fields like `confidence`/`source` can be added later
  without a schema rewrite)

### `server/src/schema.js`
GraphQL SDL. Key types: `Faculty`, `ResearchInterest`,
`FacultySearchResult` (wraps `faculty` + `matchedInterests: [String!]!` so
the UI can show *why* a result matched). Queries: `allFaculty(department)`,
`facultyById(id)`, `facultyBySearch(query)` (the core feature),
`allResearchInterests`, `allDepartments`. Mutations: `createFaculty`,
`updateFaculty`, `deleteFaculty`, `addResearchInterest`,
`removeResearchInterest`.

### `server/src/resolvers.js`
Implements all of the above against Prisma. Notable design points to
preserve:
- A shared `FACULTY_WITH_INTERESTS` Prisma `include` shape avoids N+1
  queries when a query also asks for `researchInterests` — this is
  intentionally commented in the file as a GraphQL teaching point. Keep
  the comment explaining the N+1 problem and that a DataLoader is the
  "next level" solution.
- `flattenInterests()` reshapes Prisma's join-table result into the flat
  array the GraphQL schema promises.
- `facultyBySearch` does a case-insensitive `contains` match across
  department/title/bio/research interest name (Postgres `ILIKE`-style via
  Prisma's `mode: "insensitive"`). This is intentionally simple (not full
  text search / embeddings) — that's a good "v2" extension once the
  GraphQL plumbing works.
- Mutations use `connectOrCreate` for research interests by name, so
  interests get deduplicated automatically.

### `server/src/index.js`, `server/src/prismaClient.js`
Standard Apollo standalone server bootstrap + a single shared
`PrismaClient` instance (don't instantiate per-request).

### `server/prisma/seed.js`
Reads `data/faculty_details.json` (the scraper's stage-2 output) if it
exists; falls back to 6 realistic sample GWU CS/ECE faculty if not, so the
stack is testable before scraping is finished. Upserts on email or
profileUrl.

### `server/.env.example`
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gwu_research?schema=public"
PORT=4000
```

### `server/package.json`
ES modules, scripts: `dev` (nodemon), `start`, `seed`, `prisma:generate`,
`prisma:migrate`, `prisma:studio`. Dependencies installed:
`@apollo/server`, `graphql`, `@prisma/client`, `dotenv`; devDependencies:
`prisma`, `nodemon`.

### `client/` (Vite React scaffold)
Vite + React scaffolded via `npm create vite@latest . -- --template react`.
`@apollo/client` and `graphql` installed.

#### `client/src/apolloClient.js`
Basic `ApolloClient` + `InMemoryCache` + `HttpLink`, pointed at
`http://localhost:4000/` (overridable via `VITE_GRAPHQL_URL`).

#### `client/src/queries.js`
`gql` queries: `SEARCH_FACULTY` (the main one — hits `facultyBySearch`,
requests `matchedInterests` + nested faculty fields), `ALL_FACULTY`,
`ALL_DEPARTMENTS`, `FACULTY_BY_ID`.

**Not yet built**: any actual React components, `main.jsx` Apollo
`ApolloProvider` wiring, `App.jsx` rewrite, or styling. This is the bulk
of remaining client work.

## Design direction for the client UI

Ground the visual design in GW's actual brand and the "faculty index card
/ research catalog" concept — avoid generic SaaS-template look (no default
purple gradients, no generic centered hero-with-stats layout).

**Token system to use:**
- Color: `#00316B` (GW deep blue, primary), `#EFE5D0` (buff/parchment,
  background), `#FFFFFF`, `#1A1A1A` (ink/body text), `#A6192E` (sparing
  accent — e.g. for matched-interest tag highlighting only)
- Type: a serif display face for headings (catalog/academic feel — e.g.
  "Source Serif 4" or similar), a clean sans for UI/body text (e.g.
  "Inter")
- Layout: search bar styled like a card-catalog lookup at the top; results
  rendered as a vertical list of "faculty index cards", not generic
  rounded SaaS cards
- Signature element: matched research-interest tags styled like
  rubber-stamped catalog tags (small, slightly rotated, accent-bordered)
- Responsive down to mobile, visible keyboard focus states, respect
  `prefers-reduced-motion`

Consult `/mnt/skills/public/frontend-design/SKILL.md` (or equivalent
design-quality guidance) before building components if available in your
environment.

## Build order (do these in sequence)

1. **Fix the scraper.** Run `scraper/01_scrape_faculty_urls.py` against
   the real site. Confirm `.profile-item` / `.name` selectors are still
   correct (the GWU site may have changed). Then run
   `DEBUG_DUMP_HTML=1 python scraper/02_scrape_faculty_details.py`
   against a handful of real profile URLs, inspect the dumped HTML in
   `scraper/debug_html/`, and rewrite `SELECTOR_CANDIDATES` in that file
   to match reality. Remove the `limit=5` in `scrape_all_profiles()` once
   selectors are confirmed working, then do a full scrape.

2. **Stand up Postgres locally** (Docker is easiest:
   `docker run --name gwu-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`).
   Copy `server/.env.example` to `server/.env`, adjust `DATABASE_URL` if
   needed.

3. **Run Prisma migrations**: `cd server && npx prisma migrate dev --name init`.
   This both validates `schema.prisma` for real and creates the tables.
   Then `npx prisma generate` to build the client.

4. **Seed the DB**: `npm run seed` (uses scraped data if
   `data/faculty_details.json` exists, else sample data).

5. **Run the server**: `npm run dev`. Open the printed URL — Apollo
   Sandbox should load. Manually test `facultyBySearch(query: "machine learning")`
   and a mutation, confirm the N+1-avoidance `include` actually works by
   checking Prisma's query log (`log: ["query"]` in `PrismaClient` config
   is useful here temporarily).

6. **Build the React client.** In `client/src/`:
   - Wire `ApolloProvider` (using the existing `apolloClient.js`) into
     `main.jsx`.
   - Build a `SearchBar` component (controlled input, debounced or
     submit-on-enter, calls `useQuery(SEARCH_FACULTY, { variables: { query }, skip: !query })`).
   - Build a `FacultyCard` component rendering one `FacultySearchResult`
     (name, title, department, bio snippet, research interest tags with
     matched ones visually distinguished, link to `profileUrl`).
   - Build a `ResultsList` component mapping search results to
     `FacultyCard`s, with loading/error/empty states (empty state should
     be a clear "no matches, try a different term" message, not a blank
     screen).
   - Rewrite `App.jsx` to compose these; remove Vite's default boilerplate
     content.
   - Apply the design direction above in CSS (plain CSS or CSS modules is
     fine — no need for a framework like Tailwind unless the human asks).

7. **Stretch goals (only after the above works end-to-end)**:
   - Department filter dropdown using `ALL_DEPARTMENTS` query.
   - Admin-style form using the mutations (`createFaculty`, etc.) to
     demonstrate `useMutation` and cache updates.
   - Replace the N+1-avoidance manual `include` pattern with a real
     DataLoader, as a deliberate "now learn the next level" exercise.
   - Swap the simple `contains` search for Postgres full-text search
     (`@@fulltext` / `tsvector`) once basic search works.

## Constraints / things to preserve

- Keep the teaching-oriented comments in `resolvers.js` (N+1 explanation,
  decoupling notes) — the human is using this project specifically to
  learn GraphQL, not just to get a working app. Don't strip comments for
  "cleanliness."
- Don't swap Prisma for raw SQL or a different ORM without being asked.
- Don't add authentication/authorization — out of scope for this version.
- Keep the explicit `FacultyResearchInterest` join table rather than
  switching to Prisma's implicit many-to-many.