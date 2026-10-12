// Two-browser watch-together smoke test. Start the server first:
//   npm run build && PORT=11470 node server/dist/index.js
// then: node test/e2e/watch-together.mjs
import pw from "playwright";
const { chromium } = pw;
const BASE = "http://127.0.0.1:11470/app/";
const browser = await chromium.launch();
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

async function newPage(ctxName) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log(`[${ctxName} console.error]`, m.text()); });
  return { ctx, page };
}

// 1) Home renders at least one catalog row (needs cinemeta; real network).
const host = await newPage("host");
await host.page.goto(BASE, { waitUntil: "domcontentloaded" });
await host.page.waitForSelector(".row .card:not(.skeleton), .empty", { timeout: 25000 });
const rowCount = await host.page.locator(".row").count();
console.log("home rows:", rowCount);
const realCards = await host.page.locator(".row .card:not(.skeleton)").count();
console.log("home cards (non-skeleton):", realCards);
if (realCards === 0) fail("no catalog cards rendered on home");

// 2) Create a watch-together room.
await host.page.goto(BASE + "#/party", { waitUntil: "domcontentloaded" });
await host.page.fill(".field input", "Alice");
await host.page.getByRole("button", { name: /Start an empty room/i }).click();
await host.page.waitForSelector(".party-code", { timeout: 15000 });
const codeText = await host.page.locator(".party-code").textContent();
const code = (codeText || "").replace(/^\s*Room\s*/i, "").trim();
console.log("room code:", code);
if (code.length !== 6) fail("room code not shown");

// 3) Second browser joins by code.
const guest = await newPage("guest");
await guest.page.goto(BASE + "#/party/" + code, { waitUntil: "domcontentloaded" });
await guest.page.fill(".field input", "Bob");
await guest.page.getByRole("button", { name: /Join room/i }).click();
await guest.page.waitForSelector(".party-code", { timeout: 15000 });

// 4) Both panels should show 2 members. Switch host panel to People tab.
await host.page.locator(".party-tabs button", { hasText: "People" }).click();
await guest.page.locator(".party-tabs button", { hasText: "People" }).click();
await host.page.waitForFunction(() => document.querySelectorAll(".person").length === 2, null, { timeout: 10000 });
await guest.page.waitForFunction(() => document.querySelectorAll(".person").length === 2, null, { timeout: 10000 });
console.log("both rooms show 2 members");

// 5) Chat relays host -> guest.
await host.page.locator(".party-tabs button", { hasText: "Chat" }).click();
await guest.page.locator(".party-tabs button", { hasText: "Chat" }).click();
await host.page.fill(".chat-input input", "hello from Alice");
await host.page.locator(".chat-input button").click();
await guest.page.waitForFunction(() => document.body.innerText.includes("hello from Alice"), null, { timeout: 10000 });
console.log("chat relayed host -> guest");

await browser.close();
if (!process.exitCode) console.log("E2E PASS");
