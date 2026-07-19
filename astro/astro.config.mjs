import { defineConfig } from 'astro/config';

// Canonical production URL. Used by RSS/absolute URLs in meta tags.
//
// NOTE: @astrojs/sitemap was removed for now — its build:done hook was
// throwing `Cannot read properties of undefined (reading 'reduce')` on the
// admin-nav redirect routes, which blocked the build (exit 1) and would
// fail Cloudflare Pages deploys. Re-enable once we either patch the
// integration or replace with a hand-rolled sitemap generator.
export default defineConfig({
  site: 'https://melbournetvs.com',
  integrations: [],
  build: {
    format: 'directory'
  }
});
