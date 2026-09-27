const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let view;
const componentsCss = fs.readFileSync(path.join(__dirname, "../public/css/components.css"), "utf8");
const referenceApp = fs.readFileSync(path.join(__dirname, "../public/js/reference-app.js"), "utf8");
const apiSource = fs.readFileSync(path.join(__dirname, "../public/js/api.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const screenTimeSource = fs.readFileSync(path.join(__dirname, "../public/js/screen-time.js"), "utf8");
const screenTimeCss = fs.readFileSync(path.join(__dirname, "../public/css/screen-time.css"), "utf8");
const serviceWorkerSource = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
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

test("pengingat screen-time accessible, lokal, dan tidak mengendalikan iframe/PiP", () => {
  assert.match(screenTimeSource, /role="dialog" aria-modal="true" aria-labelledby=/);
  assert.match(screenTimeSource, /if \(thresholdHours === 3 \|\| thresholdHours === 5 \|\| thresholdHours === 7 \|\| thresholdHours === 12\) showDialog\(thresholdHours, activeMs\)/);
  assert.match(screenTimeSource, /SCREEN_TIME_TEST_MODE = false/);
  assert.match(screenTimeSource, /testMode && state\.activeMs >= thresholds\[3\][\s\S]*?emitReminder\(12\)/);
  assert.match(screenTimeSource, /intervalMs = testMode \? 1_000 : SCHEDULER_MS/);
  assert.match(screenTimeSource, /const continueButton = button\("Lanjutkan", "dismiss", true\);\s*actions\.append\(button\("Tutup web", "close-website"\), continueButton\)/);
  assert.match(screenTimeSource, /windowRef\.close\(\)/);
  assert.match(screenTimeSource, /Browser tidak mengizinkan situs menutup tab ini/);
  assert.match(screenTimeSource, /eyebrow\.textContent = `\$\{formatActiveTime\(activeMs\)\} aktif hari ini`/);
  assert.match(screenTimeSource, /hours === 5 \? 3 \* 60 : 10 \* 60/);
  assert.match(screenTimeSource, /let remaining = 5/);
  assert.match(screenTimeSource, /if \(hours === 12\) \{\s*actions\.append\(button\("Tutup web", "close-website", true\)\);\s*startFinalCountdown\(\);/);
  assert.doesNotMatch(screenTimeSource.match(/else if \(hours === 12\) \{([\s\S]*?)\n    \}/)?.[1] || "", /Lanjutkan/);
  assert.match(screenTimeSource, /NotificationApi\.requestPermission\(\)/);
  assert.match(screenTimeSource, /get some sleep, Love you 💖/);
  assert.match(screenTimeSource, /registration\.showNotification\("iLoveNime", options\)/);
  assert.match(referenceApp, /serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(serviceWorkerSource, /event\.notification\.close\(\)/);
  assert.ok(fs.existsSync(path.join(__dirname, "../public/assets/screen-time/12hours.jpg")));
  assert.match(screenTimeCss, /\.screen-time-overlay\{position:fixed;inset:0;z-index:590;display:grid;place-items:center/);
  assert.match(screenTimeSource, /querySelectorAll\("button:not\(\[disabled\]\)/);
  assert.match(screenTimeSource, /event\.stopPropagation\(\)/);
  assert.match(referenceApp, /createScreenTimeTracker/);
  assert.match(screenTimeSource, /localStorage/);
  assert.doesNotMatch(screenTimeSource, /iframe\.src|closePipWindow|playerBox/);
  assert.match(indexHtml, /id="performanceMode"/);
});
