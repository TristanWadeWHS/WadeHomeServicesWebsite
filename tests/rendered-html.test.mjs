import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the Wade Home Services home page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Wade Home Services/);
  assert.match(html, /wade-home-services-logo\.png/);
  assert.match(html, /AI price estimator/);
  assert.match(html, /Coming Fall 2026/);
  assert.match(html, /Junk Removal/);
  assert.match(html, /Demolition/);
  assert.match(html, /Storage &amp; Relocation|Storage & Relocation/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("renders each focused route", async () => {
  const routes = [
    ["/about-us", /About Us/],
    ["/junk-removal", /Junk Removal/],
    ["/demolition", /Demolition/],
    ["/storage-relocation", /Storage &amp; Relocation|Storage & Relocation/],
    ["/faq", /Clear answers without overpromising/],
  ];

  for (const [path, expected] of routes) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, expected, path);
    assert.match(html, /wade-home-services-logo\.png/, path);
  }
});
