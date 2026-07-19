/**
 * audit-links.mjs — walks the built dist/ folder, extracts every href="/..." from
 * every generated HTML file, and prints which ones point at a route that doesn't
 * exist as a physical file in dist/.
 *
 * Ignored: tel:, mailto:, #, http(s) externals, /api/n8n/* webhooks, and
 * /operations/api/* Pages Functions resolved at runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "..", "dist");

// Recursively collect every file under dist/.
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function relDist(fullPath) {
  return "/" + path.relative(DIST, fullPath).replace(/\\/g, "/");
}

/**
 * A link resolves if:
 *   - /foo/       ↔ dist/foo/index.html  exists
 *   - /foo.html   ↔ dist/foo.html        exists
 *   - /foo        ↔ dist/foo OR dist/foo/index.html exists
 *   - /foo/bar.ext (pdf, md, css, js, png…) ↔ dist/foo/bar.ext exists
 */
function linkResolves(link, fileSet) {
  // Strip query + hash before resolving.
  const clean = link.split("#")[0].split("?")[0];
  if (clean === "" || clean === "/") return fileSet.has("/index.html");
  if (clean.endsWith("/")) return fileSet.has(clean + "index.html");
  if (fileSet.has(clean)) return true;
  if (fileSet.has(clean + "/index.html")) return true;
  return false;
}

const files = walk(DIST);
const fileSet = new Set(files.map(relDist));

// The private editing dashboard intentionally links to draft previews that
// have no public route. Audit the customer-facing build, not those editor-only
// links, or a correctly staged draft would fail deployment.
const htmlFiles = files.filter(
  (f) => f.endsWith(".html") && !relDist(f).startsWith("/admin-nav/"),
);

const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const broken = []; // { file, link }
const stats = { total: 0, internal: 0, checked: 0, broken: 0 };

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  // Only audit links that exist in the initial HTML document. JavaScript
  // template strings can contain href="..." text that is not an actual link
  // (and is invisible to a non-rendering crawler). CSS comments can contain
  // example markup for the same reason.
  const staticHtml = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  let m;
  while ((m = HREF_RE.exec(staticHtml)) !== null) {
    const link = (m[1] ?? m[2] ?? "").trim();
    stats.total++;
    if (!link) continue;
    // Skip non-static-resolvable schemes + fragment-only + externals.
    if (/^(tel:|mailto:|https?:|javascript:|data:)/i.test(link)) continue;
    if (link.startsWith("#")) continue;
    if (!link.startsWith("/")) continue; // relative links — treat as external to this audit
    // Skip the n8n webhook namespace (resolved by n8n at runtime, not here).
    if (link.startsWith("/api/n8n/")) continue;
    // Staff downloads and data endpoints are Pages Functions, not dist files.
    if (link.startsWith("/operations/api/")) continue;
    stats.internal++;
    stats.checked++;
    if (!linkResolves(link, fileSet)) {
      stats.broken++;
      broken.push({ file: relDist(file), link });
    }
  }
}

// Group by unique broken link + count referrers.
const grouped = new Map();
for (const { file, link } of broken) {
  if (!grouped.has(link)) grouped.set(link, new Set());
  grouped.get(link).add(file);
}

console.log(`\nLink audit — dist/`);
console.log(`  HTML files scanned    : ${htmlFiles.length}`);
console.log(`  Total <a href> seen   : ${stats.total}`);
console.log(`  Internal links        : ${stats.internal}`);
console.log(`  Broken internal links : ${stats.broken}\n`);

if (grouped.size === 0) {
  console.log("✓ All internal links resolve.\n");
  process.exit(0);
}

console.log("Broken links (grouped):");
for (const [link, refs] of [...grouped.entries()].sort()) {
  console.log(`  × ${link}   — referenced ${refs.size} time${refs.size === 1 ? "" : "s"}`);
  const refArr = [...refs].slice(0, 4);
  for (const r of refArr) console.log(`      from ${r}`);
  if (refs.size > 4) console.log(`      …and ${refs.size - 4} more`);
}
console.log("");
process.exit(1);
