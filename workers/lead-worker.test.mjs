import assert from "node:assert/strict";
import test from "node:test";
import worker from "./lead-worker.js";

test("unknown routes are not exposed", async () => {
  const response = await worker.fetch(
    new Request("https://melbournetvs.com/api/meta-lead-webhook"),
    {},
    {},
  );
  assert.equal(response.status, 404);
});

test("public lead endpoints reject unsupported methods", async () => {
  for (const path of ["/api/website-lead", "/api/n8n/lead", "/api/lead-sync"]) {
    const response = await worker.fetch(
      new Request(`https://melbournetvs.com${path}`, { method: "GET" }),
      {},
      {},
    );
    assert.equal(response.status, 405, path);
  }
});

test("website lead OPTIONS responds without exposing an unapproved origin", async () => {
  const response = await worker.fetch(
    new Request("https://melbournetvs.com/api/website-lead", {
      method: "OPTIONS",
      headers: { origin: "https://example.invalid" },
    }),
    {},
    {},
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
