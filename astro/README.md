# Melbourne TVs site

The Astro 7 static site builds from this directory. The Melbourne lead Worker publishes `dist/` as Cloudflare Workers static assets.

- `public/index.html` is the homepage.
- `src/pages/` contains the intentional public routes.
- `src/content/services/` contains the four verified launch service pages.
- `src/content/locations/` contains 74 generated suburb drafts. They remain unpublished until installer coverage is approved.
- `src/content.config.ts` defines the Astro Content Layer collections.

Use Node 20-24 and pnpm:

```text
pnpm install
pnpm run build
pnpm audit --prod
```

Deployment runs from `../workers`: build this site first, then deploy the Worker. Its Wrangler configuration binds `../astro/dist`, runs Worker code first for `/api/*`, and serves all other requests as static assets.
