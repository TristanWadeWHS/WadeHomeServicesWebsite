// Run against a local production build; all booking API responses are synthetic.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.BOOKING_QA_URL || "http://127.0.0.1:3031";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
const output = resolve("work/booking-confirmation-qa");
mkdirSync(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const slot = { start: `${date}T17:00:00Z`, end: `${date}T19:00:00Z`, label: "9:00 AM", dateLabel: date };

try {
  for (const [width, height] of [[1366, 900], [768, 900], [390, 844], [320, 667]]) {
    for (const promoCode of ["HAULIDAY15", ""]) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: width < 500,
        hasTouch: width < 800,
        reducedMotion: width < 500 ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      const errors = [];
      const cspErrors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error" && /Content Security Policy/.test(message.text())) cspErrors.push(message.text());
      });
      await page.addInitScript(() => {
        window.bookingScrollCalls = [];
        const scrollTo = window.scrollTo.bind(window);
        window.scrollTo = (...args) => {
          window.bookingScrollCalls.push(args);
          return scrollTo(...args);
        };
      });
      const requestId = `WHS-QA-${width}-${promoCode || "BLANK"}`;
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseUrl).origin) return route.abort();
        if (url.pathname === "/api/booking/availability") return route.fulfill({ json: { slots: [slot] } });
        if (url.pathname === "/api/booking/submit") {
          assert.equal(route.request().postDataJSON().promoCode, promoCode);
          return route.fulfill({ json: { ok: true, leadId: requestId, requestedTime: slot.label, pending: true } });
        }
        if (url.pathname.startsWith("/api/")) return route.abort();
        return route.continue();
      });
      try {
        await page.goto(`${baseUrl}/book`, { waitUntil: "networkidle" });
        const next = () => page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByRole("button", { name: "JR Junk Removal" }).click();
        await next();
        await page.getByRole("button", { name: /On-Site Estimate/ }).click();
        await next();
        await page.getByLabel("Street Address", { exact: true }).fill("123 QA Street");
        await page.getByLabel("City", { exact: true }).fill("Mission Viejo");
        await page.getByLabel("ZIP Code", { exact: true }).fill("92691");
        await next();
        await page.getByLabel("Project Description", { exact: true }).fill("Synthetic confirmation regression test");
        await next();
        await next(); // Optional photos: covered separately with the Blob mock.
        await page.getByLabel("Name", { exact: true }).fill("Jamie Test");
        await page.getByLabel("Email", { exact: true }).fill("jamie@example.invalid");
        await page.getByLabel("Phone Number", { exact: true }).fill("2025550100");
        await next();
        await page.getByLabel("Preferred Date").fill(date);
        await page.waitForFunction(() => document.querySelector("select")?.options.length > 1);
        await page.getByLabel("Preferred Time").selectOption({ index: 1 });
        await page.getByLabel("Have a promo code?").fill(promoCode.toLowerCase());
        await next();
        await page.getByRole("button", { name: "Submit Request", exact: true }).click();
        await page.waitForFunction(() => document.activeElement?.id === "booking-thanks");
        const position = await page.evaluate(() => {
          const rect = selector => {
            const bounds = document.querySelector(selector).getBoundingClientRect();
            return { top: bounds.top, bottom: bounds.bottom };
          };
          return {
            heading: rect("#booking-thanks"), mascot: rect(".booking-success__mascot"),
            card: rect(".booking-success"), header: rect(".site-header"),
            height: innerHeight, scrollY, calls: window.bookingScrollCalls,
          };
        });
        assert.equal(position.calls.length, 1, "one deliberate success scroll");
        assert.equal(position.calls[0][0].behavior, "instant");
        assert.ok(Math.abs(position.card.top - position.header.bottom - 16) <= 2, "card clears sticky header");
        for (const element of [position.heading, position.mascot]) {
          assert.ok(element.top >= position.header.bottom, "content is not covered by header");
          assert.ok(element.bottom <= position.height, "content fits in initial viewport");
        }
        const heading = page.getByRole("heading", { name: "Thanks, Jamie!", exact: true });
        assert.equal(await heading.getAttribute("aria-describedby"), "booking-success-message");
        assert.equal(await page.locator(".booking-success").getAttribute("role"), "status");
        assert.ok((await page.locator("#booking-success-message").innerText()).includes("successfully submitted"));
        assert.ok(await page.getByText(`Your Request Number: #${requestId}`, { exact: true }).isVisible());
        await page.waitForFunction(() => document.querySelector(".booking-success__mascot img")?.naturalWidth > 0);
        await page.waitForTimeout(750); // Let the existing entrance animation finish.
        assert.equal(await page.evaluate(() => scrollY), position.scrollY, "image/animation causes no later scroll");
        assert.equal(await page.evaluate(() => document.activeElement.id), "booking-thanks");
        if (width < 500) assert.equal(await page.locator(".booking-success__mascot").evaluate(e => getComputedStyle(e).animationName), "none");
        assert.deepEqual(errors, []);
        assert.ok(cspErrors.every(error => error.includes("googletagmanager.com")), "no new CSP failures");
        await page.screenshot({ path: resolve(output, `confirmation-${width}-${promoCode || "blank"}.png`) });
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Return Home");
        results.push({ width, height, promoCode, passed: true, position, existingTrackingCspErrors: cspErrors.length });
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  writeFileSync(resolve(output, "confirmation-browser-results.json"), JSON.stringify(results, null, 2));
}
assert.equal(results.length, 8);
console.log("Passed 8 confirmation viewport/focus cases, with and without HAULIDAY15.");
