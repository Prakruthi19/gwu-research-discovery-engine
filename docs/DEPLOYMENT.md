# Deployment and CI/CD

Everything here runs on free tiers. One-time setup is about 15 minutes; after
that, merging to `main` is the whole release process.

```
PR opened ──▶ CI: server tests (real Postgres) · client lint+build · scraper lint
merge to main ──▶ same checks ──▶ all green? ──▶ client → GitHub Pages
                                             └─▶ API → Render (runs migrations first)
```

## What runs where, and why

| Piece    | Host | Cost | Why this one |
|----------|------|------|--------------|
| Client   | GitHub Pages | Free | Static Vite build; deploys from the same Actions workflow with no extra account or token. |
| API      | Render (free web service) | Free | Runs a long-lived Node server as-is, builds from the repo, has deploy hooks. Sleeps after ~15 min idle; the client pre-warms it on page load and explains the wait. |
| Database | Neon (free Postgres) | Free | 0.5 GB, doesn't expire (Render's free Postgres is deleted after 30 days). |
| CI       | GitHub Actions | Free | Unlimited minutes on public repos; a full run is ~3 runner-minutes. |

When you want no cold starts, upgrading the Render service to its smallest
paid instance is the only change needed; nothing in the code or pipeline moves.

## 1. Database (Neon)

1. Sign up at <https://neon.tech> and create a project (Postgres 16, region
   near `us-east` to match Render's default).
2. Copy the connection string. Use the **direct** (non-pooled) one, without
   `-pooler` in the hostname, because Prisma migrations need a direct
   connection. It looks like
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.

## 2. API (Render)

1. Sign up at <https://render.com> with your GitHub account.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml` and
   proposes a free web service named `gwu-research-api`.
3. When asked for `DATABASE_URL`, paste the Neon string. Apply.
4. The first deploy runs `prisma migrate deploy`, which creates the tables.
5. In the service's **Settings → Deploy Hook**, copy the hook URL.
6. Note the service URL (e.g. `https://gwu-research-api.onrender.com/`).
   Opening it in a browser shows Apollo Sandbox.

## 3. Load the data (once)

The tables start empty. From your machine, pick one:

**Copy your local database** (keeps the LLM-enriched interests):

```bash
pg_dump --data-only --no-owner --exclude-table=_prisma_migrations "postgresql://postgres:postgres@localhost:5432/gwu_research" \
  | psql "<neon connection string>"
```

**Or seed from the scraped JSON** (scraped interests only):

```bash
cd server
DATABASE_URL="<neon connection string>" npm run seed
# or point at a file elsewhere: SEED_DATA_PATH=/path/to/faculty_details.json
```

## 4. Wire up GitHub

In the repository on GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions**:
   - **Secrets** tab → `RENDER_DEPLOY_HOOK_URL` = the hook URL from step 2.5.
   - **Variables** tab → `VITE_GRAPHQL_URL` = the Render service URL from 2.6.
3. **Actions → CI/CD → Run workflow** on `main` (or push any commit).

The site appears at `https://<your-username>.github.io/gwu-research-discovery-engine/`.
Put that and the Render URL at the top of the README.

Until the secret and variable exist, the deploy jobs skip themselves, so CI
stays green while you're setting up.

## Day-to-day workflow

1. Branch, change, open a PR. CI must pass.
2. Merge. CI runs again on `main`, then both deploys happen automatically.
3. Schema change? Run `npx prisma migrate dev --name <change>` locally and
   commit the generated migration. CI applies it to a fresh database; Render
   applies it to Neon during the build, and a failing migration aborts the
   deploy while the previous version keeps serving.
4. Dependabot opens grouped update PRs monthly; merge them when green.

Recommended once: **Settings → Branches → add a rule for `main`** requiring
the three `Server`, `Client` and `Scraper` CI checks, so nothing unverified can merge.

## Environment variables

| Where | Variable | Purpose |
|-------|----------|---------|
| Render | `DATABASE_URL` | Neon connection string |
| Render | `NODE_ENV=production` | Set by `render.yaml`; disables mutations |
| Render | `ALLOW_MUTATIONS` | Optional. `true` re-enables writes (there's no auth, so leave it unset on a public deploy) |
| GitHub variable | `VITE_GRAPHQL_URL` | API URL baked into the client build |
| GitHub variable | `VITE_BASE` | Optional. `/` if you put the client on a custom domain |
| GitHub secret | `RENDER_DEPLOY_HOOK_URL` | Lets CI trigger API deploys |
