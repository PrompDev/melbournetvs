# Melbourne TVs site

The Astro 7 static site builds from this directory and publishes `dist/` through Cloudflare Pages.

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

Cloudflare Pages settings:

- Root directory: `astro`
- Build command: `pnpm run build`
- Output directory: `dist`
- Production branch: `main`
