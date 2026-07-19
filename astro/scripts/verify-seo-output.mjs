/**
 * Verify the production build is crawlable without running JavaScript.
 *
 * The XML sitemap is the source of truth for public canonical URLs. Every
 * listed URL must map to a real static HTML file containing its primary SEO
 * signals in the response body. The reverse check also catches public pages
 * that were built but accidentally omitted from the sitemap.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SITE = "https://melbournetvs.com";
const SITEMAP_URL = `${SITE}/sitemap.xml`;

const errors = [];

function fail(message) {
  errors.push(message);
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function tags(html, name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2]?.trim() ?? "";
}

function hasNoindex(html) {
  return tags(html, "meta").some((tag) =>
    attribute(tag, "name").toLowerCase() === "robots" &&
    attribute(tag, "content").toLowerCase().split(/[\s,]+/).includes("noindex")
  );
}

function canonicalLinks(html) {
  return tags(html, "link").filter((tag) =>
    attribute(tag, "rel").toLowerCase().split(/\s+/).includes("canonical")
  );
}

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function outputFileFor(url) {
  const pathname = new URL(url).pathname;
  if (pathname === "/") return path.join(DIST, "index.html");
  return path.join(DIST, ...pathname.split("/").filter(Boolean), "index.html");
}

function routeForIndexFile(file) {
  const relative = path.relative(DIST, file).replace(/\\/g, "/");
  if (relative === "index.html") return "/";
  return `/${relative.replace(/\/index\.html$/, "")}/`;
}

if (!fs.existsSync(DIST)) fail("dist/ is missing; run the Astro build first");

const robotsPath = path.join(DIST, "robots.txt");
if (!fs.existsSync(robotsPath)) {
  fail("robots.txt is missing from the production output");
} else {
  const robots = fs.readFileSync(robotsPath, "utf8");
  if (!/^User-agent:\s*\*/im.test(robots)) fail("robots.txt has no default crawler group");
  if (!/^Allow:\s*\/$/im.test(robots)) fail("robots.txt does not allow the public site");
  if (!new RegExp(`^Sitemap:\\s*${SITEMAP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "im").test(robots)) {
    fail(`robots.txt does not advertise ${SITEMAP_URL}`);
  }
}

const sitemapPath = path.join(DIST, "sitemap.xml");
let sitemapUrls = [];
let sitemapImageUrls = [];
let sitemapUrlBlocks = [];
if (!fs.existsSync(sitemapPath)) {
  fail("sitemap.xml is missing from the production output");
} else {
  const sitemap = fs.readFileSync(sitemapPath, "utf8");
  if (!/xmlns:image=["']http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1["']/.test(sitemap)) {
    fail("sitemap.xml is missing the Google image sitemap namespace");
  }
  sitemapUrls = [...sitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => decodeXml(match[1].trim()));
  sitemapImageUrls = [...sitemap.matchAll(/<image:loc>([\s\S]*?)<\/image:loc>/gi)].map((match) => decodeXml(match[1].trim()));
  sitemapUrlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => match[1]);
  if (sitemapUrls.length === 0) fail("sitemap.xml contains no URLs");
  if (sitemapImageUrls.length === 0) fail("sitemap.xml contains no image URLs");
}

for (const imageUrl of sitemapImageUrls) {
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "https:") fail(`sitemap image URL is not HTTPS: ${imageUrl}`);
  } catch {
    fail(`invalid sitemap image URL: ${imageUrl}`);
  }
}

for (const block of sitemapUrlBlocks) {
  const pageUrl = decodeXml(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim() ?? "");
  const pathname = pageUrl ? new URL(pageUrl).pathname : "";
  const requiresImage =
    /^\/locations\/[^/]+\/$/.test(pathname) ||
    (/^\/services\/[^/]+\/$/.test(pathname) && pathname !== "/services/starlink-installation/");
  if (requiresImage && !/<image:image>/.test(block)) {
    fail(`${pathname} is missing its image sitemap entry`);
  }
}

const sitemapSet = new Set(sitemapUrls);
if (sitemapSet.size !== sitemapUrls.length) fail("sitemap.xml contains duplicate URLs");

for (const url of sitemapUrls) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`invalid sitemap URL: ${url}`);
    continue;
  }

  if (parsed.origin !== SITE || parsed.search || parsed.hash) {
    fail(`sitemap URL is not a clean canonical production URL: ${url}`);
  }

  const file = outputFileFor(url);
  if (!fs.existsSync(file)) {
    fail(`sitemap URL has no static HTML file: ${url}`);
    continue;
  }

  const html = fs.readFileSync(file, "utf8");
  const route = parsed.pathname;
  const titles = html.match(/<title\b[^>]*>[\s\S]*?<\/title>/gi) ?? [];
  const descriptions = tags(html, "meta").filter((tag) => attribute(tag, "name").toLowerCase() === "description");
  const h1s = html.match(/<h1\b[^>]*>/gi) ?? [];
  const canonicals = canonicalLinks(html);
  const text = visibleText(html);

  if (!/^<!doctype html>/i.test(html.trimStart())) fail(`${route} is not a complete HTML document`);
  if (!/<html\b[^>]*\blang=["']en-AU["']/i.test(html)) fail(`${route} is missing lang=\"en-AU\"`);
  if (titles.length !== 1) fail(`${route} has ${titles.length} title elements; expected 1`);
  if (descriptions.length !== 1 || attribute(descriptions[0] ?? "", "content").length < 40) {
    fail(`${route} needs one substantive meta description`);
  }
  if (h1s.length !== 1) fail(`${route} has ${h1s.length} H1 elements; expected 1`);
  if (canonicals.length !== 1) {
    fail(`${route} has ${canonicals.length} canonical links; expected 1`);
  } else if (attribute(canonicals[0], "href") !== url) {
    fail(`${route} canonical does not match its sitemap URL`);
  }
  if (hasNoindex(html)) fail(`${route} is in the sitemap but marked noindex`);
  if (text.length < 500) fail(`${route} has too little text in the initial HTML (${text.length} characters)`);
}

if (fs.existsSync(DIST)) {
  const builtIndexFiles = walk(DIST).filter((file) => path.basename(file) === "index.html");
  for (const file of builtIndexFiles) {
    const html = fs.readFileSync(file, "utf8");
    if (hasNoindex(html)) continue;
    const route = routeForIndexFile(file);
    const canonicalUrl = new URL(route, SITE).toString();
    if (!sitemapSet.has(canonicalUrl)) fail(`indexable built page is missing from sitemap.xml: ${route}`);
  }
}

if (errors.length > 0) {
  console.error("\nSEO output verification failed:\n");
  for (const error of errors) console.error(`  - ${error}`);
  console.error("");
  process.exit(1);
}

console.log(`\nSEO output verified: ${sitemapUrls.length} canonical URLs and ${sitemapImageUrls.length} image entries.`);
