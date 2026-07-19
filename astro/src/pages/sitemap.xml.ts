/**
 * /sitemap.xml — hand-rolled sitemap generator.
 *
 * Replaces @astrojs/sitemap, which was throwing `Cannot read properties of
 * undefined (reading 'reduce')` on our admin-nav routes and blocking the
 * Cloudflare Pages build. A 30-line static endpoint is easier to reason
 * about anyway, and it gives us total control over:
 *
 *   1. WHICH pages ship (admin UI excluded, drafts filtered out)
 *   2. `lastmod` tags pulled from frontmatter (updatedDate ?? publishDate)
 *   3. only canonical, indexable URLs (no admin or protected staff routes)
 *
 * Runs at build time because this is a static Astro site — the exported
 * GET handler is invoked once during `astro build` and the result is
 * written to dist/sitemap.xml verbatim.
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { INSTALLATION_IMAGES, getLocationImage } from "~/data/installationImages";

const SITE = "https://melbournetvs.com";

// A shared layout and structured-data correction materially changed every
// public page on this date. Keep this floor honest: only advance it when a
// future shared change alters visible content, structured data, or links.
const SHARED_PUBLIC_LASTMOD = "2026-07-14";

/** Format a Date for sitemap <lastmod> (W3C datetime — yyyy-mm-dd). */
function lastmod(d?: Date, floor = ""): string {
  const value = d instanceof Date && !isNaN(d.valueOf())
    ? d.toISOString().slice(0, 10)
    : "";
  return value > floor ? value : floor;
}

/** XML-escape a URL/string. Sitemaps are strict about ampersands. */
function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface Url {
  loc: string;
  lastmod?: string;
  images?: string[];
}

function absoluteImageUrl(value: string): string {
  return new URL(value, SITE).toString();
}

export const GET: APIRoute = async () => {
  const urls: Url[] = [];

  // ---- Static top-level pages ----
  urls.push(
    {
      loc: "/",
      lastmod: SHARED_PUBLIC_LASTMOD,
      images: INSTALLATION_IMAGES.map((image) => image.url),
    },
    { loc: "/pricing/", lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/quote/",   lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/privacy/", lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/terms/",   lastmod: SHARED_PUBLIC_LASTMOD },
  );

  // ---- Collection hubs ----
  urls.push(
    { loc: "/blog/",      lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/services/",  lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/locations/", lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/products/",  lastmod: SHARED_PUBLIC_LASTMOD },
    { loc: "/mounts/",    lastmod: SHARED_PUBLIC_LASTMOD },
  );

  // ---- Collection entries (drafts excluded) ----
  const [blog, services, locations, products, mounts] = await Promise.all([
    getCollection("blog",      ({ data }) => !data.draft),
    getCollection("services",  ({ data }) => !data.draft),
    getCollection("locations", ({ data }) => !data.draft),
    getCollection("products",  ({ data }) => !data.draft),
    getCollection("mounts",    ({ data }) => !data.draft),
  ]);

  for (const p of blog) {
    urls.push({
      loc: `/blog/${p.id}/`,
      lastmod: lastmod(p.data.updatedDate ?? p.data.publishDate, SHARED_PUBLIC_LASTMOD),
      images: [absoluteImageUrl(p.data.heroImage)],
    });
  }
  for (const s of services) {
    urls.push({
      loc: `/services/${s.id}/`,
      lastmod: lastmod(s.data.updatedDate ?? s.data.publishDate, SHARED_PUBLIC_LASTMOD),
      images: s.id === "starlink-installation"
        ? undefined
        : [absoluteImageUrl(s.data.heroImage)],
    });
  }
  for (const l of locations) {
    urls.push({
      loc: `/locations/${l.id}/`,
      lastmod: lastmod(l.data.updatedDate ?? l.data.publishDate, SHARED_PUBLIC_LASTMOD),
      images: [
        l.data.photoLocation
          ? absoluteImageUrl(l.data.heroImage)
          : getLocationImage(l.id).url,
      ],
    });
  }
  for (const p of products) {
    urls.push({
      loc: `/products/${p.id}/`,
      lastmod: lastmod(p.data.updatedDate ?? p.data.publishDate, SHARED_PUBLIC_LASTMOD),
    });
  }
  for (const m of mounts) {
    urls.push({
      loc: `/mounts/${m.id}/`,
      lastmod: lastmod(m.data.updatedDate ?? m.data.publishDate, SHARED_PUBLIC_LASTMOD),
      images: [absoluteImageUrl(m.data.heroImage)],
    });
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    urls
      .map((u) => {
        const parts = [`  <url>`, `    <loc>${xml(SITE + u.loc)}</loc>`];
        if (u.lastmod) parts.push(`    <lastmod>${u.lastmod}</lastmod>`);
        for (const image of u.images ?? []) {
          parts.push(
            `    <image:image>`,
            `      <image:loc>${xml(image)}</image:loc>`,
            `    </image:image>`,
          );
        }
        parts.push(`  </url>`);
        return parts.join("\n");
      })
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
