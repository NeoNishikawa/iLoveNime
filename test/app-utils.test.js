const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let utils;
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/app-utils.js"), "utf8");
  utils = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

/* ---------- Paging 6×3 / 3×3 ---------- */
test("pageSize: 18 di desktop (6x3) dan 9 di mobile (3x3)", () => {
  assert.equal(utils.pageSizeFor(false), 18);
  assert.equal(utils.pageSizeFor(true), 9);
});

test("pageSlice membagi halaman dengan benar dan aman terhadap page di luar jangkauan", () => {
  const items = Array.from({ length: 43 }, (_, i) => i);
  assert.equal(utils.pageSlice(items, 0, 18).length, 18);
  assert.equal(utils.pageSlice(items, 2, 18).length, 7);
  assert.deepEqual(utils.pageSlice(items, 99, 18), [36, 37, 38, 39, 40, 41, 42]); /* di-clamp ke halaman terakhir */
  assert.equal(utils.pageCountFor(43, 18), 3);
  assert.equal(utils.pageCountFor(18, 18), 1);
  assert.equal(utils.pageCountFor(0, 18), 1);
});

/* ---------- Tamat / isComplete ---------- */
test("isComplete: status completed terhitung meski total tidak diketahui", () => {
  assert.equal(utils.isItemComplete({ status: "completed", total: 0, progress: 3 }), true);
  assert.equal(utils.isItemComplete({ total: 12, progress: 12 }), true);
  assert.equal(utils.isItemComplete({ total: 12, progress: 11 }), false);
  assert.equal(utils.isItemComplete({ total: 0, progress: 0, status: "watching" }), false);
  assert.equal(utils.isItemComplete({ total: 10, watchedEpisodes: [1, 2, 3] }), false);
});

/* ---------- Avatar guard ---------- */
test("avatar hanya menerima PNG, WebP, dan GIF", () => {
  assert.equal(utils.isAllowedAvatarFile({ type: "image/png", name: "a.png" }), true);
  assert.equal(utils.isAllowedAvatarFile({ type: "image/webp", name: "a.webp" }), true);
  assert.equal(utils.isAllowedAvatarFile({ type: "image/gif", name: "a.gif" }), true);
  assert.equal(utils.isAllowedAvatarFile({ type: "image/jpeg", name: "foto.jpg" }), false);
  assert.equal(utils.isAllowedAvatarFile({ type: "image/jpeg", name: "foto.jpeg" }), false);
  assert.equal(utils.isAllowedAvatarFile({ type: "video/mp4", name: "klip.mp4" }), false);
  assert.equal(utils.isAllowedAvatarFile({ type: "", name: "tanpa-ekstensi" }), false);
  assert.equal(utils.isAllowedAvatarFile(null), false);
  /* Ekstensi benar tapi MIME aneh tetap diterima (beberapa OS salah set MIME) */
  assert.equal(utils.isAllowedAvatarFile({ type: "", name: "avatar.GIF" }), true);
});

/* ---------- Export / Import v2 ---------- */
test("export v2 menyertakan profil dan items", () => {
  const payload = utils.buildExportPayload(
    [{ slug: "demo", title: "Demo", total: 12, progress: 4 }],
    { username: "Tiann", handle: "Local profile", avatarUrl: "data:image/gif;base64,R0=", theme: "dark", sidebarCollapsed: true }
  );
  assert.equal(payload.format, "ilovenime-tracking");
  assert.equal(payload.version, 2);
  assert.equal(payload.profile.username, "Tiann");
  assert.equal(payload.profile.sidebarCollapsed, true);
  assert.equal(payload.items[0].slug, "demo");
});

test("import: profil v2 dipulihkan, v1 tidak mengubah apa pun, URL asing ditolak", () => {
  const prefs = { username: "Lama", avatarUrl: "", theme: "dark" };
  const merged = utils.mergeImportedProfile({ profile: { username: "Baru", avatarUrl: "data:image/png;base64,AA==", theme: "light", sidebarCollapsed: false } }, prefs);
  assert.equal(merged.username, "Baru");
  assert.equal(merged.avatarUrl, "data:image/png;base64,AA==");
  assert.equal(merged.theme, "light");
  /* v1 tanpa profile: prefs utuh */
  const untouched = utils.mergeImportedProfile({ items: [] }, prefs);
  assert.equal(untouched.username, "Lama");
  /* avatarUrl berbahaya (bukan data:image) ditolak */
  const safe = utils.mergeImportedProfile({ profile: { avatarUrl: "https://evil.example/x.png", username: "Hacked" } }, prefs);
  assert.equal(safe.avatarUrl, "");
  assert.equal(safe.username, "Hacked"); /* nama tetap boleh, URL tidak */
});

/* ---------- Countdown maintenance & domain ---------- */
test("countdown menghitung sisa hari dan waktu secara konsisten", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  assert.deepEqual(utils.getCountdownParts("2026-10-19T00:00:00Z", now), {
    totalMs: 22 * 24 * 60 * 60 * 1000,
    days: 22,
    hours: 0,
    minutes: 0,
    seconds: 0,
    expired: false,
  });
});

test("countdown yang sudah lewat dikunci ke nol dan ditandai expired", () => {
  const parts = utils.getCountdownParts("2026-09-26T00:00:00Z", new Date("2026-09-27T00:00:00Z"));
  assert.equal(parts.totalMs, 0);
  assert.equal(parts.expired, true);
  assert.deepEqual([parts.days, parts.hours, parts.minutes, parts.seconds], [0, 0, 0, 0]);
});

test("target reset 29 dan 28 hari dapat dibuat dari waktu sekarang", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  assert.equal(utils.addDaysToIso(now, 29), "2026-10-26T00:00:00.000Z");
  assert.equal(utils.addDaysToIso(now, 28), "2026-10-25T00:00:00.000Z");
});
