import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// ===== BLOG =====
const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/blog" }),
  schema: () =>
    z.object({
      title: z.string().min(8).max(120),
      description: z.string().min(40).max(200),
      heroImage: z.string(),
      heroAlt: z.string().min(8),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      author: z.string().default("Melbourne TVs Team"),
      // NOTE: field is called `style` (not `layout`) because Astro's markdown
      // integration treats a `layout:` frontmatter field as a magic module-import
      // path — so `layout: "custom"` was being resolved as `import 'custom'`
      // and throwing "Cannot find module 'custom'". Using `style` avoids that.
      style: z.enum(["standard", "service-guide", "location", "custom"]).default("custom"),
      suburb: z.string().optional(),
      service: z.string().optional(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
      readTime: z.number().int().positive().optional(),
      // imageBriefs is a drafting aid — it describes what each IMAGE:xxx
      // placeholder should depict. Stored as an array of {slot, description,
      // alt} so it round-trips through Decap's list widget cleanly. The
      // bulk uploader strips this block when it rewrites placeholders to
      // real /media/ paths, so final production posts don't carry it.
      // Optional so both states (pre-upload draft and post-upload final)
      // validate cleanly.
      imageBriefs: z
        .array(
          z.object({
            slot: z.string(),
            description: z.string().optional(),
            alt: z.string().optional(),
          })
        )
        .optional(),
    }),
});

// ===== SERVICES =====
// Structured service-landing-page content. Emits schema.org/Service JSON-LD
// from the layout. Price + serviceArea drive the SEO offer + local-targeting
// signals; faq drives a FAQPage JSON-LD block.
const services = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/services" }),
  schema: () =>
    z.object({
      title: z.string().min(8).max(120),
      description: z.string().min(40).max(200),
      heroImage: z.string(),
      heroAlt: z.string().min(8),
      heroWidth: z.number().int().positive().optional(),
      heroHeight: z.number().int().positive().optional(),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      // Pricing (drives the Offer in schema.org/Service)
      priceFrom: z.number().positive().optional(),
      priceTo: z.number().positive().optional(),
      priceCurrency: z.string().default("AUD"),
      priceUnit: z.string().default("per job"),
      duration: z.string().optional(),
      // What the visitor needs to know at a glance
      highlights: z.array(z.string()).default([]),
      // Service delivery
      serviceArea: z.array(z.string()).default([]),
      warranty: z.string().optional(),
      // SEO cross-links + FAQ
      relatedServices: z.array(z.string()).default([]),
      relatedLocations: z.array(z.string()).default([]),
      faq: z
        .array(z.object({ q: z.string(), a: z.string() }))
        .default([]),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

// ===== LOCATIONS =====
// Suburb-level landing pages. Coordinates + postcode power the
// schema.org/LocalBusiness JSON-LD; nearbySuburbs + servicesOffered
// handle the internal-linking skeleton.
const locations = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/locations" }),
  schema: () =>
    z.object({
      title: z.string().min(8).max(120),
      description: z.string().min(40).max(200),
      heroImage: z.string(),
      heroAlt: z.string().min(8),
      // Set only when the business has verified where the pictured job occurred.
      // Layouts use this to avoid inventing suburb provenance for shared images.
      photoLocation: z.string().optional(),
      heroWidth: z.number().int().positive().optional(),
      heroHeight: z.number().int().positive().optional(),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      suburb: z.string(),
      postcode: z.string().optional(),
      region: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      travelTimeFromCbd: z.string().optional(),
      commonHousingStock: z.array(z.string()).default([]),
      nearbySuburbs: z.array(z.string()).default([]),
      servicesOffered: z.array(z.string()).default([]),
      jobCount: z.number().int().nonnegative().optional(),
      faq: z
        .array(z.object({ q: z.string(), a: z.string() }))
        .default([]),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

// ===== PRODUCTS =====
// TV / AV product pages. Emits schema.org/Product JSON-LD with an Offer.
// recommendedMounts lets us cross-link to the mounts collection.
const products = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/products" }),
  schema: () =>
    z.object({
      title: z.string().min(8).max(120),
      description: z.string().min(40).max(200),
      heroImage: z.string(),
      heroAlt: z.string().min(8),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      brand: z.string(),
      model: z.string(),
      sku: z.string().optional(),
      category: z.enum(["tv", "soundbar", "media-box", "cable", "accessory"]).default("tv"),
      priceAud: z.number().positive(),
      priceWas: z.number().positive().optional(),
      availability: z.enum(["InStock", "OutOfStock", "PreOrder"]).default("InStock"),
      // Specs
      screenSizeInches: z.number().positive().optional(),
      resolution: z.string().optional(),
      panelType: z.string().optional(),
      refreshRateHz: z.number().int().positive().optional(),
      hdrSupport: z.array(z.string()).default([]),
      vesa: z.string().optional(),
      weightKg: z.number().positive().optional(),
      // Review
      pros: z.array(z.string()).default([]),
      cons: z.array(z.string()).default([]),
      rating: z.number().min(0).max(5).optional(),
      reviewCount: z.number().int().nonnegative().optional(),
      // Commerce
      affiliateUrl: z.string().url().optional(),
      recommendedMounts: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

// ===== MOUNTS =====
// Wall-mount / bracket product pages. Same schema.org/Product backbone as
// products, plus mount-specific spec fields that show up in the visible
// spec table and in the JSON-LD additionalProperty list.
const mounts = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: "./src/content/mounts" }),
  schema: () =>
    z.object({
      title: z.string().min(8).max(120),
      description: z.string().min(40).max(200),
      heroImage: z.string(),
      heroAlt: z.string().min(8),
      publishDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      brand: z.string(),
      model: z.string(),
      sku: z.string().optional(),
      mountType: z.enum(["fixed", "tilt", "full-motion", "ceiling", "outdoor"]).default("full-motion"),
      priceAud: z.number().positive(),
      priceWas: z.number().positive().optional(),
      availability: z.enum(["InStock", "OutOfStock", "PreOrder"]).default("InStock"),
      // Compatibility
      minScreenInches: z.number().positive(),
      maxScreenInches: z.number().positive(),
      maxWeightKg: z.number().positive(),
      vesaMin: z.string().optional(),
      vesaMax: z.string().optional(),
      // Motion + geometry
      tiltDegrees: z.number().nonnegative().optional(),
      swivelDegrees: z.number().nonnegative().optional(),
      extensionMm: z.number().nonnegative().optional(),
      profileMm: z.number().nonnegative().optional(),
      finish: z.string().optional(),
      // Review
      pros: z.array(z.string()).default([]),
      cons: z.array(z.string()).default([]),
      rating: z.number().min(0).max(5).optional(),
      reviewCount: z.number().int().nonnegative().optional(),
      affiliateUrl: z.string().url().optional(),
      compatibleTvs: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog, services, locations, products, mounts };
