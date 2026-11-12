// Records four ReimburseAI demo videos (MP4, 1920x1080) against a fresh, isolated copy of the app on port 3100.
// Usage: npm run record   (needs a production build: npm --prefix ../reimburse-ai run build)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { chromium } from "playwright-core";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(ROOT, "../reimburse-ai");
const SAMPLES = path.join(APP_DIR, "samples");
const REAL_DINNER = path.resolve(ROOT, "../test-receipts/dinner-san-francisco-2006-lowres.jpg");
const RUNTIME = path.join(ROOT, "runtime");
const OUT_DIR = path.join(ROOT, "videos");
const PORT = Number(process.env.DEMO_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1440, height: 810 };
const SCALE = 4 / 3; // 1440x810 CSS pixels -> 1920x1080 video frames
const FPS = 30;

const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

// ---------------------------------------------------------------- app server

async function startServer() {
  const data = path.join(RUNTIME, ".data");
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  const ocrCache = path.join(APP_DIR, ".data", "tesseract");
  if (fs.existsSync(ocrCache)) fs.cpSync(ocrCache, path.join(data, "tesseract"), { recursive: true });

  // The app keeps its database under process.cwd()/.data, so a different cwd gives an isolated demo database.
  const logFd = fs.openSync(path.join(RUNTIME, "server.log"), "w");
  const server = spawn(process.execPath, [path.join(APP_DIR, "node_modules/next/dist/bin/next"), "start", APP_DIR, "-p", String(PORT)], {
    cwd: RUNTIME,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, NODE_ENV: "production" },
  });

  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      await res.text();
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (i > 120) throw new Error(`Demo server did not start; see ${path.join(RUNTIME, "server.log")}`);
    await sleep(500);
  }
  const credentials = path.join(data, "demo-credentials.txt");
  for (let i = 0; !fs.existsSync(credentials); i++) {
    if (i > 60) throw new Error("Demo database was not seeded");
    await sleep(500);
  }
  const password = fs.readFileSync(credentials, "utf8").match(/^Password: (.+)$/m)?.[1]?.trim();
  if (!password) throw new Error("Demo password not found");
  log(`Demo server ready on ${BASE} (fresh database in ${path.relative(ROOT, data)})`);
  return { server, password };
}

async function launchBrowser() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      const browser = await chromium.launch({ channel, headless: !process.argv.includes("--headed") });
      log(`Browser: ${channel} ${browser.version()}`);
      return browser;
    } catch (error) {
      log(`Could not launch ${channel}: ${String(error.message).split("\n")[0]}`);
    }
  }
  throw new Error("Neither Microsoft Edge nor Google Chrome could be launched");
}

// ---------------------------------------------------------------- recorder

/** Streams CDP screencast frames into ffmpeg, duplicating frames to keep real-time pacing at a constant FPS. */
class Recorder {
  constructor(page, name) {
    this.page = page;
    this.file = path.join(OUT_DIR, name);
  }

  async start() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    this.ff = spawn(
      ffmpeg.path,
      [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0",
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-movflags", "+faststart",
        this.file,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    this.ff.stdin.on("error", () => {});
    this.ff.stderr.on("data", (chunk) => process.stderr.write(`[ffmpeg] ${chunk}`));
    this.closed = new Promise((resolve) => this.ff.on("close", resolve));
    this.frames = 0;
    this.last = null;
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      this.push(Buffer.from(data, "base64"));
      this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  }

  push(frame) {
    const now = performance.now() / 1000;
    if (this.last) this.emit(now);
    else this.clock = now;
    this.last = frame;
  }

  emit(until) {
    const count = Math.floor((until - this.clock) * FPS);
    for (let i = 0; i < count; i++) this.ff.stdin.write(this.last);
    this.frames += count;
    this.clock += count / FPS;
  }

  async stop() {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    if (this.last) {
      this.emit(performance.now() / 1000);
      this.ff.stdin.write(this.last);
      this.frames += 1;
    }
    this.ff.stdin.end();
    const code = await this.closed;
    await this.cdp.detach().catch(() => {});
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const seconds = Math.round(this.frames / FPS);
    log(`Saved ${path.relative(ROOT, this.file)} (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`);
  }
}

// ---------------------------------------------------------------- in-page overlay (cursor, captions, title cards)

function overlay() {
  if (window.top !== window) return;
  const CSS = `
#__demo_root, #__demo_root * { box-sizing: border-box; }
#__demo_cursor { position: fixed; left: -80px; top: -80px; z-index: 2147483647; width: 26px; height: 26px; margin: -3px 0 0 -4px; pointer-events: none; transform-origin: 4px 3px; transition: transform .1s ease; }
#__demo_cursor.down { transform: scale(.8); }
.__demo_ripple { position: fixed; z-index: 2147483646; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid rgba(37,99,235,.9); background: rgba(37,99,235,.18); pointer-events: none; animation: __demo_ripple .55s ease-out forwards; }
@keyframes __demo_ripple { from { transform: scale(.25); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
#__demo_caption { position: fixed; left: 50%; bottom: 24px; z-index: 2147483645; display: flex; align-items: center; gap: 14px; width: max-content; max-width: min(1180px, calc(100vw - 80px)); padding: 13px 22px 13px 14px; border-radius: 14px; background: rgba(15,23,42,.94); color: #fff; box-shadow: 0 12px 32px rgba(15,23,42,.35); font: 600 19px/1.4 "Segoe UI", system-ui, sans-serif; pointer-events: none; opacity: 0; transform: translate(-50%, 12px); transition: opacity .35s ease, transform .35s ease; }
#__demo_caption.on { opacity: 1; transform: translate(-50%, 0); }
#__demo_caption .step { flex: none; padding: 4px 11px; border-radius: 8px; background: #2563eb; font-size: 14px; font-weight: 700; white-space: nowrap; }
#__demo_caption .step:empty { display: none; }
#__demo_caption .credit { display: block; margin-top: 3px; font-size: 13px; font-weight: 500; color: #94a3b8; }
#__demo_caption .credit:empty { display: none; }
#__demo_card { position: fixed; inset: 0; z-index: 2147483644; display: none; flex-direction: column; align-items: center; justify-content: center; padding: 60px; text-align: center; color: #fff; background: radial-gradient(1100px 600px at 15% 0%, #3b82f6 0%, transparent 60%), linear-gradient(135deg, #1d4ed8 0%, #312e81 100%); font-family: "Segoe UI", system-ui, sans-serif; opacity: 0; transition: opacity .45s ease; pointer-events: none; }
#__demo_card.on { opacity: 1; }
#__demo_card .brand { position: absolute; top: 38px; left: 46px; display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 700; }
#__demo_card .brand b { display: inline-flex; width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 9px; background: #fff; color: #1d4ed8; font-weight: 900; }
#__demo_card .kicker { margin-bottom: 18px; font-size: 17px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #bfdbfe; }
#__demo_card h1 { margin: 0 0 18px; max-width: 1100px; font-size: 52px; line-height: 1.12; font-weight: 800; }
#__demo_card p { margin: 0; max-width: 980px; font-size: 22px; line-height: 1.5; color: #dbeafe; }
#__demo_card .bar { position: absolute; left: 0; bottom: 0; width: 100%; height: 6px; background: rgba(255,255,255,.15); }
#__demo_card .bar i { display: block; width: 0; height: 100%; background: #93c5fd; }`;
  const CURSOR =
    '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5l15 10.2-6.6 1.2 3.9 7.1-2.9 1.6-3.9-7.2L4.6 20z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem("__demo_state") || "{}");
    } catch {
      return {};
    }
  };
  const write = (state) => {
    try {
      sessionStorage.setItem("__demo_state", JSON.stringify(state));
    } catch {
      // storage unavailable
    }
  };

  function install() {
    if (!document.body) return null;
    let root = document.getElementById("__demo_root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "__demo_root";
    root.innerHTML = `<style>${CSS}</style><div id="__demo_card"><div class="brand"><b>R</b>ReimburseAI</div><div class="kicker"></div><h1></h1><p></p><div class="bar"><i></i></div></div><div id="__demo_caption"><span class="step"></span><span><span class="text"></span><span class="credit"></span></span></div><div id="__demo_cursor">${CURSOR}</div>`;
    document.body.appendChild(root);
    apply(read(), root);
    return root;
  }

  function apply(state, root = install()) {
    if (!root) return;
    const caption = root.querySelector("#__demo_caption");
    caption.querySelector(".step").textContent = state.caption?.step || "";
    caption.querySelector(".text").textContent = state.caption?.text || "";
    caption.querySelector(".credit").textContent = state.credit || "";
    caption.classList.toggle("on", Boolean(state.caption));
    if (state.mouse) {
      const cursor = root.querySelector("#__demo_cursor");
      cursor.style.left = `${state.mouse.x}px`;
      cursor.style.top = `${state.mouse.y}px`;
    }
  }

  addEventListener(
    "mousemove",
    (event) => {
      const cursor = install()?.querySelector("#__demo_cursor");
      if (!cursor) return;
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
      write({ ...read(), mouse: { x: event.clientX, y: event.clientY } });
    },
    true,
  );
  addEventListener(
    "mousedown",
    (event) => {
      const root = install();
      if (!root) return;
      root.querySelector("#__demo_cursor").classList.add("down");
      const ripple = document.createElement("div");
      ripple.className = "__demo_ripple";
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    true,
  );
  addEventListener("mouseup", () => document.getElementById("__demo_cursor")?.classList.remove("down"), true);

  window.__demo = {
    set(partial) {
      const state = { ...read(), ...partial };
      write(state);
      apply(state);
    },
    card(kicker, title, text, ms) {
      const card = install()?.querySelector("#__demo_card");
      if (!card) return;
      card.querySelector(".kicker").textContent = kicker;
      card.querySelector("h1").textContent = title;
      card.querySelector("p").textContent = text;
      const bar = card.querySelector(".bar i");
      bar.style.transition = "none";
      bar.style.width = "0";
      card.style.display = "flex";
      void card.offsetWidth;
      card.classList.add("on");
      requestAnimationFrame(() => {
        bar.style.transition = `width ${ms}ms linear`;
        bar.style.width = "100%";
      });
    },
    hideCard() {
      const card = document.getElementById("__demo_card");
      if (!card) return;
      card.classList.remove("on");
      setTimeout(() => {
        card.style.display = "none";
      }, 480);
    },
  };

  const boot = () => setTimeout(install, 200);
  if (document.readyState === "complete") boot();
  else addEventListener("load", boot, { once: true });
  setInterval(() => {
    if (document.body && !document.getElementById("__demo_root")) install();
  }, 400);
}

// ---------------------------------------------------------------- page director

class Director {
  constructor(page) {
    this.page = page;
    this.mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  }

  async goto(url) {
    await this.page.goto(BASE + url, { waitUntil: "load" });
    await this.ready();
  }

  async ready() {
    await this.page.waitForFunction(() => Boolean(window.__demo) && Boolean(document.getElementById("__demo_root")), null, { timeout: 20_000 });
  }

  async set(state) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await this.ready();
        await this.page.evaluate((s) => window.__demo.set(s), state);
        return;
      } catch {
        await sleep(400);
      }
    }
  }

  caption(text, step = "") {
    return this.set({ caption: text ? { text: text.length > 170 ? `${text.slice(0, 167)}…` : text, step } : null });
  }

  credit(text) {
    return this.set({ credit: text });
  }

  async card(kicker, title, text, ms) {
    await this.ready();
    await this.page.evaluate(([k, t, x, m]) => window.__demo.card(k, t, x, m), [kicker, title, text, ms]);
    await sleep(500);
  }

  async hideCard() {
    await this.page.evaluate(() => window.__demo.hideCard());
    await sleep(600);
  }

  locator(target) {
    return typeof target === "string" ? this.page.locator(target).first() : target;
  }

  section(title) {
    return this.page.locator("section").filter({ has: this.page.locator("header h2", { hasText: title }) }).first();
  }

  async moveTo(x, y) {
    const from = { ...this.mouse };
    const steps = Math.max(10, Math.min(40, Math.round(Math.hypot(x - from.x, y - from.y) / 20)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased);
      await sleep(14);
    }
    this.mouse = { x, y };
  }

  async reveal(target) {
    const loc = this.locator(target);
    await loc.waitFor({ state: "visible", timeout: 30_000 });
    const outside = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < 20 || r.bottom > innerHeight - 140;
    });
    if (outside) {
      await loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, scrollY + r.top - innerHeight * 0.35), behavior: "smooth" });
      });
      await sleep(900);
    }
    return loc;
  }

  async pointAt(target, { dx = null } = {}) {
    const loc = await this.reveal(target);
    const box = await loc.boundingBox();
    if (!box) throw new Error(`Element has no box: ${target}`);
    const x = dx === null ? box.x + box.width / 2 : box.x + dx;
    await this.moveTo(x, box.y + box.height / 2);
    return loc;
  }

  async hover(target, ms = 0) {
    await this.pointAt(target);
    if (ms) await sleep(ms);
  }

  async click(target, { pause = 350, dx = null } = {}) {
    await this.pointAt(target, { dx });
    await sleep(170);
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    await sleep(pause);
  }

  async dblclick(target) {
    await this.pointAt(target);
    await sleep(200);
    await this.page.mouse.dblclick(this.mouse.x, this.mouse.y);
    await sleep(400);
  }

  async type(target, text, delay = 30) {
    await this.click(target, { pause: 120 });
    await this.page.keyboard.type(text, { delay });
  }

  async upload(file) {
    const input = this.page.locator('input[name="receipt"]');
    const chooser = this.page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
    await this.click(input, { pause: 100, dx: 70 });
    const dialog = await chooser;
    if (dialog) await dialog.setFiles(file);
    else await input.setInputFiles(file);
    await sleep(700);
  }

  async scrollTo(target, offset = 24) {
    const loc = this.locator(target);
    await loc.waitFor({ state: "visible", timeout: 30_000 });
    await loc.evaluate((el, off) => window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - off), behavior: "smooth" }), offset);
    await sleep(1_100);
  }

  async scrollTop() {
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1_000);
  }

  async login(email, password) {
    await this.type('input[name="email"]', email, 35);
    await this.type('input[name="password"]', password, 25);
    await this.click('button[type="submit"]');
    await this.page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
    await this.page.locator("main h1").first().waitFor({ timeout: 30_000 });
  }

  async submitClaim(file, purpose) {
    await this.page.locator('input[name="receipt"]').waitFor({ timeout: 30_000 });
    await this.upload(file);
    await this.type('textarea[name="purpose"]', purpose);
    await sleep(500);
    const started = Date.now();
    await this.click('button:has-text("Submit for processing")');
    await this.page.waitForURL(/\/claims\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await this.section("Agent pipeline").waitFor({ timeout: 30_000 });
    return started;
  }

  async waitForAgents() {
    await this.page.waitForFunction(() => !document.body.innerText.includes("Agents working"), null, { timeout: 180_000, polling: 500 });
    await sleep(900);
  }

  status() {
    return this.page.evaluate(() => document.querySelector("main h1")?.nextElementSibling?.querySelector("span")?.textContent?.trim() ?? "");
  }

  decisionNote() {
    return this.page.evaluate(() => {
      const head = [...document.querySelectorAll("main p")].find((p) => /^Decision (by|·)/.test(p.textContent ?? ""));
      return head?.nextElementSibling?.textContent?.trim() ?? "";
    });
  }

  headline() {
    return this.page.evaluate(() => {
      const h1 = document.querySelector("main h1");
      return `${h1?.firstChild?.textContent?.trim() ?? ""} · ${h1?.querySelector("span")?.textContent?.trim() ?? ""}`;
    });
  }

  field(label) {
    return this.page.evaluate((name) => {
      const dt = [...document.querySelectorAll("main dt")].find((el) => el.textContent?.trim().toLowerCase() === name.toLowerCase());
      return dt?.nextElementSibling?.textContent?.trim() ?? "";
    }, label);
  }

  riskSummary() {
    return this.page.evaluate(() => {
      const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("header h2")?.textContent === "Risk assessment");
      const [score, level] = [...(section?.querySelectorAll(".text-center p") ?? [])].map((p) => p.textContent?.trim());
      return score ? `Risk ${score}/100 (${level})` : "Risk scored";
    });
  }

  async payoutCaption() {
    const provider = await this.field("Provider");
    const status = await this.field("PayPal status");
    return provider === "PayPal Payouts"
      ? `Paid through PayPal Payouts — status ${status}, with the batch ID kept for reconciliation`
      : `Payout recorded with batch ID and status ${status} — simulated PayPal (dry-run mode for the demo)`;
  }

  topReasons(count) {
    return this.page.evaluate((n) => {
      const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("header h2")?.textContent === "Risk assessment");
      return [...(section?.querySelectorAll("ul li") ?? [])]
        .map((li) => ({ text: li.querySelector("span")?.textContent?.trim() ?? "", weight: li.querySelector("span:last-child")?.textContent?.trim() ?? "" }))
        .filter((r) => r.text && r.weight.startsWith("+"))
        .slice(0, n)
        .map((r) => r.text);
    }, count);
  }

  tooltipText() {
    return this.page.evaluate(() => document.querySelector(".ag-tooltip")?.textContent ?? "");
  }

  // AG Grid 36 renders each row as a single .ag-row element.
  async rowId(text) {
    const row = this.page.locator(".ag-row", { hasText: text }).first();
    await row.waitFor({ timeout: 30_000 });
    return row.getAttribute("row-id");
  }

  gridCell(rowId, colId) {
    return this.page.locator(`.ag-row[row-id="${rowId}"] [col-id="${colId}"]`).first();
  }

  checkbox(rowId) {
    return this.page.locator(`.ag-row[row-id="${rowId}"] .ag-checkbox-input-wrapper`).first();
  }

  openLink(rowId) {
    return this.page.locator(`.ag-row[row-id="${rowId}"] a:has-text("Open")`).first();
  }

  tab(name) {
    return this.page.getByRole("button", { name: new RegExp(`^${name}\\s*\\d+$`) });
  }

  async selectPolicyLimit(category) {
    await this.page.evaluate((key) => {
      const area = document.querySelector('textarea[name="policy"]');
      const value = area.value;
      const start = value.indexOf('"limit": ', value.indexOf(`"${key}"`)) + '"limit": '.length;
      const end = value.indexOf(",", start);
      area.focus();
      area.setSelectionRange(start, end);
      const line = value.slice(0, start).split("\n").length;
      area.scrollTop = Math.max(0, (line - 9) * (parseFloat(getComputedStyle(area).lineHeight) || 19));
    }, category);
  }
}

async function newSession(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, locale: "en-US", timezoneId: "UTC", colorScheme: "light" });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => log(`  page error: ${error.message}`));
  return { context, page, d: new Director(page) };
}

async function quickLogin(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }), page.click('button[type="submit"]')]);
}

async function endCard(d, kicker, title, text) {
  await d.caption(null);
  await d.credit(null);
  await d.card(kicker, title, text, 4_000);
  await sleep(4_000);
}

// ---------------------------------------------------------------- demo 1: founder happy path

async function demo1(browser, password) {
  const { context, page, d } = await newSession(browser);
  await d.goto("/login");
  await d.card(
    "Demo 1 of 4 · Startup founder",
    "From receipt to payout — no human needed",
    "A founder uploads a taxi receipt. AI agents read, verify and reconcile it, then pay it through PayPal automatically.",
    4_500,
  );
  const rec = new Recorder(page, "1-founder-receipt-to-payout.mp4");
  await rec.start();
  await sleep(4_500);
  await d.hideCard();

  await d.caption("Alex, founder of Acme Robotics (a startup funded by Northstar Ventures), signs in", "Sign in");
  await d.login("founder@acme.test", password);
  await d.caption("“My claims” is empty — time to submit a receipt", "My claims");
  await sleep(2_500);
  await d.click('main a:has-text("Submit a claim")');
  await d.caption("Upload the taxi receipt photo and add the business purpose", "Submit a claim");
  const started = await d.submitClaim(path.join(SAMPLES, "01-city-cabs-taxi.png"), "Taxi from JFK airport to the investor meeting in Manhattan");

  await d.caption("The agents start at once: OCR → AI extraction → verification → duplicates → policy → bank reconciliation → risk → payout", "Agents at work");
  await d.scrollTo(d.section("Agent pipeline"), 90);
  await d.waitForAgents();
  const seconds = Math.round((Date.now() - started) / 1000);
  const status = await d.status();
  log(`  demo 1 claim finished: ${status} in ${seconds}s`);
  await sleep(1_500);
  await d.scrollTop();
  await d.caption(
    status === "Paid" ? `Approved and paid automatically in ${seconds} seconds — nobody had to look at it` : `Finished in ${seconds} seconds — status: ${status}`,
    "Result",
  );
  await sleep(4_500);

  await d.scrollTo(d.section("Risk assessment"));
  await d.caption(`${await d.riskSummary()}. Rules compute the score; the AI only writes the explanation for humans`, "Risk");
  await sleep(5_000);
  await d.scrollTo(d.section("Findings"));
  await d.caption("Every check is visible: totals, date, duplicates, policy, grant budget and the matching card transaction", "Findings");
  await sleep(5_500);
  await d.scrollTop();
  if (await d.section("Payment").count()) {
    await d.hover(d.section("Payment"));
    await d.caption(await d.payoutCaption(), "Payout");
    await sleep(4_500);
  }
  await d.click('header nav a:has-text("My claims")');
  await page.locator('main h1:has-text("My claims")').waitFor();
  await d.caption("The founder sees the claim as paid, plus a notification", "My claims");
  await sleep(4_500);
  await endCard(d, "Demo 1 complete", "Receipt → verified → paid", "AI reads the receipt. Rules decide. Low-risk claims never wait for a person.");
  await rec.stop();
  await context.close();
}

// ---------------------------------------------------------------- demo 2: fraud and bad receipts

async function attempt(d, { step, intro, file, purpose, credit }) {
  await d.caption(intro, step);
  if (credit) await d.credit(credit);
  await d.submitClaim(file, purpose);
  await d.caption("The agents are checking it…", step);
  await d.scrollTo(d.section("Agent pipeline"), 90);
  await d.waitForAgents();
  await sleep(1_200);
  const status = await d.status();
  const note = await d.decisionNote();
  log(`  ${step}: ${status} — ${note}`);
  return { status, note };
}

async function demo2(browser, password) {
  const { context, page, d } = await newSession(browser);
  await quickLogin(page, "founder@acme.test", password);
  await d.goto("/claims/new");
  await d.card(
    "Demo 2 of 4 · Fraud & bad receipts",
    "Bad claims are stopped before money moves",
    "A duplicate photo, a Photoshop-edited invoice and a real low-quality restaurant receipt from the internet.",
    4_500,
  );
  const rec = new Recorder(page, "2-fraud-and-bad-receipts.mp4");
  await rec.start();
  await sleep(4_500);
  await d.hideCard();

  // 1 — duplicate
  let result = await attempt(d, {
    step: "Attempt 1 · Duplicate",
    intro: "Attempt 1: claim the same taxi ride again — a new photo of the receipt that was already paid",
    file: path.join(SAMPLES, "07-city-cabs-taxi-photo.png"),
    purpose: "Taxi from JFK airport to the investor meeting",
  });
  await d.scrollTop();
  await d.caption(`${result.status}: ${result.note}`, "Attempt 1 · Result");
  await sleep(4_500);
  const duplicateFound = !(await d.section("Findings").innerText()).includes("No earlier claim matches");
  await d.caption(
    duplicateFound
      ? "Different photo, same receipt: the duplicate agent matched it to the paid claim, and its card transaction was already used"
      : "The findings show why the agents stopped it",
    "Why",
  );
  await d.scrollTo(d.section("Findings"));
  await sleep(6_000);

  // 2 — edited PDF
  await d.click('header nav a:has-text("Submit a claim")');
  result = await attempt(d, {
    step: "Attempt 2 · Tampering",
    intro: "Attempt 2: an invoice PDF that was edited in Photoshop",
    file: path.join(SAMPLES, "06-brightline-invoice-edited.pdf"),
    purpose: "Strategy workshop facilitation for the product team",
  });
  await d.scrollTop();
  await d.caption(`${result.status}: ${result.note}`, "Attempt 2 · Result");
  await sleep(4_500);
  const tampered = (await d.section("Findings").innerText()).includes("editing tool");
  await d.caption(
    tampered
      ? "The verification agent reads the PDF's metadata: it was produced with Adobe Photoshop, so it is treated as tampered"
      : "The findings show why the agents stopped it",
    "Why",
  );
  await d.scrollTo(d.section("Findings"));
  await sleep(6_000);

  // 3 — real low-quality photo
  await d.click('header nav a:has-text("Submit a claim")');
  result = await attempt(d, {
    step: "Attempt 3 · Real photo",
    intro: "Attempt 3: a real restaurant receipt photo from the internet — only 300 px wide, dated 2006",
    file: REAL_DINNER,
    purpose: "Team dinner with pilot customers in San Francisco",
    credit: "Receipt photo: Peter Merholz · CC BY-SA 2.0 · via Wikimedia Commons",
  });
  const ai = await d.field("AI calls");
  await d.caption(
    ai.startsWith("None")
      ? "Rules-only mode: no AI calls were made for this claim"
      : `AI calls on this claim: ${ai} — one reads the photo + OCR text, one writes the risk explanation (purple lines)`,
    "AI usage",
  );
  await sleep(5_500);
  await d.scrollTop();
  await d.caption(`The AI read the blurry photo: ${await d.headline()} · ${await d.field("Receipt date")}. ${result.status}: ${result.note}`, "Attempt 3 · Result");
  await sleep(5_000);
  const reasons = await d.topReasons(3);
  await d.caption(`But rules decide: ${reasons.join(" · ")}`, "Why");
  await d.scrollTo(d.section("Risk assessment"));
  await sleep(7_000);
  await d.credit(null);

  await d.click('header nav a:has-text("My claims")');
  await page.locator('main h1:has-text("My claims")').waitFor();
  await d.caption("One claim paid, three stopped automatically — no reviewer time spent", "My claims");
  await sleep(5_000);
  await endCard(d, "Demo 2 complete", "Fraud and errors caught automatically", "Duplicates, edited documents and receipts that break the rules never reach a payout.");
  await rec.stop();
  await context.close();
}

// ---------------------------------------------------------------- setup for demos 3 and 4 (not recorded)

async function seedReviewQueue(browser, password) {
  log("Submitting background claims for the review queue (not recorded)…");
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await quickLogin(page, "founder@acme.test", password);
  const claims = [
    ["03-le-petit-bistro.png", "Dinner with the lead investor of our seed round"],
    ["04-grand-harbor-hotel.pdf", "Hotel for the Boston robotics conference (3 nights)"],
    ["02-cloudstack-invoice.pdf", "CloudStack team plan for the engineering team"],
    ["05-staples-order.txt", "Printer paper and toner for the office"],
  ];
  for (const [file, purpose] of claims) {
    await page.goto(`${BASE}/claims/new`);
    await page.setInputFiles('input[name="receipt"]', path.join(SAMPLES, file));
    await page.fill('textarea[name="purpose"]', purpose);
    await Promise.all([page.waitForURL(/\/claims\/[0-9a-f-]{36}$/, { timeout: 60_000 }), page.click('button:has-text("Submit for processing")')]);
  }
  for (let i = 0; ; i++) {
    await page.goto(`${BASE}/claims`);
    await page.locator("main tbody tr").first().waitFor({ timeout: 30_000 });
    const text = await page.locator("main").innerText();
    if (!text.includes("Agents working") && !text.includes("Reading receipt")) break;
    if (i > 60) throw new Error("Background claims did not finish processing");
    await sleep(3_000);
  }
  const rows = await page.locator("main tbody tr").allInnerTexts();
  for (const row of rows) log(`  ${row.replace(/\s+/g, " ").trim()}`);
  await context.close();
}

// ---------------------------------------------------------------- demo 3: reviewer

async function demo3(browser, password) {
  const { context, page, d } = await newSession(browser);
  await d.goto("/login");
  await d.card(
    "Demo 3 of 4 · Finance reviewer",
    "People only handle the exceptions",
    "The review queue shows only what the agents could not decide alone — with their findings, a risk score and one-click decisions.",
    4_500,
  );
  const rec = new Recorder(page, "3-reviewer-exceptions-queue.mp4");
  await rec.start();
  await sleep(4_500);
  await d.hideCard();

  await d.caption("Ravi, a finance reviewer at Northstar Ventures, signs in", "Sign in");
  await d.login("reviewer@northstar.test", password);
  await page.locator(".ag-root").first().waitFor();
  await d.caption("Live KPIs: claims needing review, straight-through rate, money paid out and rejections", "Dashboard");
  await d.hover('main p:has-text("Straight-through")', 4_500);

  const bistro = await d.rowId("Bistro");
  const hotel = await d.rowId("Harbor");
  await d.caption("Only flagged claims land here. Hover a row to see every finding the agents raised", "Needs review");
  await d.hover(d.gridCell(bistro, "flags"), 4_000);
  const wine = (await d.tooltipText()).toLowerCase().includes("wine");
  log(`  bistro findings include wine: ${wine}`);

  await d.caption(
    wine
      ? "Over the $75 meals limit and the bill includes wine — the reviewer reimburses only $75 of food, edited inline"
      : "The dinner is over the $75 meals limit — the reviewer reimburses only $75, edited inline",
    "Inline correction",
  );
  await d.dblclick(d.gridCell(bistro, "amount"));
  await page.keyboard.press("Control+A");
  await page.keyboard.type("75", { delay: 180 });
  await sleep(400);
  await page.keyboard.press("Enter");
  await page.locator('p[role="status"]', { hasText: "Saved" }).waitFor({ timeout: 90_000 });
  await d.caption("Saved — the agents immediately re-checked the claim with the corrected amount", "Re-check");
  await sleep(4_500);

  await d.caption("Select it, add a note for the audit trail, and approve — the PayPal payout starts right away", "Decision");
  await d.click(d.checkbox(bistro));
  await d.type(
    'input[placeholder="Note / rejection reason"]',
    wine ? "Approved $75 for food only; wine excluded" : "Approved up to the $75 meals allowance",
    30,
  );
  await d.click('button:has-text("Approve & pay")');
  await page.locator('p[role="status"]', { hasText: "Approved 1" }).waitFor({ timeout: 60_000 });
  await sleep(3_500);

  await d.caption("Segregation of duties: claims above $1,000 need an admin — a reviewer cannot approve this hotel bill", "Approval limits");
  await d.click(d.checkbox(hotel));
  await sleep(2_000);
  await d.click('button:has-text("Approve & pay")');
  await page.locator('p[role="status"]', { hasText: "Skipped" }).waitFor({ timeout: 60_000 });
  await sleep(4_000);

  await d.click(d.tab("Paid"));
  await d.caption("Paid: the straight-through claims plus the dinner just approved", "Paid");
  await sleep(4_500);
  await d.click(d.tab("Rejected / failed"));
  await d.caption("Rejected automatically: the duplicate, the edited invoice and the 2006 receipt — each with its reason", "Rejected");
  await d.hover(page.locator(".ag-row [col-id='flags']").first(), 4_500);

  await d.click(d.tab("All claims"));
  await d.click(d.openLink(bistro));
  await d.section("Audit trail").waitFor();
  await d.caption("Opening the dinner claim…", "Claim");
  await d.scrollTo(d.section("Audit trail"));
  await d.caption("Full audit trail: every agent step, the reviewer's correction and the approval note", "Audit trail");
  await sleep(6_000);
  await endCard(d, "Demo 3 complete", "Humans only see the exceptions", "Inline corrections are re-checked by the agents, approval limits are enforced, and every action is audited.");
  await rec.stop();
  await context.close();
}

// ---------------------------------------------------------------- demo 4: admin

async function demo4(browser, password) {
  const { context, page, d } = await newSession(browser);
  await d.goto("/login");
  await d.card(
    "Demo 4 of 4 · Admin",
    "Approvals above the limit, policy and multi-tenancy",
    "Admins approve high-value claims, tune each organization's rules and manage payees and grant budgets.",
    4_500,
  );
  const rec = new Recorder(page, "4-admin-approvals-policy-tenants.mp4");
  await rec.start();
  await sleep(4_500);
  await d.hideCard();

  await d.caption("Nora, the Northstar Ventures admin, signs in", "Sign in");
  await d.login("admin@northstar.test", password);
  await page.locator(".ag-root").first().waitFor();
  const hotel = await d.rowId("Harbor");
  await d.caption("The hotel bill is waiting for an admin: it is above the $1,000 approval limit", "Needs admin");
  await d.hover(d.gridCell(hotel, "flags"), 3_500);
  await d.click(d.openLink(hotel));
  await d.section("Your decision").waitFor();
  const concerns = await d.topReasons(2);
  await d.caption(
    concerns.length
      ? `${await d.headline()} — flagged: ${concerns.join(" · ")}`
      : `${await d.headline()} — no problems found; it needs an admin only because of the amount`,
    "Claim",
  );
  await sleep(5_000);
  await d.caption("The admin approves with a note for the audit trail", "Admin approval");
  await d.type('textarea[placeholder="Required when rejecting"]', "Approved: Boston robotics conference, 3 nights", 30);
  await d.click('button:has-text("Approve & pay")');
  await d.section("Payment").waitFor({ timeout: 60_000 });
  await d.waitForAgents();
  await d.hover(d.section("Payment"));
  await d.caption(await d.payoutCaption(), "Payout");
  await sleep(5_000);

  await d.click('header nav a:has-text("Policy & payees")');
  await page.locator('main h1:has-text("Policy & payees")').waitFor();
  await d.caption("Integrations: which AI model reads the receipts, how payouts are sent, and whether PayPal webhooks are on", "Integrations");
  await d.hover(d.section("Integrations"), 5_000);

  await d.caption("Each organization's rules are JSON, validated before saving. Raise the meals limit from $75 to $100", "Policy");
  await d.scrollTo(d.section("Reimbursement policy"), 20);
  await d.hover('textarea[name="policy"]');
  await d.selectPolicyLimit("meals");
  await sleep(1_200);
  await page.keyboard.type("100", { delay: 200 });
  await sleep(600);
  await d.click('button:has-text("Save policy")');
  await page.locator("main p", { hasText: "Policy saved" }).waitFor({ timeout: 30_000 });
  await d.caption("Saved — new claims and re-checks use the new rule immediately", "Policy");
  await sleep(4_000);

  await d.scrollTo(d.section("Payees & grant budgets"), 20);
  await d.caption("Payees and grant budgets per startup: committed vs paid, and the PayPal payout email", "Payees");
  await d.hover(d.section("Payees & grant budgets"), 5_000);

  await d.scrollTop();
  await d.caption("Multi-tenant: sign out and sign in as the admin of another organization", "Another tenant");
  await d.click('header button:has-text("Sign out")');
  await page.locator('input[name="email"]').waitFor();
  await d.login("admin@helix.test", password);
  await page.locator(".ag-root").first().waitFor();
  await d.caption("Helix Health Labs sees only its own claims — nothing from Northstar is visible", "Isolation");
  await sleep(5_000);
  await d.click('header nav a:has-text("Policy & payees")');
  await page.locator('main h1:has-text("Policy & payees")').waitFor();
  await d.scrollTo(d.section("Reimbursement policy"), 20);
  await d.selectPolicyLimit("meals");
  await d.caption("…and its own rules: $40 meals limit, a lab-supplies category, admin approval above $500", "Own policy");
  await d.hover('textarea[name="policy"]', 6_000);
  await endCard(d, "ReimburseAI", "AI reads. Rules decide. People handle the exceptions.", "Next.js · Azure OpenAI gpt-4o · Tesseract OCR · Postgres (PGlite) · AG Grid · PayPal Payouts");
  await rec.stop();
  await context.close();
}

// ---------------------------------------------------------------- main

const { server, password } = await startServer();
const stopServer = () => {
  if (server.exitCode === null) server.kill();
};
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

let browser;
try {
  browser = await launchBrowser();
  await demo1(browser, password);
  await demo2(browser, password);
  await seedReviewQueue(browser, password);
  await demo3(browser, password);
  await demo4(browser, password);
  log(`Done. Videos are in ${OUT_DIR}`);
} catch (error) {
  log(`FAILED: ${error.stack ?? error}`);
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) {
      const shot = path.join(RUNTIME, `error-${Date.now()}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      log(`Screenshot of the failing page: ${shot}`);
    }
  }
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stopServer();
}
