# RSInvest Trading Dashboard

Trading journal with a local-first Personal Performance Dashboard at `/performance`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev:performance
```

Open `http://localhost:5185/performance`. Port `5185` is reserved for isolated Performance Dashboard development so it does not collide with the Trading Dashboard or Macro Trading Dashboard. The existing `npm run dev` command remains unchanged for the integrated project.

Performance check-ins are stored in the browser under the `rsinvest-performance-v1` localStorage key. Mock history is added only on the first visit.

Create a production build with:

```bash
npm run build
npm run preview
```

## Deploy to Netlify

1. Import the repository in Netlify.
2. Use `npm run build` as the build command and `dist` as the publish directory.
3. Deploy. The existing SPA fallback in `netlify.toml` keeps `/performance` available on direct visits.

No backend or environment variables are required for the performance module.
