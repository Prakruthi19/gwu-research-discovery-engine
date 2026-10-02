# Client

React 19 + Vite + Apollo Client 4 front end for the GWU Research Discovery
Engine. See the [root README](../README.md) for the full picture.

```bash
npm install
npm run dev      # http://localhost:5173 (expects the API on :4000)
npm run lint     # oxlint
npm run build    # production bundle in dist/
```

Environment (build time, see `.env.example`):

| Variable           | Purpose                                              |
|--------------------|------------------------------------------------------|
| `VITE_GRAPHQL_URL` | GraphQL endpoint. Defaults to `http://localhost:4000/`. |
| `VITE_BASE`        | Public base path. Set to `/<repo>/` for GitHub Pages.  |
