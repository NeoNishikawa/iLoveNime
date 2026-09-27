const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let view;
const componentsCss = fs.readFileSync(path.join(__dirname, "../public/css/components.css"), "utf8");
const referenceApp = fs.readFileSync(path.join(__dirname, "../public/js/reference-app.js"), "utf8");
const apiSource = fs.readFileSync(path.join(__dirname, "../public/js/api.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/view.js"), "utf8");
  view = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

test("Local Data dirender sebagai kartu poster dengan progres dan aksi Open", () => {
  const html = view.renderCollection([{ slug: "one", title: "One Anime", image: "poster.jpg", status: "watching", progress: 3, total: 12 }]);
  assert.match(html, /class="saved-card"/);
  assert.match(html, /class="saved-card__art"/);
  assert.match(html, /Episode 3 \/ 12/);
  assert.match(html, /25%/);
  assert.match(html, /data-open="one"/);
  assert.match(html, /class="saved-card__action"/);
});

test("filter Local Data menampilkan label status yang ramah pengguna", () => {
  const html = view.renderCollectionFilters([
    { status: "completed" },
    { status: "watching" },
    { status: "planned" },
    { status: "dropped" },
  ], "completed");
  assert.match(html, /Sudah ditonton/);
  assert.match(html, /Belum selesai/);
  assert.match(html, /Rencana/);
  assert.match(html, /Block/);
  assert.match(html, /aria-pressed="true"/);
});

test("kontrol video tidak boleh menangkap klik yang seharusnya masuk ke iframe", () => {
  assert.match(componentsCss, /\.vo-hotspot\{[^}]*pointer-events:none/);
  assert.match(referenceApp, /playerStage\?\.addEventListener\("click", \(event\) => \{/);
  assert.doesNotMatch(referenceApp, /voHotspot\?\.addEventListener\("click"/);
});

test("PiP iframe memakai handoff seamless tanpa Document PiP lintas window", () => {
  assert.match(referenceApp, /const SEAMLESS_IFRAME_PIP = true/);
  assert.match(referenceApp, /if \(!SEAMLESS_IFRAME_PIP && "documentPictureInPicture"/);
  assert.match(referenceApp, /\.pip-body.*appendChild\(iframe\)/s);
  assert.doesNotMatch(componentsCss, /\.pip-window\{[^}]*animation:pipIn/s);
});

test("PiP dapat dipindahkan dengan pointer tanpa mengganggu iframe", () => {
  assert.match(referenceApp, /data-pip-drag-handle/);
  assert.match(referenceApp, /setPointerCapture/);
  assert.match(referenceApp, /setPipPosition\(el, event\.clientX - offsetX, event\.clientY - offsetY\)/);
  assert.match(referenceApp, /window\.innerWidth - rect\.width/);
  assert.match(referenceApp, /sessionStorage\.setItem\("iln:pip-position"/);
  assert.match(componentsCss, /touch-action:none/);
  assert.match(componentsCss, /\.pip-window\.is-dragging \.pip-head\{cursor:grabbing/);
});

test("Search memiliki retry HTTP-aware dan indikator loading retry", () => {
  assert.match(apiSource, /function retryableStatus\(status\)/);
  assert.match(apiSource, /requestWithRetry\(/);
  assert.match(apiSource, /iln:catalog-retry/);
  assert.match(referenceApp, /Retrying search/);
});

test("countdown dinonaktifkan agar tidak membuat timer atau refresh berulang", () => {
  assert.doesNotMatch(indexHtml, /data-support="countdown"/);
  assert.doesNotMatch(referenceApp, /COUNTDOWN_TARGETS|getCountdownParts|openCountdown|setInterval/);
});
