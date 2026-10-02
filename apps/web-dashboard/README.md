# web-dashboard

React + Vite dashboard for the self-hosted diditbreak service: run history,
per-run diffs, live progress over SSE, and a playground.

```bash
corepack pnpm --filter @diditbreak/web-dashboard dev
```

Set `VITE_DIDITBREAK_API_URL` when the API is not on `http://127.0.0.1:4000`.
