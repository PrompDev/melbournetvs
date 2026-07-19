const MAX_FILES = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PUBLIC_REQUEST_BYTES = MAX_FILES * MAX_FILE_BYTES + 1024 * 1024;
const MAX_SYNC_REQUEST_BYTES = 512 * 1024;
const MAX_SYNC_BATCH = 15;
const SYNC_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const SYNC_REPLAY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MELBOURNE_TIME_ZONE = "Australia/Melbourne";
const WEBSITE_SHEET_DESTINATION = "google_sheet";
export const WEBSITE_SHEET_NAME = "Leads";
const WEBSITE_SHEET_REQUEST_TIMEOUT_MS = 10_000;
const WEBSITE_SHEET_MAX_RESPONSE_BYTES = 32 * 1024;
const WEBSITE_SHEET_MAX_ATTEMPTS = 8;
const WEBSITE_SHEET_BATCH_LIMIT = 5;
export const WEBSITE_SHEET_HEADERS = Object.freeze([
  "id",
  "created_time",
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "form_name",
  "is_organic",
  "platform",
  "want_to_get_your_tv_mounted",
  "what_size_is_your_tv",
  "email",
  "full_name",
  "phone_number",
  "postcode",
]);

const FIELD_LIMITS = Object.freeze({
  name: 160,
  email: 254,
  phone: 64,
  suburb: 120,
  postcode: 20,
  source: 64,
  platform: 96,
  externalId: 160,
  service: 160,
  tvSize: 80,
  wallType: 120,
  preferredDate: 100,
  message: 4000,
  pageUrl: 2048,
  campaign: 200,
  fileName: 255,
  contentType: 128,
  trackingValue: 512,
});

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
}

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
  }
}

class ServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ServiceError";
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowed = new Set([
    "https://melbournetvs.com",
    "https://www.melbournetvs.com",
    "https://melbournetvs.pages.dev",
  ]);

  if (!origin || !allowed.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUploadedFile(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.name === "string"
    && typeof value.size === "number"
    && typeof value.type === "string"
    && typeof value.stream === "function";
}

function boundedText(value, limit, label) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new InputError("Invalid field: " + label);
  }

  const text = String(value).trim();
  if (text.length > limit) {
    throw new InputError(label + " is too long");
  }
  return text;
}

function pickText(record, names, limit, label) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(record, name)) continue;
    const value = boundedText(record[name], limit, label);
    if (value) return value;
  }
  return "";
}

function requireText(value, label) {
  if (!value) throw new InputError("Missing field: " + label);
  return value;
}

function normalizeEmail(value) {
  const email = boundedText(value, FIELD_LIMITS.email, "email").toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InputError("Invalid email address");
  }
  return email;
}

function normalizePhoneForIdentity(phone) {
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("61") && digits.length >= 10) {
    digits = "0" + digits.slice(2);
  }
  return digits;
}

function normalizeSource(value, fallback) {
  const source = boundedText(value || fallback, FIELD_LIMITS.source, "source");
  if (!source) throw new InputError("Missing field: source");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(source)) {
    throw new InputError("Invalid field: source");
  }
  return source;
}

function publicPageUrl(value) {
  const text = boundedText(value, FIELD_LIMITS.pageUrl, "page_url");
  if (!text) return "";

  try {
    const url = new URL(text, "https://melbournetvs.com");
    const host = url.hostname.toLowerCase();
    const isProduction = host === "melbournetvs.com" || host === "www.melbournetvs.com";
    const isPreview = host === "melbournetvs.pages.dev";
    if (url.protocol !== "https:" || (!isProduction && !isPreview)) return "";
    const origin = isProduction ? "https://melbournetvs.com" : url.origin;
    return (origin + url.pathname).slice(0, FIELD_LIMITS.pageUrl);
  } catch {
    return "";
  }
}

function publicLandingPath(value) {
  const text = boundedText(value, FIELD_LIMITS.trackingValue, "tracking.landing_page");
  if (!text || !text.startsWith("/") || /[?#\r\n]/.test(text)) return "";
  return text;
}

function publicReferrer(value) {
  const text = boundedText(value, FIELD_LIMITS.trackingValue, "tracking.referrer");
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return (url.origin + url.pathname).slice(0, FIELD_LIMITS.trackingValue);
  } catch {
    return "";
  }
}

function normalizeExternalId(value) {
  const externalId = boundedText(value, FIELD_LIMITS.externalId, "external_id");
  if (!externalId) throw new InputError("Missing field: external_id");
  return externalId;
}

function publicSubmissionId(record) {
  const value = pickText(record, ["submission_id"], FIELD_LIMITS.externalId, "submission_id");
  if (!value) return crypto.randomUUID();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,159}$/.test(value)) {
    throw new InputError("Invalid field: submission_id");
  }
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeReceivedAt(value, fallbackToNow = false) {
  const text = boundedText(value, 64, "received_at");
  if (!text && fallbackToNow) return nowIso();
  if (!text) throw new InputError("Missing field: received_at");

  const receivedAt = new Date(text);
  if (Number.isNaN(receivedAt.getTime())) {
    throw new InputError("Invalid field: received_at");
  }
  return receivedAt.toISOString();
}

function melbourneDay(isoTimestamp) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoTimestamp));

  const values = {};
  for (const part of parts) values[part.type] = part.value;
  return values.year + "-" + values.month + "-" + values.day;
}

function serialiseTracking(raw, pageUrl) {
  const source = isRecord(raw.tracking) ? raw.tracking : raw;
  const tracking = {};
  const keys = [
    "referrer",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "landing_page",
    "source_platform",
  ];

  for (const key of keys) {
    const rawValue = pickText(source, [key], FIELD_LIMITS.trackingValue, "tracking." + key);
    const value = key === "landing_page"
      ? publicLandingPath(rawValue)
      : key === "referrer"
        ? publicReferrer(rawValue)
        : rawValue;
    if (value) tracking[key] = value;
  }
  if (pageUrl) tracking.page_url = pageUrl;
  return JSON.stringify(tracking);
}

function attributedPlatform(raw, fallback = "website") {
  const tracking = isRecord(raw.tracking) ? raw.tracking : raw;
  const supplied = pickText(
    tracking,
    ["source_platform", "utm_source"],
    FIELD_LIMITS.platform,
    "tracking.source_platform",
  ).toLowerCase();

  if (supplied === "ig" || supplied.includes("instagram")) return "instagram";
  if (supplied === "fb" || supplied.includes("facebook")) return "facebook";
  if (supplied.includes("meta")) return "meta";
  if (supplied.includes("google")) return "google";
  return boundedText(fallback, FIELD_LIMITS.platform, "platform") || "website";
}

function serialiseDetails(values) {
  const details = {};
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      if (value.length) details[key] = value;
      continue;
    }
    if (value) details[key] = value;
  }
  return JSON.stringify(details);
}

function boundedStringArray(value, maxItems, maxItemLength, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InputError("Invalid field: " + label);
  if (value.length > maxItems) throw new InputError(label + " has too many values");

  return value
    .map((item) => boundedText(item, maxItemLength, label))
    .filter(Boolean);
}

function boundedJsonStringArray(value, maxItems, maxItemLength, label) {
  const raw = boundedText(value, 2048, label);
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InputError("Invalid field: " + label);
  }
  return boundedStringArray(parsed, maxItems, maxItemLength, label);
}

function affirmative(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function boundedTvCount(value) {
  const text = boundedText(value, 2, "job.tv_count");
  if (!text) return "";
  if (!/^(?:[1-9]|10)$/.test(text)) throw new InputError("Invalid field: job.tv_count");
  return Number(text);
}

function assertContentLength(request, maxBytes) {
  const header = request.headers.get("content-length");
  if (!header) return;

  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
    throw new InputError("Submission is too large");
  }
}

async function readTextBounded(request, maxBytes) {
  assertContentLength(request, maxBytes);
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new InputError("Submission is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}

async function parseJsonObject(request, maxBytes) {
  const raw = await readTextBounded(request, maxBytes);
  if (!raw) throw new InputError("Invalid submission body");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InputError("Invalid submission body");
  }

  if (!isRecord(parsed)) throw new InputError("Invalid submission body");
  return { raw, value: parsed };
}

async function parseWebsiteSubmission(request) {
  const contentType = request.headers.get("content-type") || "";
  const fields = {};
  const files = [];

  if (contentType.includes("multipart/form-data")) {
    assertContentLength(request, MAX_PUBLIC_REQUEST_BYTES);
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      if (isUploadedFile(value)) {
        if (!value.name || value.size === 0) continue;
        files.push(value);
      } else {
        fields[key] = value;
      }
    }
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    assertContentLength(request, MAX_PUBLIC_REQUEST_BYTES);
    const form = await request.formData();
    for (const [key, value] of form.entries()) fields[key] = value;
  } else if (contentType.includes("application/json")) {
    const body = await parseJsonObject(request, MAX_SYNC_REQUEST_BYTES);
    Object.assign(fields, body.value);
  } else {
    throw new InputError("Unsupported submission type");
  }

  return { fields, files };
}

function validateWebsiteSubmission(fields, files) {
  const name = pickText(fields, ["name", "fullname", "full_name"], FIELD_LIMITS.name, "name");
  const phone = pickText(fields, ["phone", "mobile"], FIELD_LIMITS.phone, "phone");
  const email = normalizeEmail(pickText(fields, ["email"], FIELD_LIMITS.email, "email"));
  const suburb = pickText(fields, ["suburb"], FIELD_LIMITS.suburb, "suburb");
  const service = pickText(fields, ["service"], FIELD_LIMITS.service, "service");
  const tvSize = pickText(fields, ["tv_size", "tvsize"], FIELD_LIMITS.tvSize, "tv_size");
  const wallType = pickText(fields, ["wall", "wall_type", "wallType"], FIELD_LIMITS.wallType, "wall");
  const postcode = pickText(fields, ["postcode"], FIELD_LIMITS.postcode, "postcode");

  requireText(name, "name");
  requireText(phone, "phone");
  requireText(email, "email");
  requireText(suburb, "suburb");
  requireText(service, "service");
  requireText(tvSize, "tv_size");
  requireText(wallType, "wall");

  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    throw new InputError("Invalid phone number");
  }

  const numericTvSize = Number(tvSize);
  if (!/^\d{2,3}$/.test(tvSize) || !Number.isInteger(numericTvSize) || numericTvSize < 30 || numericTvSize > 130) {
    throw new InputError("Invalid field: tv_size");
  }

  if (postcode && !/^\d{4}$/.test(postcode)) {
    throw new InputError("Invalid field: postcode");
  }

  if (!affirmative(fields.consent)) {
    throw new InputError("Missing field: consent");
  }

  if (files.length > MAX_FILES) {
    throw new InputError("Too many images. Maximum is " + MAX_FILES + ".");
  }
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      throw new InputError("Only image files can be uploaded.");
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new InputError("An uploaded image is too large. Maximum is 10 MB.");
    }
  }
}

function canonicalFromWebsite(fields, uploadCount = 0) {
  const receivedAt = nowIso();
  const fullName = pickText(fields, ["name", "fullname", "full_name"], FIELD_LIMITS.name, "name");
  const email = normalizeEmail(pickText(fields, ["email"], FIELD_LIMITS.email, "email"));
  const phone = pickText(fields, ["phone", "mobile"], FIELD_LIMITS.phone, "phone");
  const suburb = pickText(fields, ["suburb"], FIELD_LIMITS.suburb, "suburb");
  const service = pickText(fields, ["service", "package_label"], FIELD_LIMITS.service, "service");
  const tvSize = pickText(fields, ["tv_size", "tvsize"], FIELD_LIMITS.tvSize, "tv_size");
  const pageUrl = publicPageUrl(
    pickText(fields, ["page_url", "booking_link", "referrer"], FIELD_LIMITS.pageUrl, "page_url"),
  );
  const campaign = pickText(fields, ["campaign", "utm_campaign"], FIELD_LIMITS.campaign, "campaign");
  const addons = boundedJsonStringArray(fields.addons_json, 20, 80, "addons_json");
  const tvCount = boundedTvCount(fields.tv_count ?? fields.tvCount);

  return {
    id: crypto.randomUUID(),
    source: "website",
    externalId: publicSubmissionId(fields),
    receivedAt,
    receivedDay: melbourneDay(receivedAt),
    fullName,
    email,
    phone,
    postcode: pickText(fields, ["postcode"], FIELD_LIMITS.postcode, "postcode"),
    platform: attributedPlatform(
      fields,
      pickText(fields, ["platform"], FIELD_LIMITS.platform, "platform") || "website",
    ),
    tvSize,
    suburb,
    service,
    wallType: pickText(fields, ["wall", "wall_type", "wallType"], FIELD_LIMITS.wallType, "wall"),
    preferredDate: pickText(fields, ["preferred_date", "preferredDay", "date"], FIELD_LIMITS.preferredDate, "preferred_date"),
    message: pickText(fields, ["message", "details", "notes"], FIELD_LIMITS.message, "message"),
    pageUrl,
    campaign,
    trackingJson: serialiseTracking(fields, pageUrl),
    detailsJson: serialiseDetails({
      intake: "website-form",
      form_source: pickText(fields, ["form_source", "source"], FIELD_LIMITS.platform, "form_source"),
      package: pickText(fields, ["package"], FIELD_LIMITS.service, "package"),
      tv_count: tvCount,
      tv_brand: pickText(fields, ["tv_brand", "tvBrand"], FIELD_LIMITS.name, "tv_brand"),
      addons,
      photos_attached_count: Math.min(uploadCount, MAX_FILES),
      quote_contact_consent: affirmative(fields.consent) ? 1 : 0,
      marketing_consent: affirmative(fields.marketing_consent) ? 1 : 0,
    }),
    marketingConsent: affirmative(fields.marketing_consent) ? 1 : 0,
  };
}

function canonicalFromN8n(body) {
  const lead = isRecord(body.lead) ? body.lead : {};
  const job = isRecord(body.job) ? body.job : {};
  const tracking = isRecord(body.tracking) ? body.tracking : {};
  const receivedAt = nowIso();
  const fullName = pickText(lead, ["name", "full_name", "fullname"], FIELD_LIMITS.name, "name")
    || pickText(body, ["name", "full_name", "fullname"], FIELD_LIMITS.name, "name");
  const email = normalizeEmail(
    pickText(lead, ["email"], FIELD_LIMITS.email, "email")
      || pickText(body, ["email"], FIELD_LIMITS.email, "email"),
  );
  const phone = pickText(lead, ["phone", "mobile"], FIELD_LIMITS.phone, "phone")
    || pickText(body, ["phone", "mobile"], FIELD_LIMITS.phone, "phone");
  const pageUrl = publicPageUrl(pickText(body, ["page_url"], FIELD_LIMITS.pageUrl, "page_url"));
  const campaign = pickText(tracking, ["utm_campaign"], FIELD_LIMITS.campaign, "tracking.utm_campaign");
  const packageName = pickText(job, ["package_label", "package"], FIELD_LIMITS.service, "job.package");
  const addons = boundedStringArray(job.addons, 20, 80, "job.addons");
  const tvCount = boundedTvCount(job.tv_count ?? job.tvCount);

  if (!email && !phone) {
    throw new InputError("Please provide an email address or phone number.");
  }

  return {
    id: crypto.randomUUID(),
    source: "website",
    externalId: publicSubmissionId(body),
    receivedAt,
    receivedDay: melbourneDay(receivedAt),
    fullName,
    email,
    phone,
    postcode: pickText(lead, ["postcode"], FIELD_LIMITS.postcode, "postcode"),
    platform: attributedPlatform(body, "website"),
    tvSize: pickText(job, ["tv_size", "tvSize"], FIELD_LIMITS.tvSize, "job.tv_size"),
    suburb: pickText(lead, ["suburb"], FIELD_LIMITS.suburb, "suburb"),
    service: packageName,
    wallType: pickText(job, ["wall_type", "wallType"], FIELD_LIMITS.wallType, "job.wall_type"),
    preferredDate: pickText(job, ["preferred_date", "preferredDay"], FIELD_LIMITS.preferredDate, "job.preferred_date"),
    message: pickText(job, ["notes", "message"], FIELD_LIMITS.message, "job.notes"),
    pageUrl,
    campaign,
    trackingJson: serialiseTracking(body, pageUrl),
    detailsJson: serialiseDetails({
      intake: "website-json",
      form_source: pickText(body, ["source"], FIELD_LIMITS.platform, "source"),
      package: pickText(job, ["package"], FIELD_LIMITS.service, "job.package"),
      tv_count: tvCount,
      tv_brand: pickText(job, ["tv_brand", "tvBrand"], FIELD_LIMITS.name, "job.tv_brand"),
      addons,
      photos_attached_count: Array.isArray(job.photos_attached)
        ? Math.min(job.photos_attached.length, MAX_FILES)
        : 0,
      quote_contact_consent: body.consent === "yes" || body.consent === true ? 1 : 0,
      marketing_consent: body.marketing_consent === true ? 1 : 0,
    }),
    marketingConsent: body.marketing_consent === true ? 1 : 0,
  };
}

function canonicalFromSync(record) {
  if (!isRecord(record)) throw new InputError("Each lead must be an object");

  const receivedAt = normalizeReceivedAt(record.received_at, false);
  const source = normalizeSource(
    pickText(record, ["source"], FIELD_LIMITS.source, "source") || "google_apps_script",
    "google_apps_script",
  );
  const pageUrl = pickText(record, ["page_url"], FIELD_LIMITS.pageUrl, "page_url");
  const campaign = pickText(record, ["campaign"], FIELD_LIMITS.campaign, "campaign");

  return {
    id: crypto.randomUUID(),
    source,
    externalId: normalizeExternalId(pickText(record, ["external_id"], FIELD_LIMITS.externalId, "external_id")),
    receivedAt,
    receivedDay: melbourneDay(receivedAt),
    fullName: pickText(record, ["full_name", "name", "fullname"], FIELD_LIMITS.name, "full_name"),
    email: normalizeEmail(pickText(record, ["email"], FIELD_LIMITS.email, "email")),
    phone: pickText(record, ["phone", "mobile"], FIELD_LIMITS.phone, "phone"),
    postcode: pickText(record, ["postcode"], FIELD_LIMITS.postcode, "postcode"),
    platform: pickText(record, ["platform"], FIELD_LIMITS.platform, "platform") || "google-apps-script",
    tvSize: pickText(record, ["tv_size", "tvsize"], FIELD_LIMITS.tvSize, "tv_size"),
    suburb: pickText(record, ["suburb"], FIELD_LIMITS.suburb, "suburb"),
    service: pickText(record, ["service"], FIELD_LIMITS.service, "service"),
    wallType: pickText(record, ["wall_type", "wall"], FIELD_LIMITS.wallType, "wall_type"),
    preferredDate: pickText(record, ["preferred_date"], FIELD_LIMITS.preferredDate, "preferred_date"),
    message: pickText(record, ["message", "notes"], FIELD_LIMITS.message, "message"),
    pageUrl,
    campaign,
    trackingJson: serialiseTracking(record, pageUrl),
    detailsJson: serialiseDetails({ intake: "apps-script-sync" }),
    marketingConsent: 0,
  };
}

function requireOperationsDb(env) {
  if (!env.OPERATIONS_DB) {
    throw new ServiceError("Lead storage is not configured");
  }
  return env.OPERATIONS_DB;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function contactIdentityKey(lead) {
  if (lead.email) {
    return "sha256:" + await sha256Hex("email\u0000" + lead.email.toLowerCase());
  }

  const normalizedPhone = normalizePhoneForIdentity(lead.phone);
  if (normalizedPhone) {
    return "sha256:" + await sha256Hex("phone\u0000" + normalizedPhone);
  }

  return "sha256:" + await sha256Hex("lead\u0000" + lead.source + "\u0000" + lead.externalId);
}

async function buildLeadWriteStatements(db, lead, event, options = {}) {
  const identityKey = await contactIdentityKey(lead);
  const contactId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const updatedAt = event.occurredAt;

  const contactConflictSql = "ON CONFLICT(identity_key) DO UPDATE SET " +
      "full_name = CASE WHEN excluded.full_name <> '' THEN excluded.full_name ELSE contacts.full_name END, " +
      "email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE contacts.email END, " +
      "phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE contacts.phone END, " +
      "postcode = CASE WHEN excluded.postcode <> '' THEN excluded.postcode ELSE contacts.postcode END, " +
      "suburb = CASE WHEN excluded.suburb <> '' THEN excluded.suburb ELSE contacts.suburb END, " +
      "updated_at = excluded.updated_at";

  const contactBindings = [
    contactId,
    identityKey,
    lead.fullName,
    lead.email,
    lead.phone,
    lead.postcode,
    lead.suburb,
    updatedAt,
    updatedAt,
  ];
  const contactStatement = options.insertOnly
    ? db.prepare(
      "INSERT INTO contacts (" +
        "id, identity_key, full_name, email, phone, postcode, suburb, created_at, updated_at" +
      ") SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? " +
      "WHERE NOT EXISTS (SELECT 1 FROM leads WHERE source = ? AND external_id = ?) " +
      contactConflictSql,
    ).bind(...contactBindings, lead.source, lead.externalId)
    : db.prepare(
      "INSERT INTO contacts (" +
        "id, identity_key, full_name, email, phone, postcode, suburb, created_at, updated_at" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      contactConflictSql,
    ).bind(...contactBindings);

  const conflictSql = options.insertOnly
    ? "ON CONFLICT(source, external_id) DO NOTHING"
    : "ON CONFLICT(source, external_id) DO UPDATE SET " +
      "contact_id = excluded.contact_id, " +
      "received_at = excluded.received_at, " +
      "received_day = excluded.received_day, " +
      "full_name = CASE WHEN excluded.full_name <> '' THEN excluded.full_name ELSE leads.full_name END, " +
      "email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE leads.email END, " +
      "phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE leads.phone END, " +
      "postcode = CASE WHEN excluded.postcode <> '' THEN excluded.postcode ELSE leads.postcode END, " +
      "platform = CASE WHEN excluded.platform <> '' THEN excluded.platform ELSE leads.platform END, " +
      "tv_size = CASE WHEN excluded.tv_size <> '' THEN excluded.tv_size ELSE leads.tv_size END, " +
      "suburb = CASE WHEN excluded.suburb <> '' THEN excluded.suburb ELSE leads.suburb END, " +
      "service = CASE WHEN excluded.service <> '' THEN excluded.service ELSE leads.service END, " +
      "wall_type = CASE WHEN excluded.wall_type <> '' THEN excluded.wall_type ELSE leads.wall_type END, " +
      "preferred_date = CASE WHEN excluded.preferred_date <> '' THEN excluded.preferred_date ELSE leads.preferred_date END, " +
      "message = CASE WHEN excluded.message <> '' THEN excluded.message ELSE leads.message END, " +
      "page_url = CASE WHEN excluded.page_url <> '' THEN excluded.page_url ELSE leads.page_url END, " +
      "campaign = CASE WHEN excluded.campaign <> '' THEN excluded.campaign ELSE leads.campaign END, " +
      "tracking_json = excluded.tracking_json, " +
      "details_json = excluded.details_json, " +
      "marketing_consent = CASE WHEN excluded.marketing_consent = 1 THEN 1 ELSE leads.marketing_consent END, " +
      "updated_at = excluded.updated_at";

  const leadStatement = db.prepare(
    "INSERT INTO leads (" +
      "id, contact_id, source, external_id, received_at, received_day, " +
      "full_name, email, phone, postcode, platform, tv_size, suburb, service, wall_type, " +
      "preferred_date, message, page_url, campaign, tracking_json, details_json, marketing_consent, " +
      "created_at, updated_at" +
    ") VALUES (?, (SELECT id FROM contacts WHERE identity_key = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    conflictSql,
  ).bind(
    lead.id,
    identityKey,
    lead.source,
    lead.externalId,
    lead.receivedAt,
    lead.receivedDay,
    lead.fullName,
    lead.email,
    lead.phone,
    lead.postcode,
    lead.platform,
    lead.tvSize,
    lead.suburb,
    lead.service,
    lead.wallType,
    lead.preferredDate,
    lead.message,
    lead.pageUrl,
    lead.campaign,
    lead.trackingJson,
    lead.detailsJson,
    lead.marketingConsent,
    updatedAt,
    updatedAt,
  );

  const eventStatement = options.insertOnly
    ? db.prepare(
      "INSERT INTO intake_events (" +
        "id, lead_id, event_type, channel, request_id, occurred_at, details_json" +
      ") SELECT ?, id, ?, ?, ?, ?, ? FROM leads " +
      "WHERE source = ? AND external_id = ? AND id = ?",
    ).bind(
      eventId,
      event.type,
      event.channel,
      event.requestId || "",
      event.occurredAt,
      event.detailsJson,
      lead.source,
      lead.externalId,
      lead.id,
    )
    : db.prepare(
      "INSERT INTO intake_events (" +
        "id, lead_id, event_type, channel, request_id, occurred_at, details_json" +
      ") VALUES (?, (SELECT id FROM leads WHERE source = ? AND external_id = ?), ?, ?, ?, ?, ?)",
    ).bind(
      eventId,
      lead.source,
      lead.externalId,
      event.type,
      event.channel,
      event.requestId || "",
      event.occurredAt,
      event.detailsJson,
    );

  const statements = [contactStatement, leadStatement, eventStatement];
  if (options.queueWebsiteSheet) {
    statements.push(
      db.prepare(
        "INSERT INTO lead_deliveries (" +
          "id, lead_id, destination, status, attempts, next_attempt_at, last_attempt_at, " +
          "delivered_at, last_error, created_at, updated_at" +
        ") SELECT ?, id, ?, 'pending', 0, ?, '', '', '', ?, ? FROM leads " +
        "WHERE source = ? AND external_id = ? AND id = ? " +
        "ON CONFLICT(lead_id, destination) DO NOTHING",
      ).bind(
        crypto.randomUUID(),
        WEBSITE_SHEET_DESTINATION,
        updatedAt,
        updatedAt,
        updatedAt,
        lead.source,
        lead.externalId,
        lead.id,
      ),
    );
  }

  return statements;
}

async function persistCanonicalLeads(env, leads, event, options = {}) {
  const db = requireOperationsDb(env);
  const statements = (
    await Promise.all(leads.map((lead) => buildLeadWriteStatements(db, lead, event, options)))
  ).flat();

  const results = await db.batch(statements);
  if (results.length !== statements.length || results.some((result) => !result.success)) {
    throw new ServiceError("Lead storage failed");
  }
}

export async function persistCanonicalLead(env, lead, event, options = {}) {
  await persistCanonicalLeads(env, [lead], event, options);
  const db = requireOperationsDb(env);
  const storedId = await db
    .prepare("SELECT id FROM leads WHERE source = ? AND external_id = ?")
    .bind(lead.source, lead.externalId)
    .first("id");
  return storedId || lead.id;
}

export async function withoutCanonicalMetaCopies(db, leads) {
  const candidateIds = Array.from(new Set(
    leads
      .filter((lead) => lead?.source === "google_lead_sheet" && lead.externalId)
      .map((lead) => lead.externalId),
  ));
  if (!candidateIds.length) return { leads, skipped: 0 };

  const placeholders = candidateIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT external_id FROM leads WHERE source = 'meta_lead_ads' AND external_id IN (${placeholders})`,
  ).bind(...candidateIds).all();
  const canonicalIds = new Set((result.results || []).map((row) => String(row.external_id || "")));
  if (!canonicalIds.size) return { leads, skipped: 0 };

  const filtered = leads.filter((lead) => !(
    lead?.source === "google_lead_sheet" && canonicalIds.has(lead.externalId)
  ));
  return { leads: filtered, skipped: leads.length - filtered.length };
}

async function existingWebsiteLeadId(env, externalId) {
  const db = requireOperationsDb(env);
  return db.prepare("SELECT id FROM leads WHERE source = 'website' AND external_id = ?")
    .bind(externalId)
    .first("id");
}

async function storedUploadCount(env, leadId) {
  const row = await requireOperationsDb(env)
    .prepare("SELECT COUNT(*) AS count FROM lead_uploads WHERE lead_id = ?")
    .bind(leadId)
    .first();
  const count = Number(row?.count);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

async function websiteSubmissionHash(lead, files = []) {
  const payload = {
    source: lead.source,
    externalId: lead.externalId,
    fullName: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    postcode: lead.postcode,
    platform: lead.platform,
    tvSize: lead.tvSize,
    suburb: lead.suburb,
    service: lead.service,
    wallType: lead.wallType,
    preferredDate: lead.preferredDate,
    message: lead.message,
    pageUrl: lead.pageUrl,
    campaign: lead.campaign,
    trackingJson: lead.trackingJson,
    detailsJson: lead.detailsJson,
    marketingConsent: lead.marketingConsent,
    uploads: files.map((file) => ({
      name: boundedText(file.name, FIELD_LIMITS.fileName, "file name"),
      type: boundedText(file.type, FIELD_LIMITS.contentType, "file content type"),
      size: Number(file.size) || 0,
    })),
  };
  return "sha256:" + await sha256Hex(JSON.stringify(payload));
}

async function assertWebsiteReplay(env, leadId, requestHash) {
  const row = await requireOperationsDb(env).prepare(
    "SELECT details_json FROM intake_events " +
    "WHERE lead_id = ? AND event_type = 'lead_received' ORDER BY occurred_at ASC LIMIT 1",
  ).bind(leadId).first();
  const details = parsedObject(row?.details_json);
  if (details.request_hash !== requestHash) {
    throw new ConflictError("Submission ID was reused with different lead details");
  }
}

function parsedObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function websiteSheetPlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  if (platform === "facebook") return "fb";
  if (platform === "instagram") return "ig";
  return platform.slice(0, FIELD_LIMITS.platform);
}

function websiteSheetTvSize(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (["under_40\"", "40\"–55\"", "56\"–75\"", "over_75\""].includes(text)) return text;

  const lower = text.toLowerCase();
  const size = Number((text.match(/\d{2,3}/) || [])[0]);
  if (!Number.isFinite(size)) return "";
  if (lower.includes("over") || lower.includes("+") || size > 75) return "over_75\"";
  if (size < 40) return "under_40\"";
  if (size <= 55) return "40\"–55\"";
  return "56\"–75\"";
}

function websiteSheetMountingIntent(lead, details) {
  const evidence = [
    lead?.tv_size,
    lead?.service,
    details?.package,
    details?.form_source === "quote-page" ? "tv mounting" : "",
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /\btv\b|mount/.test(evidence) || Boolean(String(lead?.tv_size || "").trim()) ? "yes" : "";
}

function websiteSheetConfig(env) {
  const secret = typeof env.GOOGLE_APPS_SCRIPT_SECRET === "string"
    ? env.GOOGLE_APPS_SCRIPT_SECRET.trim()
    : "";
  const rawUrl = typeof env.GOOGLE_APPS_SCRIPT_URL === "string"
    ? env.GOOGLE_APPS_SCRIPT_URL.trim()
    : "";
  if (secret.length < 32 || !rawUrl) throw new Error("not_configured");

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("not_configured");
  }
  const validPath = /^\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !validPath
      || url.username || url.password || url.search || url.hash) {
    throw new Error("not_configured");
  }
  return { url: url.toString(), secret };
}

export function websiteSheetRow(lead) {
  const tracking = parsedObject(lead.tracking_json);
  const details = parsedObject(lead.details_json);
  const value = (entry, maximum = 10_000) => String(entry == null ? "" : entry).slice(0, maximum);
  return [
    "website:" + value(lead.external_id, FIELD_LIMITS.externalId),
    value(lead.received_at, 64),
    "",
    "",
    "",
    "",
    "",
    value(lead.campaign || tracking.utm_campaign, FIELD_LIMITS.campaign),
    "",
    value(details.form_source || details.intake, FIELD_LIMITS.platform),
    "",
    websiteSheetPlatform(lead.platform),
    websiteSheetMountingIntent(lead, details),
    websiteSheetTvSize(lead.tv_size),
    value(lead.email, FIELD_LIMITS.email),
    value(lead.full_name, FIELD_LIMITS.name),
    value(lead.phone, FIELD_LIMITS.phone),
    value(lead.postcode, FIELD_LIMITS.postcode),
  ];
}

export function metaSheetRow(lead) {
  const details = parsedObject(lead.details_json);
  const value = (entry, maximum = 10_000) => String(entry == null ? "" : entry).slice(0, maximum);
  const mountingIntent = value(details.mounting_intent, FIELD_LIMITS.service)
    || websiteSheetMountingIntent(lead, details);
  return [
    value(lead.external_id, FIELD_LIMITS.externalId),
    value(lead.received_at, 64),
    value(details.ad_id, FIELD_LIMITS.externalId),
    value(details.ad_name, FIELD_LIMITS.campaign),
    value(details.adset_id, FIELD_LIMITS.externalId),
    value(details.adset_name, FIELD_LIMITS.campaign),
    value(details.campaign_id, FIELD_LIMITS.externalId),
    value(details.campaign_name || lead.campaign, FIELD_LIMITS.campaign),
    value(details.form_id, FIELD_LIMITS.externalId),
    value(details.form_name, FIELD_LIMITS.campaign),
    details.is_organic === true ? "true" : details.is_organic === false ? "false" : "",
    websiteSheetPlatform(lead.platform),
    mountingIntent,
    value(lead.tv_size, FIELD_LIMITS.tvSize),
    value(lead.email, FIELD_LIMITS.email),
    value(lead.full_name, FIELD_LIMITS.name),
    value(lead.phone, FIELD_LIMITS.phone),
    value(lead.postcode, FIELD_LIMITS.postcode),
  ];
}

export function leadSheetRow(lead) {
  return lead?.source === "meta_lead_ads" ? metaSheetRow(lead) : websiteSheetRow(lead);
}

async function parseWebsiteSheetResponse(response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > WEBSITE_SHEET_MAX_RESPONSE_BYTES) {
    throw new Error("response_too_large");
  }
  if (!response.body) throw new Error("invalid_response");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > WEBSITE_SHEET_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(payload)) throw new Error("invalid_response");
    return payload;
  } catch {
    throw new Error("invalid_response");
  }
}

export async function enqueueWebsiteSheetDelivery(env, leadId) {
  const db = requireOperationsDb(env);
  const timestamp = nowIso();
  await db.prepare(
    "INSERT INTO lead_deliveries (" +
      "id, lead_id, destination, status, attempts, next_attempt_at, last_attempt_at, " +
      "delivered_at, last_error, created_at, updated_at" +
    ") VALUES (?, ?, ?, 'pending', 0, ?, '', '', '', ?, ?) " +
    "ON CONFLICT(lead_id, destination) DO UPDATE SET " +
      "status = CASE " +
        "WHEN lead_deliveries.status IN ('delivered', 'processing') THEN lead_deliveries.status " +
        "ELSE 'pending' END, " +
      "next_attempt_at = CASE " +
        "WHEN lead_deliveries.status IN ('delivered', 'processing') THEN lead_deliveries.next_attempt_at " +
        "ELSE excluded.next_attempt_at END, " +
      "attempts = CASE WHEN lead_deliveries.status = 'failed' THEN 0 ELSE lead_deliveries.attempts END, " +
      "last_error = CASE WHEN lead_deliveries.status = 'failed' THEN '' ELSE lead_deliveries.last_error END, " +
      "updated_at = excluded.updated_at",
  ).bind(
    crypto.randomUUID(),
    leadId,
    WEBSITE_SHEET_DESTINATION,
    timestamp,
    timestamp,
    timestamp,
  ).run();
}

function sheetRetryAt(attempts) {
  const seconds = Math.min(60 * 60, 60 * (2 ** Math.max(0, attempts - 1)));
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function slowSheetRetryAt() {
  return new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString();
}

function safeDeliveryError(error) {
  const message = error instanceof Error ? error.message : "request_failed";
  return [
    "not_configured",
    "request_failed",
    "response_too_large",
    "invalid_response",
    "receiver_rejected",
    "lead_not_found",
  ].includes(message) ? message : "request_failed";
}

async function recordSheetDeliveryEvent(db, delivery, leadId, payload) {
  try {
    await db.prepare(
      "INSERT INTO intake_events (id, lead_id, event_type, channel, request_id, occurred_at, details_json) " +
      "SELECT ?, ?, 'sheet_delivery_succeeded', 'google-sheet', ?, ?, ? " +
      "WHERE NOT EXISTS (" +
        "SELECT 1 FROM intake_events WHERE event_type = 'sheet_delivery_succeeded' AND request_id = ?" +
      ")",
    ).bind(
      crypto.randomUUID(),
      leadId,
      delivery.id,
      nowIso(),
      JSON.stringify({
        inserted: Number(payload.inserted ?? payload.insertedCount) || 0,
        duplicate: Number(payload.duplicates ?? payload.duplicateCount) || 0,
      }),
      delivery.id,
    ).run();
  } catch {
    console.error(JSON.stringify({ event: "sheet_delivery_event_not_recorded" }));
  }
}

export async function deliverWebsiteLeadToSheet(env, leadId, force = false) {
  const db = requireOperationsDb(env);
  const delivery = await db.prepare(
    "SELECT id, status, attempts, next_attempt_at, updated_at FROM lead_deliveries " +
    "WHERE lead_id = ? AND destination = ?",
  ).bind(leadId, WEBSITE_SHEET_DESTINATION).first();
  if (!delivery || delivery.status === "delivered") return;

  const now = new Date();
  if (!force && delivery.next_attempt_at && new Date(delivery.next_attempt_at) > now) return;
  if (delivery.status === "processing") {
    const updated = new Date(delivery.updated_at);
    if (!Number.isNaN(updated.getTime()) && now.getTime() - updated.getTime() < 10 * 60 * 1_000) return;
  }

  const attempts = Math.max(0, Number(delivery.attempts) || 0) + 1;
  const attemptedAt = nowIso();
  await db.prepare(
    "UPDATE lead_deliveries SET status = 'processing', attempts = ?, last_attempt_at = ?, " +
    "updated_at = ? WHERE id = ? AND status <> 'delivered'",
  ).bind(attempts, attemptedAt, attemptedAt, delivery.id).run();

  try {
    const config = websiteSheetConfig(env);
    const lead = await db.prepare(
      "SELECT source, external_id, received_at, platform, campaign, tracking_json, details_json, " +
      "page_url, service, tv_size, full_name, email, phone, suburb, postcode, wall_type, " +
      "preferred_date, message FROM leads WHERE id = ? AND source IN ('website', 'meta_lead_ads')",
    ).bind(leadId).first();
    if (!lead) throw new Error("lead_not_found");

    let response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          secret: config.secret,
          sheetName: WEBSITE_SHEET_NAME,
          headers: WEBSITE_SHEET_HEADERS,
          rows: [leadSheetRow(lead)],
        }),
        signal: AbortSignal.timeout(WEBSITE_SHEET_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("request_failed");
    }

    const payload = await parseWebsiteSheetResponse(response);
    if (!response.ok || payload.ok !== true) throw new Error("receiver_rejected");

    const completedAt = nowIso();
    await db.prepare(
      "UPDATE lead_deliveries SET status = 'delivered', delivered_at = ?, next_attempt_at = ?, " +
      "last_error = '', updated_at = ? WHERE id = ?",
    ).bind(completedAt, completedAt, completedAt, delivery.id).run();
    await recordSheetDeliveryEvent(db, delivery, leadId, payload);
  } catch (error) {
    const code = safeDeliveryError(error);
    const status = attempts >= WEBSITE_SHEET_MAX_ATTEMPTS ? "failed" : "pending";
    const nextAttemptAt = status === "failed" ? slowSheetRetryAt() : sheetRetryAt(attempts);
    await db.prepare(
      "UPDATE lead_deliveries SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ? " +
      "WHERE id = ? AND status <> 'delivered'",
    ).bind(status, nextAttemptAt, code, nowIso(), delivery.id).run();
    console.error(JSON.stringify({
      event: "website_sheet_delivery_failed",
      status,
      attempts,
      error: code,
    }));
  }
}

export async function processPendingWebsiteSheetDeliveries(env) {
  const db = requireOperationsDb(env);
  const timestamp = nowIso();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
  await db.prepare(
    "UPDATE lead_deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ? " +
    "WHERE destination = ? AND status = 'processing' AND updated_at < ?",
  ).bind(timestamp, timestamp, WEBSITE_SHEET_DESTINATION, staleBefore).run();

  await db.prepare(
    "INSERT INTO lead_deliveries (" +
      "id, lead_id, destination, status, attempts, next_attempt_at, last_attempt_at, " +
      "delivered_at, last_error, created_at, updated_at" +
    ") SELECT lower(hex(randomblob(16))), leads.id, ?, 'pending', 0, ?, '', '', '', ?, ? " +
    "FROM leads LEFT JOIN lead_deliveries ON lead_deliveries.lead_id = leads.id " +
      "AND lead_deliveries.destination = ? " +
    "WHERE leads.source IN ('website', 'meta_lead_ads') AND lead_deliveries.id IS NULL " +
    "ORDER BY leads.created_at ASC LIMIT 20 " +
    "ON CONFLICT(lead_id, destination) DO NOTHING",
  ).bind(
    WEBSITE_SHEET_DESTINATION,
    timestamp,
    timestamp,
    timestamp,
    WEBSITE_SHEET_DESTINATION,
  ).run();

  const pending = await db.prepare(
    "SELECT lead_id FROM lead_deliveries WHERE destination = ? AND status IN ('pending', 'failed') " +
    "AND next_attempt_at <= ? ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?",
  ).bind(WEBSITE_SHEET_DESTINATION, timestamp, WEBSITE_SHEET_BATCH_LIMIT).all();

  for (const row of pending.results || []) {
    await deliverWebsiteLeadToSheet(env, row.lead_id, false);
  }
}

export async function sendRunLogToSheet(env, run) {
  const config = websiteSheetConfig(env);
  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        secret: config.secret,
        type: "run",
        runsSheetName: "Runs",
        run,
      }),
      signal: AbortSignal.timeout(WEBSITE_SHEET_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("request_failed");
  }

  const payload = await parseWebsiteSheetResponse(response);
  if (!response.ok || payload.ok !== true) throw new Error("receiver_rejected");
  return payload;
}

function fileExt(file) {
  const byType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  if (byType[file.type]) return byType[file.type];

  const name = typeof file.name === "string" ? file.name : "";
  const extension = name.split(".").pop();
  if (extension && extension !== name) {
    const safe = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (safe) return safe.slice(0, 12);
  }
  return "bin";
}

async function persistUploads(env, leadId, files) {
  if (!files.length) return 0;
  if (!env.LEAD_UPLOADS) throw new ServiceError("Lead uploads are not configured");

  const db = requireOperationsDb(env);
  const records = [];

  try {
    for (const file of files) {
      const uploadId = crypto.randomUUID();
      const objectKey = "website-leads/" + leadId + "/" + uploadId + "." + fileExt(file);
      const contentType = boundedText(file.type || "application/octet-stream", FIELD_LIMITS.contentType, "file content type")
        || "application/octet-stream";

      await env.LEAD_UPLOADS.put(objectKey, file.stream(), {
        httpMetadata: { contentType },
      });

      records.push({
        id: uploadId,
        objectKey,
        originalName: boundedText(file.name, FIELD_LIMITS.fileName, "file name") || "upload",
        contentType,
        sizeBytes: file.size,
      });
    }

    const storedAt = nowIso();
    const statements = records.map((record) =>
      db.prepare(
        "INSERT INTO lead_uploads (id, lead_id, object_key, original_name, content_type, size_bytes, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        record.id,
        leadId,
        record.objectKey,
        record.originalName,
        record.contentType,
        record.sizeBytes,
        storedAt,
      ),
    );

    statements.push(
      db.prepare(
        "INSERT INTO intake_events (id, lead_id, event_type, channel, request_id, occurred_at, details_json) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        leadId,
        "uploads_stored",
        "website",
        "",
        storedAt,
        JSON.stringify({ count: records.length }),
      ),
    );

    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some((result) => !result.success)) {
      throw new ServiceError("Lead upload storage failed");
    }

    return records.length;
  } catch (error) {
    if (records.length) {
      try {
        await env.LEAD_UPLOADS.delete(records.map((record) => record.objectKey));
      } catch {
        console.error(JSON.stringify({
          event: "lead_upload_cleanup_failed",
          lead_id: leadId,
          upload_count: records.length,
        }));
      }
    }
    throw error;
  }
}

function honeypotField(body) {
  for (const field of ["_bts_check", "company_website", "honeypot", "hp"]) {
    const value = body[field];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return field;
    }
  }
  return null;
}

function bytesFromHex(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
}

async function authenticateSyncRequest(request, env) {
  const secret = env.LEAD_SYNC_SECRET;
  if (!secret) throw new ServiceError("Lead sync is not configured");
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    throw new InputError("Lead sync requires JSON");
  }

  const timestamp = boundedText(
    request.headers.get("x-lead-sync-timestamp"),
    16,
    "x-lead-sync-timestamp",
  );
  const idempotencyKey = boundedText(
    request.headers.get("x-lead-sync-id"),
    128,
    "x-lead-sync-id",
  );
  const signature = boundedText(
    request.headers.get("x-lead-sync-signature"),
    128,
    "x-lead-sync-signature",
  ).toLowerCase();

  if (!/^\d{10}$/.test(timestamp)) throw new AuthError("Invalid sync timestamp");
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(idempotencyKey)) {
    throw new AuthError("Invalid sync id");
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SYNC_TIMESTAMP_TOLERANCE_SECONDS) {
    throw new AuthError("Expired sync timestamp");
  }

  const suppliedSignature = bytesFromHex(signature);
  if (!suppliedSignature) throw new AuthError("Invalid sync signature");

  const raw = await readTextBounded(request, MAX_SYNC_REQUEST_BYTES);
  const expectedSignature = await hmacSha256(secret, timestamp + "." + idempotencyKey + "." + raw);
  if (!crypto.subtle.timingSafeEqual(new Uint8Array(expectedSignature), suppliedSignature)) {
    throw new AuthError("Invalid sync signature");
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InputError("Invalid lead sync body");
  }
  if (!isRecord(body) || !Array.isArray(body.leads)) {
    throw new InputError("Lead sync body must include a leads array");
  }
  if (!body.leads.length || body.leads.length > MAX_SYNC_BATCH) {
    throw new InputError("Lead sync must include between 1 and " + MAX_SYNC_BATCH + " leads");
  }

  return {
    body,
    idempotencyKey,
    requestHash: await sha256Hex(raw),
  };
}

async function claimSyncRequest(env, idempotencyKey, requestHash, receivedAt) {
  const db = requireOperationsDb(env);
  await db
    .prepare(
      "DELETE FROM sync_requests WHERE id IN (" +
        "SELECT id FROM sync_requests WHERE expires_at < ? ORDER BY expires_at LIMIT 100" +
      ")",
    )
    .bind(receivedAt)
    .run();

  const existing = await db
    .prepare(
      "SELECT id, request_hash, status, accepted_count, completed_count, failed_count " +
      "FROM sync_requests WHERE idempotency_key = ?",
    )
    .bind(idempotencyKey)
    .first();

  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ConflictError("Idempotency key was already used for a different payload");
    }
    if (existing.status === "completed") {
      return {
        id: existing.id,
        replayed: true,
        acceptedCount: existing.accepted_count,
        completedCount: existing.completed_count,
      };
    }
    if (existing.status === "processing") {
      throw new ConflictError("Lead sync is already being processed");
    }

    const retry = await db
      .prepare(
        "UPDATE sync_requests SET status = 'processing', failed_count = 0, " +
        "received_at = ?, completed_at = NULL, expires_at = ? " +
        "WHERE id = ? AND status = 'failed'",
      )
      .bind(
        receivedAt,
        new Date(new Date(receivedAt).getTime() + SYNC_REPLAY_RETENTION_MS).toISOString(),
        existing.id,
      )
      .run();
    if (retry.meta.changes !== 1) {
      throw new ConflictError("Lead sync is already being processed");
    }
    return { id: existing.id, replayed: false };
  }

  const requestId = crypto.randomUUID();
  const insert = await db
    .prepare(
      "INSERT INTO sync_requests (" +
        "id, idempotency_key, request_hash, status, received_at, expires_at" +
      ") VALUES (?, ?, ?, 'processing', ?, ?) " +
      "ON CONFLICT(idempotency_key) DO NOTHING",
    )
    .bind(
      requestId,
      idempotencyKey,
      requestHash,
      receivedAt,
      new Date(new Date(receivedAt).getTime() + SYNC_REPLAY_RETENTION_MS).toISOString(),
    )
    .run();

  if (insert.meta.changes === 1) return { id: requestId, replayed: false };
  return claimSyncRequest(env, idempotencyKey, requestHash, receivedAt);
}

async function markSyncRequest(env, requestId, status, acceptedCount, completedCount, failedCount) {
  const db = requireOperationsDb(env);
  await db
    .prepare(
      "UPDATE sync_requests SET status = ?, accepted_count = ?, completed_count = ?, " +
      "failed_count = ?, completed_at = ? WHERE id = ?",
    )
    .bind(status, acceptedCount, completedCount, failedCount, nowIso(), requestId)
    .run();
}

function publicErrorResponse(error, headers, stage) {
  if (error instanceof InputError) {
    return jsonResponse({ error: error.message }, 400, headers);
  }
  if (error instanceof ConflictError) {
    return jsonResponse({
      error: "This request changed after it was sent. Please reload the form and submit it again.",
    }, 409, headers);
  }
  if (error instanceof ServiceError) {
    console.error(JSON.stringify({ event: "lead_intake_unavailable" }));
    return jsonResponse({ error: "Lead intake is temporarily unavailable" }, 503, headers);
  }

  console.error(JSON.stringify({
    event: "lead_intake_failed",
    stage: stage || "unknown",
    error_type: error instanceof Error ? error.name : "unknown",
  }));
  return jsonResponse({ error: "Could not save your request. Please try again." }, 502, headers);
}

function syncErrorResponse(error) {
  if (error instanceof InputError) {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
  if (error instanceof AuthError) {
    return jsonResponse({ ok: false, error: "authentication_failed" }, 401);
  }
  if (error instanceof ConflictError) {
    return jsonResponse({ ok: false, error: "idempotency_conflict" }, 409);
  }
  if (error instanceof ServiceError) {
    console.error(JSON.stringify({ event: "lead_sync_unavailable" }));
    return jsonResponse({ ok: false, error: "sync_unavailable" }, 503);
  }

  console.error(JSON.stringify({ event: "lead_sync_failed" }));
  return jsonResponse({ ok: false, error: "sync_failed" }, 502);
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function onRequestPost({ request, env, ctx }) {
  const headers = corsHeaders(request);
  let stage = "parse";

  try {
    const submission = await parseWebsiteSubmission(request);
    const tripped = honeypotField(submission.fields);
    if (tripped) {
      return jsonResponse({ ok: true, filtered: "honeypot", tripped }, 200, headers);
    }
    stage = "validate";
    validateWebsiteSubmission(submission.fields, submission.files);
    stage = "canonicalize";
    const lead = canonicalFromWebsite(submission.fields, submission.files.length);
    const requestHash = await websiteSubmissionHash(lead, submission.files);
    let leadId = await existingWebsiteLeadId(env, lead.externalId);
    let replayed = Boolean(leadId);
    let uploadCount = leadId ? await storedUploadCount(env, leadId) : 0;

    if (leadId) await assertWebsiteReplay(env, leadId, requestHash);
    if (leadId && submission.files.length > 0) {
      if (uploadCount === 0) {
        stage = "recover_uploads";
        uploadCount = await persistUploads(env, leadId, submission.files);
      } else if (uploadCount !== submission.files.length) {
        throw new ConflictError("Upload count does not match the stored request");
      }
    }

    if (!leadId) {
      stage = "persist_lead";
      leadId = await persistCanonicalLead(env, lead, {
        type: "lead_received",
        channel: "website",
        occurredAt: nowIso(),
        requestId: "",
        detailsJson: JSON.stringify({ uploads: submission.files.length, request_hash: requestHash }),
      }, { insertOnly: true, queueWebsiteSheet: true });
      replayed = leadId !== lead.id;
      if (replayed) await assertWebsiteReplay(env, leadId, requestHash);
      if (!replayed) {
        stage = "persist_uploads";
        uploadCount = await persistUploads(env, leadId, submission.files);
      } else {
        uploadCount = await storedUploadCount(env, leadId);
      }
    }

    stage = "queue_sheet_delivery";
    await enqueueWebsiteSheetDelivery(env, leadId);
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(deliverWebsiteLeadToSheet(env, leadId, true));
    }

    return jsonResponse({
      ok: true,
      lead_id: leadId,
      uploaded_images: uploadCount,
      sheet_delivery: "queued",
      replayed,
    }, replayed ? 200 : 201, headers);
  } catch (error) {
    return publicErrorResponse(error, headers, stage);
  }
}

export async function onN8nLeadPost({ request, env, ctx }) {
  const headers = corsHeaders(request);
  let stage = "parse";

  try {
    const body = (await parseJsonObject(request, MAX_SYNC_REQUEST_BYTES)).value;
    const tripped = honeypotField(body);
    if (tripped) {
      return jsonResponse({ ok: true, filtered: "honeypot", tripped }, 200, headers);
    }

    stage = "canonicalize";
    const lead = canonicalFromN8n(body);
    const requestHash = await websiteSubmissionHash(lead);
    let leadId = await existingWebsiteLeadId(env, lead.externalId);
    let replayed = Boolean(leadId);
    if (leadId) await assertWebsiteReplay(env, leadId, requestHash);
    if (!leadId) {
      stage = "persist_lead";
      leadId = await persistCanonicalLead(env, lead, {
        type: "lead_received",
        channel: "website-json",
        occurredAt: nowIso(),
        requestId: "",
        detailsJson: JSON.stringify({ endpoint: "api/n8n/lead", request_hash: requestHash }),
      }, { insertOnly: true, queueWebsiteSheet: true });
      replayed = leadId !== lead.id;
      if (replayed) await assertWebsiteReplay(env, leadId, requestHash);
    }

    stage = "queue_sheet_delivery";
    await enqueueWebsiteSheetDelivery(env, leadId);
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(deliverWebsiteLeadToSheet(env, leadId, true));
    }

    return jsonResponse({ ok: true, lead_id: leadId, sheet_delivery: "queued", replayed }, 200, headers);
  } catch (error) {
    return publicErrorResponse(error, headers, stage);
  }
}

export async function onLeadSyncPost({ request, env }) {
  try {
    const authenticated = await authenticateSyncRequest(request, env);
    const leads = authenticated.body.leads.map(canonicalFromSync);
    const receivedAt = nowIso();
    const claimed = await claimSyncRequest(
      env,
      authenticated.idempotencyKey,
      authenticated.requestHash,
      receivedAt,
    );

    if (claimed.replayed) {
      return jsonResponse({
        ok: true,
        replayed: true,
        accepted: claimed.acceptedCount,
        completed: claimed.completedCount,
      });
    }

    let canonical = { leads, skipped: 0 };
    try {
      canonical = await withoutCanonicalMetaCopies(requireOperationsDb(env), leads);
      if (canonical.leads.length) {
        await persistCanonicalLeads(env, canonical.leads, {
          type: "lead_synced",
          channel: "apps-script",
          occurredAt: nowIso(),
          requestId: claimed.id,
          detailsJson: JSON.stringify({
            batch_size: leads.length,
            canonical_meta_copies_skipped: canonical.skipped,
          }),
        });
      }
      await markSyncRequest(env, claimed.id, "completed", leads.length, leads.length, 0);
    } catch (error) {
      try {
        await markSyncRequest(env, claimed.id, "failed", leads.length, 0, leads.length);
      } catch {
        console.error(JSON.stringify({ event: "lead_sync_failure_not_recorded" }));
      }
      throw error;
    }

    return jsonResponse({
      ok: true,
      replayed: false,
      accepted: leads.length,
      completed: leads.length,
      canonical_meta_copies_skipped: canonical.skipped,
    });
  } catch (error) {
    return syncErrorResponse(error);
  }
}
