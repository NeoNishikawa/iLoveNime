import { api } from "./api.js";
import { attach, closeActive } from "./dropdown.js";
import { pageSizeFor, pageCountFor, pageSlice, isItemComplete, isAllowedAvatarFile, buildExportPayload, mergeImportedProfile } from "./app-utils.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const TRACKING_KEY = "iln_tracking";
const PREFS_KEY = "ilovenime.reference.prefs";
const esc = (v = "") => String(v).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* XP naik dua kali lipat per level: 10, 20, 40, 80, … */
function xpForLevel(level) { return 10 * Math.pow(2, level - 1); }
function levelFromWatched(watched) { let level = 1; let remaining = Math.max(0, Math.floor(watched)); while (remaining >= xpForLevel(level)) { remaining -= xpForLevel(level); level += 1; } return { level, intoLevel: remaining, need: xpForLevel(level) }; }
const isMobileViewport = () => window.matchMedia("(max-width: 1023px)").matches;
const statusText = (v) => ({ planned: "Plan to Watch", watching: "Watching", completed: "Complete", dropped: "Dislike" }[v] || v || "All");
const mobileQuery = window.matchMedia("(max-width: 1023px)");
let prefs = (() => { try { return { theme: "dark", sidebarCollapsed: false, username: "Anime watcher", handle: "Local profile", avatarUrl: "", ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return { theme: "dark", sidebarCollapsed: false, username: "Anime watcher", handle: "Local profile", avatarUrl: "" }; } })();
const state = { daily: [], genres: [], searchResults: [], storageItems: [], mainGenres: new Set(), storageGenres: new Set(), mainCharacters: new Set(), storageCharacters: new Set(), activeGenres: new Set(), currentTab: "All", localQuery: "", searchQuery: "", searchLoading: false, storageFilterLoading: false, detail: null, episodeIndex: -1, mirrors: [], mirrorIndex: 0, selectedStorageItems: new Set(), editMode: false, searchToken: 0, searchPage: 0, storagePage: 0, filteredSearchCount: 0, filteredStorageCount: 0 };

/* ---------- Drawer mobile ---------- */
const sidebar = $("#sidebar");
const drawerOverlay = document.createElement("div");
drawerOverlay.className = "drawer-overlay";
drawerOverlay.hidden = true;
document.body.appendChild(drawerOverlay);

function setDrawer(open) {
  const isMobileNow = mobileQuery.matches;
  if (!isMobileNow) return;
  sidebar.classList.toggle("is-mobile-open", open);
  document.getElementById("app").classList.toggle("drawer-open", open);
  drawerOverlay.hidden = !open;
  $("#hamburgerBtn").setAttribute("aria-expanded", String(open));
  if (!open) drawerOverlay.hidden = true;
}
$("#hamburgerBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  setDrawer(!sidebar.classList.contains("is-mobile-open"));
});
drawerOverlay.addEventListener("click", () => setDrawer(false));
mobileQuery.addEventListener("change", () => { if (!mobileQuery.matches) setDrawer(false); /* page size berubah (6×3 ↔ 3×3): render ulang grid */ renderStorage(); renderSearch(); });

/* ---------- Reveal / stagger animasi kartu ---------- */
function staggerIn(container) {
  if (!container) return;
  const items = [...container.children];
  if (!items.length) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  items.forEach((item, index) => {
    item.classList.remove("card-enter");
    if (reduced) return;
    void item.offsetWidth;
    item.style.setProperty("--enter-delay", `${Math.min(index, 14) * 35}ms`);
    item.classList.add("card-enter");
  });
}

/* ---------- Scroll fade in/out (IntersectionObserver) ----------
   Kartu muncul (fade+slide) saat masuk viewport dan memudar kembali saat
   keluar — hanya animasi opacity/transform, tanpa layout thrashing. */
let scrollObserver = null;
function setupScrollReveal() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollObserver?.disconnect();
  if (reduced || !("IntersectionObserver" in window)) return;
  scrollObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle("scroll-hidden", !entry.isIntersecting);
  }, { root: $("#mainScroll"), rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
}
function observeScrollReveal(container) {
  if (!container || !scrollObserver) return;
  const items = [...container.querySelectorAll(".anime-card")];
  items.forEach((item) => { item.classList.add("scroll-reveal"); scrollObserver.observe(item); });
}

/* ---------- Pager grid: slide 6×3 (desktop) / 3×3 (mobile) ---------- */
function pageSize() { return pageSizeFor(isMobileViewport()); }
function pagerHTML(page, pageCount, idPrefix) {
  return `<div class="grid-pager" role="navigation" aria-label="Navigasi halaman">
    <button class="pager-btn" data-pager-prev="${idPrefix}" ${page <= 0 ? "disabled" : ""} aria-label="Halaman sebelumnya"><svg class="ico"><use href="#i-chev-left"/></svg></button>
    <span class="pager-info">Halaman <b>${page + 1}</b> / ${pageCount}</span>
    <button class="pager-btn" data-pager-next="${idPrefix}" ${page >= pageCount - 1 ? "disabled" : ""} aria-label="Halaman berikutnya"><svg class="ico"><use href="#i-chev-right"/></svg></button>
  </div>`;
}
function setGridPage(which, delta) {
  if (which === "search") { state.searchPage = Math.max(0, state.searchPage + delta); renderSearch(); }
  else { state.storagePage = Math.max(0, state.storagePage + delta); renderStorage(); }
}
function bindPager(root) {
  if (!root) return;
  const prev = $("[data-pager-prev]", root), next = $("[data-pager-next]", root);
  prev?.addEventListener("click", () => setGridPage(prev.dataset.pagerPrev, -1));
  next?.addEventListener("click", () => setGridPage(next.dataset.pagerNext, 1));
}
function scrollToGrid(grid) { grid?.closest("section")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }

/* ---------- Data helpers ---------- */
function normalizeStored(raw = {}) { const watchedEpisodes = Array.isArray(raw.watchedEpisodes) ? [...new Set(raw.watchedEpisodes.map(Number).filter(Number.isFinite))].sort((a, b) => a - b) : []; const progress = Math.max(Number(raw.progress || 0), watchedEpisodes.at(-1) || 0); const status = raw.status || (raw.dislike ? "dropped" : raw.planToWatch || !progress ? "planned" : raw.total && progress >= raw.total ? "completed" : "watching"); return { ...raw, characters: Array.isArray(raw.characters) ? raw.characters.map((c) => typeof c === "string" ? c : c.name).filter(Boolean) : [], slug: String(raw.slug || raw.animeId || ""), animeId: String(raw.animeId || raw.slug || ""), title: String(raw.title || "Unknown title"), image: raw.image || raw.posterUrl || "", posterUrl: raw.posterUrl || raw.image || "", total: Number(raw.total || raw.totalEpisodes || 0), totalEpisodes: Number(raw.totalEpisodes || raw.total || 0), progress, watchedEpisodes, status, genres: Array.isArray(raw.genres) ? raw.genres.map((g) => typeof g === "string" ? g : g.name).filter(Boolean) : [] }; }
function readTracking() { try { const parsed = JSON.parse(localStorage.getItem(TRACKING_KEY) || "[]"); return Array.isArray(parsed) ? parsed.map(normalizeStored).filter((x) => x.slug) : []; } catch { return []; } }
state.storageItems = readTracking();
function saveState() { localStorage.setItem(TRACKING_KEY, JSON.stringify(state.storageItems.map(normalizeStored))); localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
function normAnime(a = {}) { const title = a.title || "Untitled"; const total = Number(a.totalEpisodes || a.total || a.episodes?.length || String(a.episode || "").match(/\d+/)?.[0] || 0); return { ...a, id: String(a.id || a.slug || ""), slug: String(a.slug || a.id || ""), title, posterUrl: a.posterUrl || a.image || "", image: a.image || a.posterUrl || "", totalEpisodes: total, total, rating: Number(a.rating || 0), genres: (a.genres || []).map((g) => typeof g === "string" ? g : g.name).filter(Boolean) }; }
function allKnown() { return state.daily.concat(state.searchResults, state.storageItems); }
function findAnime(id) { return allKnown().map(normAnime).find((a) => a.id === id || a.slug === id) || state.storageItems.find((i) => i.slug === id); }
function getStored(id) { return state.storageItems.find((i) => i.slug === id || i.animeId === id); }
function totalWatched() { return state.storageItems.reduce((sum, item) => sum + Number(item.progress || item.watchedEpisodes?.at(-1) || 0), 0); }
function isComplete(item) { return isItemComplete(item); }
function imageHTML(anime) { return anime.posterUrl ? `<img src="${esc(anime.posterUrl)}" alt="${esc(anime.title)}" loading="lazy" onerror="this.style.display='none'">` : `<span class="art-placeholder">ANIME IMAGE</span>`; }
let thoughtNode = null;
let thoughtTimer = null;
function thoughtStart(kind) {
  thoughtNode?.remove();
  const inline = kind === "search";
  thoughtNode = document.createElement("div");
  thoughtNode.className = inline ? "thought-inline" : "thought-overlay";
  thoughtNode.innerHTML = `<div class="thought-card" role="status" aria-live="polite"><div class="thought-orb"><i></i><i></i><i></i><b></b></div><div class="thought-copy"><strong data-thought-label>Reading ${kind}</strong><span data-thought-step>Preparing…</span><div class="thought-progress"><i data-thought-progress></i></div><small><span data-thought-percent>0</span>%</small></div></div>`;
  if (inline) {
    const head = $("#searchSection .sec-head");
    const actions = $(".sec-actions", head);
    head?.insertBefore(thoughtNode, actions || null);
  } else {
    document.body.appendChild(thoughtNode);
  }
  thoughtStage(inline ? "Reading search" : "Reading file", 8);
}
function thoughtStage(label, percent) {
  if (!thoughtNode) return;
  $("[data-thought-label]", thoughtNode).textContent = label;
  $("[data-thought-step]", thoughtNode).textContent = label === "Done" ? "Complete" : label === "Searching" ? "Looking through the catalog…" : label === "Importing" ? "Restoring your collection…" : "Checking the selected input…";
  $("[data-thought-progress]", thoughtNode).style.width = `${percent}%`;
  $("[data-thought-percent]", thoughtNode).textContent = Math.round(percent);
}
function thoughtDone() {
  thoughtStage("Done", 100);
  clearTimeout(thoughtTimer);
  thoughtTimer = setTimeout(() => { thoughtNode?.classList.add("thought-leave"); setTimeout(() => { thoughtNode?.remove(); thoughtNode = null; }, 260); }, 220);
}
function thoughtProgress(from, to, duration = 600) {
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = (now) => { const p = Math.min(1, (now - started) / duration); const eased = p * (2 - p); thoughtStage($("[data-thought-label]", thoughtNode)?.textContent || "Importing", from + (to - from) * eased); if (p < 1) requestAnimationFrame(tick); else resolve(); };
    requestAnimationFrame(tick);
  });
}
function toast(title, message = "", duration = 3600) { const el = document.createElement("div"); el.className = "toast"; el.innerHTML = `<div class="t-ico"><svg class="ico"><use href="#i-bolt"/></svg></div><div class="t-body"><div class="t-title">${esc(title)}</div><div class="t-msg">${esc(message)}</div></div><button class="t-close" aria-label="Tutup"><svg class="ico"><use href="#i-close"/></svg></button><div class="toast-progress running" style="animation-duration:${duration}ms"></div>`; const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 240); }; $(".t-close", el).onclick = close; $("#toastStack").appendChild(el); if (duration > 0) setTimeout(close, duration); }
function applyProfile() { const name = prefs.username || "Anime watcher"; const initial = name.trim().slice(0, 1).toUpperCase() || "A"; const { level, intoLevel, need } = levelFromWatched(totalWatched()); $$("#pcName,#sbName").forEach((el) => el.textContent = name); $("#pcHandle").textContent = prefs.handle; $("#pcTitle").textContent = level >= 5 ? "Anime Scholar" : level >= 3 ? "Otaku Enthusiast" : "Watcher Novice"; $("#sbLevel").textContent = `Level ${level}`; $("#pcLevelText").textContent = `Level ${level}`; $("#pcXpText").textContent = `${intoLevel} / ${need} XP`;  $("#pcXpBar").style.width = `${Math.min(100, (intoLevel / need) * 100)}%`;
  const levelTitle = level >= 5 ? "Anime Scholar" : level >= 3 ? "Otaku Enthusiast" : "Watcher Novice";
  $("#ppLevelTitle").textContent = `Level ${level} — ${levelTitle}`;
  $("#ppLevelBadge").textContent = `Lv ${level}`;
  $("#ppXpBar").style.width = `${Math.min(100, (intoLevel / need) * 100)}%`;
  $("#ppXpTextLeft").textContent = `${intoLevel} XP`;
  $("#ppXpTextRight").textContent = `${intoLevel} / ${need}`;  $("#pcStorage").innerHTML = `${state.storageItems.length} <small>Titles</small>`;
  $("#pcEpisodes").innerHTML = `${totalWatched()} <small>Episodes</small>`;
  /* Stat popup profil: sinkron dengan data nyata (dulu selalu 0) */
  const ppEps = $("#ppTotalEps"), ppTitles = $("#ppTotalTitles"), ppDone = $("#ppCompleted");
  if (ppEps) ppEps.textContent = totalWatched();
  if (ppTitles) ppTitles.textContent = state.storageItems.length;
  if (ppDone) ppDone.textContent = state.storageItems.filter(isComplete).length;
  $("#navStorageCount").textContent = state.storageItems.length; [$("#pcAvatar"), $("#sbAvatar"), $("#ppAvatar")].forEach((el) => { if (!el) return; el.classList.toggle("level-border", level >= 5); el.classList.toggle("level-water", level >= 10); el.innerHTML = prefs.avatarUrl ? `<img class="avatar-img" src="${esc(prefs.avatarUrl)}" alt="${esc(name)}">` : `<span class="avatar-initial">${esc(initial)}</span>`; }); }

function cardHTML(anime, options = {}) { const a = normAnime(anime); const item = options.storageItem || getStored(a.slug); const watched = Number(item?.progress || item?.watchedEpisodes?.at(-1) || 0); const total = Number(a.totalEpisodes || item?.total || 0); const pct = total ? Math.min(100, Math.round(watched / total * 100)) : 0; const selected = options.selected ? " selected" : ""; const inStorage = Boolean(item || options.inStorage); const actionButtons = options.removeMode ? `<button class="btn btn-sm btn-remove" data-act="remove" data-id="${esc(a.slug)}" aria-label="Remove" title="Klik untuk hapus, tahan untuk hapus langsung"><span class="hold-fill"></span><svg class="ico"><use href="#i-trash"/></svg><span class="btn-label">Remove</span></button>` : `${inStorage ? `<button class="btn btn-sm" data-act="detail" data-id="${esc(a.slug)}" aria-label="Lihat detail" title="Lihat detail"><svg class="ico"><use href="#i-eye"/></svg><span class="btn-label">See Detail</span></button>` : `<button class="btn btn-sm btn-primary btn-icon-only" data-act="add" data-id="${esc(a.slug)}" aria-label="Tambah ke storage" title="Tambah ke Local Storage"><svg class="ico"><use href="#i-plus"/></svg></button><button class="btn btn-sm btn-icon-only" data-act="detail" data-id="${esc(a.slug)}" aria-label="Lihat detail" title="Lihat detail"><svg class="ico"><use href="#i-eye"/></svg></button>`}`; return `<article class="anime-card${selected}" data-id="${esc(a.slug)}"><div class="thumb">${options.rank ? `<span class="rank-badge${options.rank <= 2 ? " top" : ""}">#${options.rank}</span>` : ""}${options.epsBadge ? `<span class="eps-badge">${esc(options.epsBadge)}</span>` : ""}${item?.favorite ? `<span class="fav-mark"><svg class="ico"><use href="#i-star"/></svg></span>` : ""}${options.checkbox ? `<button class="check-wrap${options.selected ? " on" : ""}" data-act="check" data-id="${esc(a.slug)}" aria-label="Pilih ${esc(a.title)}">${options.selected ? "✓" : ""}</button>` : ""}${imageHTML(a)}</div><div class="card-body"><h3 class="card-title" title="${esc(a.title)}">${esc(a.title)}</h3><div class="card-meta"><span class="star"><svg class="ico"><use href="#i-star"/></svg>${a.rating ? a.rating.toFixed(1) : "—"}</span><span class="dot"></span><span>${total || "?"} Eps</span>${isComplete({ ...a, progress: watched }) ? `<span class="dot"></span><span style="color:var(--gold)">Complete</span>` : ""}</div>${options.showProgress ? `<div class="progress-row"><div class="progress-top"><span>Ep <b>${watched}</b> / ${total || "?"}</span><span>${pct}%</span></div><div class="bar thin"><i style="width:${pct}%"></i></div></div>` : ""}<div class="card-actions">${actionButtons}</div></div></article>`; }
function empty(title, message) { return `<div class="empty-mini"><strong>${esc(title)}</strong>${esc(message)}</div>`; }
function typeMatches(item, wanted) { if (!wanted) return true; const type = String(item.type || item.format || "").toLowerCase(); if (wanted === "Serial TV") return ["tv", "series", "serial tv", "ona"].some((v) => type.includes(v)); return type === wanted.toLowerCase(); }
function statusMatches(item, wanted) { if (!wanted || wanted === "Rating" || wanted === "Terpopuler") return true; const status = String(item.airingStatus || item.status || "").toLowerCase(); if (wanted === "Selesai Tayang") return /complete|completed|finished|selesai/.test(status); if (wanted === "Sedang Tayang") return /ongoing|airing|sedang|new today/.test(status); if (wanted === "Segera Tayang") return /upcoming|segera|not yet/.test(status); return status === wanted.toLowerCase(); }
function sortItems(items, key) { return [...items].sort((a,b) => key === "az" ? a.title.localeCompare(b.title) : key === "za" ? b.title.localeCompare(a.title) : key === "rating" ? Number(b.rating||0)-Number(a.rating||0) : key === "newest" || key === "updated" ? String(b.updatedAt || b.updateAt || b.aired || "").localeCompare(String(a.updatedAt || a.updateAt || a.aired || "")) : key === "oldest" ? String(a.updatedAt || a.updateAt || a.aired || "").localeCompare(String(b.updatedAt || b.updateAt || b.aired || "")) : key === "popular" ? Number(b.views||b.popularity||0)-Number(a.views||a.popularity||0) : 0); }
async function hydrateStorageMetadata() { const targets = state.storageItems.filter((item) => (!item.genres?.length || !item.characters?.length || !Number(item.rating)) && item.slug); await Promise.allSettled(targets.map(async (item) => { const response = await api.detail(item.slug); const data = response.data || {}; item.genres = (data.genres || item.genres || []).map((g) => typeof g === "string" ? g : g.name).filter(Boolean); item.characters = (data.characters || item.characters || []).map((c) => typeof c === "string" ? c : c.name).filter(Boolean); item.type = data.type || item.type; item.airingStatus = data.status || item.airingStatus || ""; item.rating = Number(data.rating || item.rating || 0); })); saveState(); }
async function refreshStorageFilters() { state.storageFilterLoading = true; renderStorage(); await hydrateStorageMetadata(); state.storageFilterLoading = false; renderStorage(); }
function renderStorage() { const q = state.localQuery.toLowerCase(); let items = state.storageItems.filter((item) => { if (state.currentTab === "Complete" && !isComplete(item)) return false; if (state.currentTab === "Plan to Watch" && item.progress) return false; if (state.currentTab === "Dislike" && !item.dislike && item.status !== "dropped") return false; if (state.currentTab === "Favorite" && !item.favorite) return false; if (!typeMatches(item, state.storageType)) return false; if (!statusMatches(item, state.storageStatus)) return false; if (!tagMatch(item, state.storageGenres, "genres")) return false; if (!tagMatch(item, state.storageCharacters, "characters")) return false; return !q || `${item.title} ${item.genres.join(" ")}`.toLowerCase().includes(q); }); if (state.storageStatus === "Rating") items = sortItems(items, "rating"); else if (state.storageStatus === "Terpopuler") items = sortItems(items, "popular"); else items = sortItems(items, state.storageSort); const counts = { All: state.storageItems.length, Complete: state.storageItems.filter(isComplete).length, "Plan to Watch": state.storageItems.filter((i) => !i.progress).length, Dislike: state.storageItems.filter((i) => i.dislike || i.status === "dropped").length, Favorite: state.storageItems.filter((i) => i.favorite).length }; $$("#storageTabs .count").forEach((el) => el.textContent = counts[el.dataset.count] || 0); $$("#storageTabs .tab").forEach((el) => el.classList.toggle("active", el.dataset.tab === state.currentTab)); $("#editBar").hidden = !state.editMode; $("#editCount").textContent = `${state.selectedStorageItems.size} dipilih`;
  /* Slide 6×3 (desktop) / 3×3 (mobile): pager muncul hanya jika > 1 halaman */
  const size = pageSize(); const pageCount = pageCountFor(items.length, size);
  state.storagePage = Math.min(state.storagePage, pageCount - 1); state.filteredStorageCount = items.length;
  const paged = pageSlice(items, state.storagePage, size);
  const gridEl = $("#storageGrid");
  gridEl.innerHTML = state.storageFilterLoading ? `<div class="search-skeleton-grid">${[1,2].map(() => `<div class="skeleton-card"></div>`).join("")}</div>` : (paged.length ? paged.map((item) => cardHTML(item, { storageItem: item, showProgress: true, removeMode: state.editMode, checkbox: state.editMode, selected: state.selectedStorageItems.has(item.slug) })).join("") : empty(state.storageItems.length ? "Tidak ada anime yang ditemukan." : "Belum ada anime di Local Storage.", state.storageItems.length ? "Coba ubah kata kunci, genre, atau kategori." : "Tambahkan anime dari tombol +Storage pada card."));
  const pagerSlot = $("#storagePager"); if (pagerSlot) pagerSlot.innerHTML = pageCount > 1 ? pagerHTML(state.storagePage, pageCount, "storage") : "";
  staggerIn(gridEl); observeScrollReveal(gridEl); bindPager(pagerSlot); bindActions(); }
function renderProfile() { applyProfile(); }
function renderAll() { renderProfile(); renderUpdates(); renderStorage(); renderSearch(); bindActions(); }
function renderUpdates() { $("#updateSub").textContent = `New Update — ${state.daily.length} Title`; $("#updateGrid").innerHTML = state.daily.length ? state.daily.map((a) => cardHTML(a, { epsBadge: "New Update" })).join("") : empty("Belum ada update.", "Coba lagi nanti."); staggerIn($("#updateGrid")); bindActions(); }
function renderSearch() { const active = state.searchQuery || state.mainGenres.size || state.mainCharacters.size; const section = $("#searchSection"); if (!active) { hideSection(section); return; } showSection(section); let items = state.searchResults.filter((a) => typeMatches(a, state.mainType) && statusMatches(a, state.mainStatus) && tagMatch(a, state.mainCharacters, "characters")); if (state.mainStatus === "Rating") items = sortItems(items, "rating"); else if (state.mainStatus === "Terpopuler") items = sortItems(items, "popular"); $("#searchSub").textContent = state.searchLoading ? "Mencari…" : `${items.length} hasil`;
  /* Slide 6×3 (desktop) / 3×3 (mobile): pager muncul hanya jika > 1 halaman */
  const size = pageSize(); const pageCount = pageCountFor(items.length, size);
  state.searchPage = Math.min(state.searchPage, pageCount - 1); state.filteredSearchCount = items.length;
  const paged = pageSlice(items, state.searchPage, size);
  const gridEl = $("#searchGrid");
  gridEl.innerHTML = state.searchLoading ? `<div class="search-skeleton-grid">${[1,2,3].map(() => `<div class="skeleton-card"></div>`).join("")}</div>` : (paged.length ? paged.map((a) => cardHTML(a, { showProgress: true, inStorage: Boolean(getStored(a.slug)) })).join("") : empty("Tidak ada anime yang ditemukan.", "Coba ubah kata kunci atau filter."));
  const pagerSlot = $("#searchPager"); if (pagerSlot) pagerSlot.innerHTML = pageCount > 1 ? pagerHTML(state.searchPage, pageCount, "search") : "";
  staggerIn(gridEl); observeScrollReveal(gridEl); bindPager(pagerSlot); bindActions(); }

/* Animasi buka/tutup section search */
function showSection(section) {
  if (!section.hidden) return;
  section.hidden = false;
  section.classList.add("section-in");
  section.addEventListener("animationend", () => section.classList.remove("section-in"), { once: true });
  window.setTimeout(() => section.classList.remove("section-in"), 450);
}
function hideSection(section) {
  if (section.hidden) return;
  section.classList.add("section-out");
  const finish = () => { section.hidden = true; section.classList.remove("section-out"); };
  section.addEventListener("animationend", finish, { once: true });
  window.setTimeout(finish, 300);
}

async function search(query = state.searchQuery) { state.searchQuery = query.trim(); $("#searchClear").hidden = !state.searchQuery; state.searchLoading = true; state.searchResults = []; state.searchPage = 0; renderSearch(); thoughtStart("search"); const token = ++state.searchToken; try { const selectedGenres = [...state.mainGenres]; const results = []; if (selectedGenres.length) { for (const genre of selectedGenres) { const part = await api.catalog(state.searchQuery, genre); results.push(...(part.data || [])); } } else { const result = await api.catalog(state.searchQuery, ""); results.push(...(result.data || [])); } if (token !== state.searchToken) return; state.searchResults = [...new Map(results.map((item) => [item.slug || item.id || item.title, item])).values()].map(normAnime); state.searchLoading = false; renderSearch(); thoughtDone(); } catch (error) { if (token !== state.searchToken) return; state.searchResults = []; state.searchLoading = false; $("#searchSub").textContent = error.message; renderSearch(); thoughtDone(); } }
function addStorage(id) { const a = normAnime(findAnime(id)); if (!a || getStored(a.slug)) return; state.storageItems.unshift(normalizeStored({ slug: a.slug, title: a.title, image: a.image, total: a.total, status: "planned", progress: 0, watchedEpisodes: [], genres: a.genres })); saveState(); renderAll(); toast("Ditambahkan ke Local Storage", a.title); }
function removeStorage(id) { const removed = state.storageItems.find((i) => i.slug === id); state.storageItems = state.storageItems.filter((i) => i.slug !== id); state.selectedStorageItems.delete(id); saveState(); renderAll(); toast("Berhasil dihapus", `${removed?.title || "Anime"} dihapus dari Local Storage.`); }
function openConfirm(title, message, onConfirm) { const root = $("#confirmRoot"); const overlay = document.createElement("div"); overlay.className = "overlay"; overlay.innerHTML = `<div class="confirm-modal destructive" role="dialog" aria-modal="true"><div class="confirm-alert"><svg class="ico"><use href="#i-alert"/></svg></div><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="confirm-actions"><button class="btn btn-danger" data-confirm>Hapus</button><button class="btn btn-ghost" data-cancel>Batal</button></div></div>`; root.appendChild(overlay); const close = () => { overlay.classList.add("is-closing"); $(".confirm-modal", overlay).classList.add("is-closing"); setTimeout(() => overlay.remove(), 220); }; $("[data-cancel]", overlay).onclick = close; $("[data-confirm]", overlay).onclick = () => { close(); setTimeout(() => playEraseSequence(onConfirm), 230); }; overlay.onclick = (e) => { if (e.target === overlay) close(); }; }
/* Alert popup sederhana (bukan window.alert) — gaya sama dengan confirm */
function openAlert(title, message) { const root = $("#confirmRoot"); const overlay = document.createElement("div"); overlay.className = "overlay"; overlay.innerHTML = `<div class="confirm-modal" role="alertdialog" aria-modal="true"><div class="confirm-alert warn"><svg class="ico"><use href="#i-alert"/></svg></div><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="confirm-actions"><button class="btn btn-primary" data-alert-close>Mengerti</button></div></div>`; root.appendChild(overlay); const close = () => { overlay.classList.add("is-closing"); setTimeout(() => overlay.remove(), 220); }; $("[data-alert-close]", overlay).onclick = close; overlay.onclick = (e) => { if (e.target === overlay) close(); }; }
/* Urutan hapus data: overlay sad.jpg + progress erase, lalu jalankan aksi */
function playEraseSequence(onDone) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { onDone(); return; }
  const wrap = document.createElement("div");
  wrap.className = "erase-overlay";
  wrap.innerHTML = `<div class="erase-card"><img class="erase-sad" src="/assets/sad.jpg" alt="Sedih kehilangan data"><div class="erase-title">Menghapus data…</div><div class="erase-sub">Koleksi dan progresmu sedang dihapus. Semoga bertemu lagi di lain pengaturan.</div><div class="erase-track"><i class="erase-fill"></i></div><div class="erase-pct">0%</div></div>`;
  document.body.appendChild(wrap);
  const fill = $(".erase-fill", wrap), pct = $(".erase-pct", wrap);
  const started = performance.now();
  const DURATION = 1800;
  const tick = (now) => {
    const p = Math.min(1, (now - started) / DURATION);
    fill.style.width = `${p * 100}%`;
    pct.textContent = `${Math.round(p * 100)}%`;
    if (p < 1) requestAnimationFrame(tick);
    else { $(".erase-card", wrap).classList.add("erase-done"); setTimeout(() => { wrap.remove(); onDone(); }, 650); }
  };
  requestAnimationFrame(tick);
}
function holdable(el, duration, onDone) { if (!el) return; let raf = 0; let start = 0; let holding = false; const stop = (done = false) => { holding = false; cancelAnimationFrame(raf); el.style.setProperty("--hold", done ? 1 : 0); if (done) onDone(); }; const tick = () => { if (!holding) return; const progress = Math.min(1, (performance.now() - start) / duration); el.style.setProperty("--hold", progress); if (progress >= 1) stop(true); else raf = requestAnimationFrame(tick); }; el.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.preventDefault(); holding = true; start = performance.now(); raf = requestAnimationFrame(tick); }); ["pointerup", "pointerleave", "pointercancel"].forEach((event) => el.addEventListener(event, () => stop(false))); }
function markWatched(number) { const a = state.detail; if (!a) return; const current = getStored(a.slug) || normalizeStored({ slug: a.slug, title: a.title, image: a.image, total: a.total, watchedEpisodes: [], progress: 0, status: "watching", genres: a.genres }); current.watchedEpisodes = [...new Set([...(current.watchedEpisodes || []), Number(number)])].sort((x, y) => x - y); current.progress = Math.max(current.progress, Number(number)); current.status = isComplete(current) ? "completed" : "watching"; state.storageItems = [...state.storageItems.filter((i) => i.slug !== current.slug), current]; saveState(); renderProfile(); renderStorage(); }
async function playEpisode(slug, number, button, shouldMark = true) { const episodes = state.detail?.episodes || []; const newIndex = episodes.findIndex((e) => e.slug === slug); const direction = newIndex > state.episodeIndex ? "right" : "left"; state.episodeIndex = newIndex; if (shouldMark) markWatched(number); renderDetail(); updateEpisodeNav(); $("#playerBox").innerHTML = `<div class="player-loading"><div class="spinner"></div></div>`; try { const response = await api.mirrors(slug); state.mirrors = response.data || []; if (!state.mirrors.length) throw new Error("Mirror tidak tersedia saat ini."); state.mirrorIndex = 0; loadMirror(0, direction); button?.classList.add("watched"); } catch (error) { state.mirrors = []; state.mirrorIndex = 0; $("#mirrorLabel").textContent = "Mirror tidak tersedia"; $("#playerBox").innerHTML = `<div class="player-ph"><div class="msg">${esc(error.message)}</div></div>`; } }
function loadMirror(index, direction = "right") { const mirror = state.mirrors[index]; if (!mirror) return; state.mirrorIndex = index; const box = $("#playerBox"); box.classList.add("mirror-fading"); setTimeout(() => { box.innerHTML = `<iframe src="${esc(mirror.url)}" title="Anime stream" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`; box.classList.remove("mirror-fading"); box.classList.add(`mirror-in-${direction === "left" ? "left" : "right"}`); box.addEventListener("animationend", () => box.classList.remove("mirror-in-right", "mirror-in-left"), { once: true }); showVideoControls(); }, 170); $("#mirrorLabel").textContent = mirror.name || `Mirror ${index + 1}`; $("#mirrorOptions").innerHTML = state.mirrors.map((m, i) => `<button data-mirror-index="${i}" class="${i === index ? "active" : ""}">${esc(m.name || `Mirror ${i + 1}`)}</button>`).join(""); closeActive(); $$("#mirrorOptions [data-mirror-index]").forEach((b) => b.onclick = (event) => { event.stopPropagation(); loadMirror(Number(b.dataset.mirrorIndex), Number(b.dataset.mirrorIndex) > index ? "right" : "left"); }); $("#mirrorNote").textContent = "Mirror aktif dari source streaming. Jika gagal, pilih mirror lain."; }
function renderDetail() { const a = state.detail; const item = getStored(a.slug); $("#watchTitle").textContent = a.title; $("#watchSub").textContent = `${a.type || "Series"} · ${a.status || "Unknown"}`; $("#playerBox").innerHTML = `<div class="player-ph"><div class="play-btn"><svg class="ico"><use href="#i-play"/></svg></div><div class="msg">Pilih episode untuk memulai.</div></div>`; $("#watchDetailGrid").innerHTML = `<div class="detail-item"><div class="k">Episodes</div><div class="v">${a.episodes?.length || a.total || "?"}</div></div><div class="detail-item"><div class="k">Rating</div><div class="v">${a.rating || "—"}</div></div><div class="detail-item"><div class="k">Studio</div><div class="v">${esc(a.studio || "—")}</div></div>`; $("#watchSynopsis").textContent = a.synopsis || "Sinopsis belum tersedia dari source."; $("#watchGenres").innerHTML = (a.genres || []).map((g) => `<span class="chip">${esc(g.name || g)}</span>`).join(""); $("#watchActions").innerHTML = `<button class="btn btn-primary" data-detail-add>${item ? "Saved locally" : "+Storage"}</button><button class="btn" data-detail-prev ${state.episodeIndex <= 0 ? "disabled" : ""}>← Previous</button><button class="btn" data-detail-next ${state.episodeIndex >= (a.episodes?.length || 1) - 1 ? "disabled" : ""}>Next →</button>`; $("#episodeList").innerHTML = (a.episodes || []).map((ep, index) => `<button class="ep-item ${item?.watchedEpisodes?.includes(Number(ep.number)) ? "watched" : ""}" data-episode-slug="${esc(ep.slug)}" data-episode-number="${esc(ep.number)}"><span class="st">${item?.watchedEpisodes?.includes(Number(ep.number)) ? "✓" : ""}</span><span>EP ${String(ep.number).padStart(2, "0")} · ${esc(ep.title || "Episode")}</span></button>`).join("") || empty("Episode belum tersedia.", "Source belum mengembalikan episode."); $("[data-detail-add]").onclick = () => addStorage(a.slug); $("[data-detail-prev]").onclick = () => navigateEpisode(-1); $("[data-detail-next]").onclick = () => navigateEpisode(1); $$('[data-episode-slug]').forEach((b) => b.onclick = () => playEpisode(b.dataset.episodeSlug, Number(b.dataset.episodeNumber), b)); }
function navigateEpisode(delta) { const episodes = state.detail?.episodes || []; const target = episodes[state.episodeIndex + delta]; if (!target) return; playEpisode(target.slug, Number(target.number), null); updateEpisodeNav(); }
function updateEpisodeNav() { $("[data-detail-prev]")?.toggleAttribute("disabled", state.episodeIndex <= 0); $("[data-detail-next]")?.toggleAttribute("disabled", state.episodeIndex >= (state.detail?.episodes?.length || 1) - 1); /* Sinkronkan tombol overlay video */ const prev = $("#prevEpBtn"), next = $("#nextEpBtn"); prev?.toggleAttribute("disabled", state.episodeIndex <= 0); next?.toggleAttribute("disabled", state.episodeIndex >= (state.detail?.episodes?.length || 1) - 1); }

/* ---------- In-video control overlay ----------
   Klik di area video memunculkan kontrol (mirror, prev/next, PiP);
   toolbar tetap tersedia, sementara area iframe tetap menerima klik video. */
const videoOverlay = $("#videoOverlay");
const playerStage = $("#playerStage");
let voHideTimer = 0;
function showVideoControls() {
  if (!videoOverlay || videoOverlay.closest("#watchOverlay")?.hidden) return;
  if (!state.mirrors.length) return;
  videoOverlay.hidden = false;
  videoOverlay.classList.add("show");
}
function hideVideoControls() { videoOverlay?.classList.remove("show"); clearTimeout(voHideTimer); }
/* Dengarkan klik dari stage, bukan dari lapisan di atas iframe. Dengan begitu
   klik pertama tetap diterima kontrol play milik mirror di dalam iframe. */
playerStage?.addEventListener("click", (event) => {
  if (event.target.closest("#videoOverlay")) return;
  showVideoControls();
});
playerStage?.addEventListener("pointerenter", showVideoControls);
playerStage?.addEventListener("pointermove", showVideoControls);
videoOverlay?.addEventListener("click", (event) => {
  /* Klik pada area kosong overlay (di luar bar) menyembunyikan kontrol */
  if (event.target === videoOverlay) { hideVideoControls(); return; }
  if (!event.target.closest(".vo-bar")) return;
  clearTimeout(voHideTimer);
  voHideTimer = window.setTimeout(hideVideoControls, 3000);
});
$("#prevEpBtn")?.addEventListener("click", () => { if (state.episodeIndex > 0) navigateEpisode(-1); });
$("#nextEpBtn")?.addEventListener("click", () => { const total = state.detail?.episodes?.length || 0; if (state.episodeIndex < total - 1) navigateEpisode(1); });

/* ---------- Mini popup player (Picture-in-Picture-like) ----------
   Untuk iframe cross-origin, gunakan floating PiP di dokumen yang sama.
   Memindahkan iframe ke Document PiP lintas window dapat membuat browser
   me-reparent/reload browsing context dan menimbulkan jeda atau reset waktu.
   Floating PiP memindahkan node iframe yang sama tanpa mengganti src. */
let pipPort = null;
const SEAMLESS_IFRAME_PIP = true;
async function openPipWindow() {
  const mirror = state.mirrors[state.mirrorIndex];
  if (!mirror || !state.detail) { toast("Belum ada video", "Pilih episode dulu sebelum membuka popup."); return; }
  const iframe = $("#playerBox iframe");
  if (!iframe) { toast("Belum ada video", "Player belum memuat stream."); return; }
  if (document.pictureInPictureElement) { try { await document.exitPictureInPicture(); } catch { } }
  if (!SEAMLESS_IFRAME_PIP && "documentPictureInPicture" in window && window.documentPictureInPicture.requestWindow) {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 480, height: 300 });
      const doc = win.document;
      doc.body.style.cssText = "margin:0;background:#000;font-family:system-ui;overflow:hidden";
      const style = doc.createElement("style");
      style.textContent = `.pipbar{position:fixed;top:0;left:0;right:0;height:40px;display:flex;align-items:center;gap:6px;padding:4px 6px;background:linear-gradient(rgba(0,0,0,.7),transparent);z-index:9;transition:opacity .2s;opacity:0}.pipbar:hover{opacity:1}.pipbar button{width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:#fff;display:grid;place-items:center;cursor:pointer;font-size:13px}.pipbar button:hover{border-color:#FFD700;color:#FFD700}.pipbar .t{flex:1;font-size:11px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pipwrap{position:fixed;inset:40px 0 0 0}.pipwrap iframe{width:100%;height:100%;border:0}`;
      doc.head.appendChild(style);
      const bar = doc.createElement("div"); bar.className = "pipbar";
      bar.innerHTML = `<span class="t">${esc(state.detail.title)} — EP ${state.episodeIndex + 1}</span><button data-p="prev" title="Episode sebelumnya">‹</button><button data-p="next" title="Episode berikutnya">›</button><button data-p="close" title="Tutup popup">✕</button>`;
      const wrapEl = doc.createElement("div"); wrapEl.className = "pipwrap";
      wrapEl.appendChild(iframe); /* pindahkan iframe: video tetap jalan */
      doc.body.append(bar, wrapEl);
      bar.addEventListener("click", async (event) => {
        const act = event.target.closest("button")?.dataset.p;
        if (act === "close") {
          $("#playerBox").appendChild(iframe); /* kembalikan iframe */
          win.close();
        } else if (act === "prev" || act === "next") {
          const delta = act === "prev" ? -1 : 1;
          const episodes = state.detail?.episodes || [];
          const target = episodes[state.episodeIndex + delta];
          if (target) {
            state.episodeIndex += delta;
            markWatched(Number(target.number));
            try { const response = await api.mirrors(target.slug); state.mirrors = response.data || []; state.mirrorIndex = 0; const m = state.mirrors[0]; if (m) { iframe.src = m.url; bar.querySelector(".t").textContent = `${state.detail.title} — EP ${state.episodeIndex + 1}`; $("#mirrorLabel").textContent = m.name || "Mirror 1"; } } catch { }
          }
        }
      });
      win.addEventListener("pagehide", () => { if (iframe.isConnected && !$("#playerBox").contains(iframe)) $("#playerBox").appendChild(iframe); });
      return;
    } catch { /* fall through ke fallback */ }
  }
  /* Fallback: window mengambang di dalam halaman */
  closePipWindow();
  const el = document.createElement("div");
  el.className = "pip-window always-bar";
  el.innerHTML = `<div class="pip-head"><span class="pip-title">${esc(state.detail.title)} — EP ${state.episodeIndex + 1}</span><button class="pip-btn" data-pip-prev title="Episode sebelumnya" aria-label="Episode sebelumnya"><svg class="ico"><use href="#i-prev"/></svg></button><button class="pip-btn" data-pip-next title="Episode berikutnya" aria-label="Episode berikutnya"><svg class="ico"><use href="#i-next"/></svg></button><button class="pip-btn" data-pip-close title="Tutup popup" aria-label="Tutup popup"><svg class="ico"><use href="#i-close"/></svg></button></div><div class="pip-body"></div>`;
  $(".pip-body", el).appendChild(iframe);
  document.body.appendChild(el);
  pipPort = el;
  el.addEventListener("click", (event) => {
    const act = event.target.closest("[data-pip-prev],[data-pip-next],[data-pip-close]")?.dataset;
    if (!act) return;
    if (act.pipClose !== undefined) closePipWindow();
    else if (act.pipPrev !== undefined) { const target = state.detail?.episodes?.[state.episodeIndex - 1]; if (target) { playEpisodeInPip(target); } }
    else if (act.pipNext !== undefined) { const target = state.detail?.episodes?.[state.episodeIndex + 1]; if (target) { playEpisodeInPip(target); } }
  });
}
async function playEpisodeInPip(target) {
  state.episodeIndex = state.detail.episodes.findIndex((e) => e.slug === target.slug);
  markWatched(Number(target.number));
  updateEpisodeNav(); renderDetail();
  try { const response = await api.mirrors(target.slug); state.mirrors = response.data || []; state.mirrorIndex = 0; const m = state.mirrors[0]; const iframe = pipPort?.querySelector("iframe"); if (m && iframe) { iframe.src = m.url; $("#mirrorLabel").textContent = m.name || "Mirror 1"; const t = pipPort?.querySelector(".pip-title"); if (t) t.textContent = `${state.detail.title} — EP ${state.episodeIndex + 1}`; } } catch { }
}
function closePipWindow() { if (!pipPort) return; const iframe = pipPort.querySelector("iframe"); if (iframe) $("#playerBox").appendChild(iframe); pipPort.classList.add("is-closing"); const el = pipPort; setTimeout(() => el.remove(), 220); pipPort = null; }
$("#pipBtn")?.addEventListener("click", () => openPipWindow());
async function openDetail(id) { const source = normAnime(findAnime(id) || { slug: id, id }); $("#watchOverlay").hidden = false; document.body.style.overflow = "hidden"; $("#watchTitle").textContent = source.title; $("#watchSub").textContent = ""; $("#playerBox").innerHTML = `<div class="player-loading"><div class="spinner"></div></div>`; try { const response = await api.detail(source.slug); state.detail = normAnime({ ...response.data, id: response.data.slug || source.slug }); state.detail.episodes = response.data.episodes || []; state.episodeIndex = -1; renderDetail(); const first = state.detail.episodes[0]; if (first?.slug) playEpisode(first.slug, Number(first.number), null, false); } catch (error) { $("#watchSub").textContent = error.message; } }
function closeWatch() { const overlay = $("#watchOverlay"); const modal = $("#watchModal"); closePipWindow(); hideVideoControls(); overlay.classList.add("is-closing"); modal.classList.add("is-closing"); setTimeout(() => { overlay.hidden = true; overlay.classList.remove("is-closing"); modal.classList.remove("is-closing"); document.body.style.overflow = ""; state.detail = null; bindActions(); }, 200); }
function bindActions() { /* hold pada Remove dipasang di sini (jalan tiap render); klik singkat ditangani delegasi di setup() */ $$('[data-act="remove"]').forEach((b) => { if (b.dataset.holdBound === "1") return; b.dataset.holdBound = "1"; holdable(b, 1200, () => { b.dataset.holdDone = String(Date.now()); removeStorage(b.dataset.id); }); }); }
const GENRE_OPTIONS = "Aksi|Anak-Anak|Antariksa|Avant Garde|Dimensia|Donghua|Drama|Ecchi|Fantasi|Fantasi Urban|Game|Gourmet|Harem|Horror|Iblis|Isekai|Josei|Ketegangan|Komedi|Live Action|Makanan|Martial Arts|Medis|Militer|Misteri|Mitologi|Mobil|Musik|Olahraga|Parodi|Perang|Petualangan|Polisi|Politik|Psikologis|Reinkarnasi|Robot|Romansa|Samurai|Sci-Fi|Seinen|Sejarah|Sekolahan|Shoujo|Shoujo Ai|Shounen|Shounen Ai|Sihir|Slice of Life|Super Power|Supranatural|Thriller|Time Travel|Vampir".split("|").map((name) => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
const CHARACTER_OPTIONS = "Ambisi|Anak-Anak|Anti-Sosial|Badass|Berbisnis|Berisik|Berjuang|Beruntung|Blakblakan|Bounty Hunter|Cerewet|Ceria|Ceroboh|Cewek|Couple|Cowok|Dewa|Dikagumi|Disepelekan|Ditakuti|Iblis|Jenius|Kejam|Legenda|Licik|Loli|Mencolok|Menyebalkan|Mesum|Monster|Narsis|Optimis|Overpower|Pemalas|Pemalu|Pemarah|Pemimpin|Penakut|Pendendam|Pendiam|Pesimis|Polos|Semangat|Setia|Slengekan|Sopan|Suram|Terkutuk|Totalitas|Tsundere|Vampir|Yandere|Zero To Hero".split("|");
function labelForGenre(slug) { return state.genres.find((g) => g.slug === slug)?.name || slug; }
function tagMatch(item, selected, key) { if (!selected.size) return true; const values = (item[key] || []).map((v) => String(typeof v === "string" ? v : v.name || v.slug || "").toLowerCase()); return [...selected].some((value) => values.includes(String(value).toLowerCase()) || values.some((v) => v.includes(String(value).toLowerCase()))); }
function updateFilterLabel(root, set, fallback) { $(".gf-label", root).textContent = set.size ? `${set.size} dipilih` : fallback; root.classList.toggle("has-active-root", set.size > 0); $(".gf-trigger", root).classList.toggle("has-active", set.size > 0); }
function bindCharacter(root) { if (!root) return; const panel = $(".gf-panel", root); attach(root); $(".gf-grid", root).innerHTML = CHARACTER_OPTIONS.map((name) => `<button class="gf-chip" data-character="${esc(name)}">${esc(name)}</button>`).join(""); $$('[data-character]', panel).forEach((b) => b.onclick = () => { const set = root.classList.contains("cf-storage") ? state.storageCharacters : state.mainCharacters; set.has(b.dataset.character) ? set.delete(b.dataset.character) : set.add(b.dataset.character); b.classList.toggle("on", set.has(b.dataset.character)); updateFilterLabel(root, set, "Karakter"); root.classList.contains("cf-storage") ? refreshStorageFilters() : renderSearch(); }); $(`[data-cf-clear]`, root).onclick = () => { const set = root.classList.contains("cf-storage") ? state.storageCharacters : state.mainCharacters; set.clear(); updateFilterLabel(root, set, "Karakter"); $$("[data-character]", panel).forEach((b) => b.classList.remove("on")); root.classList.contains("cf-storage") ? refreshStorageFilters() : renderSearch(); }; }
const FILTER_OPTIONS = { mainType: [["","Tipe"],["Serial TV","Serial TV"],["Live Action","Live Action"],["Movie","Movie"],["OVA","OVA"],["ONA","ONA"],["Spesial","Spesial"]], storageType: [["","Tipe"],["Serial TV","Serial TV"],["Live Action","Live Action"],["Movie","Movie"],["OVA","OVA"],["ONA","ONA"],["Spesial","Spesial"]], mainStatus: [["","Status"],["Segera Tayang","Segera Tayang"],["Sedang Tayang","Sedang Tayang"],["Selesai Tayang","Selesai Tayang"],["Rating","Rating"],["Terpopuler","Terpopuler"]], storageStatus: [["","Status"],["Segera Tayang","Segera Tayang"],["Sedang Tayang","Sedang Tayang"],["Selesai Tayang","Selesai Tayang"],["Rating","Rating"],["Terpopuler","Terpopuler"]] };
function bindDropdown(root) { if (!root) return; const key = root.dataset.filter; const panel = $(".gf-panel", root); attach(root); const setOptions = () => { $(".gf-grid", root).innerHTML = (FILTER_OPTIONS[key] || []).map(([value,label]) => `<button class="gf-chip ${state[key] === value ? "on" : ""}" data-value="${esc(value)}">${esc(label)}</button>`).join(""); }; setOptions(); $$('[data-value]', panel).forEach((button) => button.onclick = () => { state[key] = button.dataset.value; $(".gf-label", root).textContent = button.textContent; setOptions(); closeActive(); root.closest("[data-filter-scope=storage]") ? refreshStorageFilters() : renderSearch(); }); }
function bindGenre(root) { if (!root) return; attach(root); const panel = $(".gf-panel", root); const storage = root.classList.contains("gf-storage"); const set = storage ? state.storageGenres : state.mainGenres; const genres = [...new Map([...GENRE_OPTIONS, ...state.genres].map((g) => [g.slug, g])).values()]; $(".gf-grid", root).innerHTML = genres.map((g) => `<button class="gf-chip ${set.has(g.slug) ? "on" : ""}" data-genre="${esc(g.slug)}">${esc(g.name)}</button>`).join(""); updateFilterLabel(root, set, "All Genre"); $$('[data-genre]', panel).forEach((b) => b.onclick = () => { set.has(b.dataset.genre) ? set.delete(b.dataset.genre) : set.add(b.dataset.genre); b.classList.toggle("on", set.has(b.dataset.genre)); updateFilterLabel(root, set, "All Genre"); storage ? refreshStorageFilters() : renderSearch(); }); $(`[data-gf-clear]`, root).onclick = () => { set.clear(); updateFilterLabel(root, set, "All Genre"); $$("[data-genre]", panel).forEach((b) => b.classList.remove("on")); storage ? refreshStorageFilters() : renderSearch(); }; }
function scrollToSection(selector, button) { const target = $(selector); if (!target) return; $("#mainScroll").scrollTo({ top: target.offsetTop - 20, behavior: "smooth" }); $$(".nav-item[data-nav]").forEach((b) => b.classList.toggle("active", b === button)); }
function openAbout() { const root = $("#confirmRoot"); const overlay = document.createElement("div"); overlay.className = "overlay"; overlay.innerHTML = 
  `<div class="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
  <h3 id="about-modal-title">Tentang iLoveNime</h3>
  
  <div class="modal-content">
    <p><strong>iLoveNime</strong> adalah platform streaming anime independen yang dapat diakses secara gratis dan bebas dari iklan.</p>
    
    <hr class="modal-divider" />

    <div class="about-section">
      <h4>📌 Penting Mengenai Data &amp; Progres</h4>
      <p>Koleksi dan progres menonton Anda disimpan secara lokal di browser (<em>Local Storage</em>). Karena domain berganti secara berkala, pastikan untuk menggunakan fitur <strong>Export</strong> untuk mencadangkan data, dan <strong>Import</strong> di domain baru agar progres tidak hilang.</p>
    </div>

    <div class="about-section">
      <h4>🌐 Server &amp; Pergantian Domain</h4>
      <p>Ketersediaan <em>source</em> dan <em>mirror</em> dapat berubah mengikuti kondisi jaringan. Kami memohon maaf jika alamat web harus berganti link setiap bulannya demi menekan biaya operasional hosting agar layanan tetap gratis.</p>
    </div>

  </div>

  <div class="confirm-actions">
    <button class="btn btn-primary" data-close-about>Tutup</button>
  </div>
</div>`; root.appendChild(overlay); $("[data-close-about]", overlay).onclick = () => overlay.remove(); overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); }; }
function bindSelect(id, key, render) { const el = $(id); if (!el) return; el.value = state[key] || ""; el.onchange = () => { state[key] = el.value; render(); }; }
function setup() {
  document.addEventListener("click", (event) => { const detail = event.target.closest?.('[data-act="detail"]'); const add = event.target.closest?.('[data-act="add"]'); const check = event.target.closest?.('[data-act="check"]'); const remove = event.target.closest?.('[data-act="remove"]'); if (detail) { event.preventDefault(); event.stopPropagation(); openDetail(detail.dataset.id); } else if (add) { event.preventDefault(); event.stopPropagation(); addStorage(add.dataset.id); } else if (check) { event.preventDefault(); event.stopPropagation(); const id = check.dataset.id; state.selectedStorageItems.has(id) ? state.selectedStorageItems.delete(id) : state.selectedStorageItems.add(id); renderStorage(); } else if (remove) { /* Hold selesai memicu removeStorage sendiri (holdDone);
     klik singkat: konfirmasi dulu */ const btn = remove; const heldAt = Number(btn.dataset.holdDone || 0); if (Date.now() - heldAt < 600) return; event.preventDefault(); event.stopPropagation(); const id = btn.dataset.id; const item = state.storageItems.find((i) => i.slug === id); openConfirm("Hapus dari Local Storage?", `${item?.title || "Anime ini"} akan dihapus dari koleksimu.`, () => removeStorage(id)); } });
  document.documentElement.dataset.theme = prefs.theme;
  $$(".theme-checkbox").forEach((input) => { input.checked = prefs.theme === "light"; input.onchange = () => { prefs.theme = input.checked ? "light" : "dark"; saveState(); /* Matikan transition sekejap agar ratusan elemen tidak
     men-transition warna bersamaan (jank 30fps→1fps) */ const rootEl = document.documentElement; rootEl.classList.add("theme-switching"); rootEl.dataset.theme = prefs.theme; $$(".theme-checkbox").forEach((x) => x.checked = input.checked); setTimeout(() => rootEl.classList.remove("theme-switching"), 240); }; });
  $("#sbToggle").onclick = () => { const appEl = $("#app"); /* Matikan biaya paint mahal (backdrop-filter & transisi kartu)
     selama animasi collapse/expand agar frame tidak drop */ appEl.classList.add("animating"); appEl.classList.toggle("collapsed"); prefs.sidebarCollapsed = appEl.classList.contains("collapsed"); saveState(); setTimeout(() => appEl.classList.remove("animating"), 380); };
  if (prefs.sidebarCollapsed && !mobileQuery.matches) $("#app").classList.add("collapsed");
  $("#globalSearch").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); search(e.currentTarget.value); } };
  $("#searchClear").onclick = () => { $("#globalSearch").value = ""; state.searchQuery = ""; state.searchResults = []; renderSearch(); };
  $("#clearSearchBtn").onclick = () => { $("#globalSearch").value = ""; state.searchQuery = ""; state.searchResults = []; renderSearch(); };
  $("#localSearch").oninput = (e) => { state.localQuery = e.target.value; state.storagePage = 0; renderStorage(); };
  $$("#storageTabs .tab").forEach((b) => b.onclick = () => { state.currentTab = b.dataset.tab; state.storagePage = 0; renderStorage(); });
  $("#editModeBtn").onclick = () => { state.editMode = !state.editMode; state.selectedStorageItems.clear(); $("#editModeBtn").innerHTML = state.editMode ? "Done" : `<svg class="ico"><use href="#i-edit"/></svg> Edit Mode`; renderStorage(); };
  $("#selectAllBtn").onclick = () => { filterVisible().forEach((item) => state.selectedStorageItems.add(item.slug)); renderStorage(); };
  $("#cancelEditBtn").onclick = () => { state.editMode = false; state.selectedStorageItems.clear(); $("#editModeBtn").innerHTML = `<svg class="ico"><use href="#i-edit"/></svg> Edit Mode`; renderStorage(); };
  holdable($("#bulkDeleteBtn"), 1500, () => { state.storageItems = state.storageItems.filter((i) => !state.selectedStorageItems.has(i.slug)); state.selectedStorageItems.clear(); saveState(); renderAll(); toast("Anime terpilih dihapus"); });
  holdable($("#deleteDataBtn"), 1500, () => openConfirm("Hapus seluruh data lokal?", "Tindakan ini permanen dan menghapus koleksi, progres, dan profile lokal.", () => { state.storageItems = []; state.selectedStorageItems.clear(); saveState(); renderAll(); toast("Data lokal dihapus"); }));
  holdable($("#ppDeleteBtn"), 1500, () => openConfirm("Hapus seluruh data lokal?", "Tindakan ini permanen dan menghapus koleksi, progres, dan profile lokal.", () => { state.storageItems = []; state.selectedStorageItems.clear(); saveState(); renderAll(); toast("Data lokal dihapus"); }));
  $("#watchClose").onclick = closeWatch;
  $("#watchOverlay").onclick = (e) => { if (e.target.id === "watchOverlay") closeWatch(); };
  attach($("#mirrorSelectWrapper"));
  attach($(".data-menu-wrap"));
  $("#sbUser").onclick = () => { if (mobileQuery.matches) return; /* profil sudah tampil di main saat mobile */ const popup = $("#profilePopup"); popup.hidden = !popup.hidden; $("#ppNameInput").value = prefs.username; };
  const openProfileEditor = () => { const popup = $("#profilePopup"); popup.hidden = false; popup.classList.add("is-inline"); $("#ppNameInput").value = prefs.username; applyProfile(); };
  $("#pcEditBtn").onclick = (event) => { event.stopPropagation(); openProfileEditor(); };
  const finishEdit = () => { $("#profilePopup").classList.remove("is-inline"); $("#profilePopup").hidden = true; saveState(); renderProfile(); };
  $("#ppClose").addEventListener("click", (event) => { event.stopPropagation(); finishEdit(); });
  $("#ppNameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const value = e.currentTarget.value.trim(); if (value) { prefs.username = value; toast("Profil diperbarui", "Nama tersimpan di perangkat ini."); } finishEdit(); } });
  $("#ppChangeAvatar").addEventListener("click", (e) => {
    e.stopPropagation();
    /* Suspend 30 dtk setelah 3× memaksa format tidak didukung */
    const until = Number(prefs.avatarSuspendedUntil || 0);
    if (Date.now() < until) { toast("Upload ditangguhkan", `Coba lagi dalam ${Math.ceil((until - Date.now()) / 1000)} detik.`); return; }
    $("#ppAvatarFile").click();
  });
  $("#ppAvatarFile").onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    /* Hanya PNG / WebP / GIF — GIF membuat avatar beranimasi. */
    if (!isAllowedAvatarFile(file)) {
      e.target.value = "";
      const strikes = Number(prefs.avatarStrikes || 0) + 1;
      if (strikes >= 3) {
        prefs.avatarStrikes = 0;
        prefs.avatarSuspendedUntil = Date.now() + 30000;
        saveState();
        openAlert("Upload ditangguhkan", "Kamu 3 kali mencoba format yang tidak didukung. Ganti foto profil dikunci selama 30 detik.");
      } else {
        prefs.avatarStrikes = strikes;
        saveState();
        openAlert("Format tidak didukung", `Avatar hanya menerima PNG, WebP, atau GIF. Percobaan ke-${strikes} dari 3.`);
      }
      return;
    }
    prefs.avatarStrikes = 0;
    const reader = new FileReader();
    reader.onload = () => { prefs.avatarUrl = String(reader.result); saveState(); renderProfile(); toast("Foto profil diperbarui", /gif/i.test(file.type) ? "Avatar GIF beranimasi aktif." : ""); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  $("#ppNameInput").onchange = (e) => { prefs.username = e.target.value.trim() || "Anime watcher"; saveState(); renderProfile(); };
  $("#aboutButton")?.addEventListener("click", openAbout);
  $("#importBtn").onclick = () => { closeActive(); $("#dataMenu").hidden = true; $("#importFile").click(); };
  $("#exportBtn").onclick = () => { closeActive(); $("#dataMenu").hidden = true; const payload = buildExportPayload(state.storageItems, prefs); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); link.download = `ilovenime-tracking-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); toast("Backup diunduh", `${payload.items.length} anime + profil (nama & foto).`); };
  $("#importFile").onchange = (e) => { const file = e.target.files?.[0]; if (!file) return; thoughtStart("import"); const reader = new FileReader(); reader.onload = async () => { try { thoughtStage("Importing", 38); const data = JSON.parse(reader.result); const items = Array.isArray(data) ? data : data.items || data.storageItems; if (!Array.isArray(items)) throw new Error("Format backup tidak dikenali."); await thoughtProgress(38, 92, 700); state.storageItems = items.map(normalizeStored).filter((x) => x.slug); /* v2: pulihkan juga profil (nama, handle, foto, tema) */ const restoredProfile = Boolean(data.profile); if (restoredProfile) { prefs = mergeImportedProfile(data, prefs); document.documentElement.dataset.theme = prefs.theme; $$(".theme-checkbox").forEach((x) => x.checked = prefs.theme === "light"); if (prefs.sidebarCollapsed && !mobileQuery.matches) $("#app").classList.add("collapsed"); else $("#app").classList.remove("collapsed"); } saveState(); renderAll(); thoughtDone(); toast("Import selesai", `${state.storageItems.length} anime dipulihkan.${restoredProfile ? " Profil juga dipulihkan." : ""}`); } catch (error) { thoughtDone(); toast("Import gagal", error.message); } }; reader.readAsText(file); e.target.value = ""; };
  $$(".nav-item[data-nav]").forEach((b) => b.onclick = () => { const map = { dashboard: "#profileSection", update: "#updateSection", storage: "#storageSection" }; scrollToSection(map[b.dataset.nav], b); setDrawer(false); });
  const mainScroll = $("#mainScroll");
  mainScroll?.addEventListener("scroll", () => { const sections = [["#profileSection","dashboard"],["#updateSection","update"],["#storageSection","storage"]]; let active = "dashboard"; for (const [selector, name] of sections) { const el = $(selector); if (el && el.offsetTop - mainScroll.scrollTop < 180) active = name; } $$(".nav-item[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === active)); }, { passive: true });
  $$(".nav-item[data-support]").forEach((b) => b.onclick = () => { setDrawer(false); if (b.dataset.support === "about") openAbout(); if (b.dataset.support === "donate") window.open("https://sociabuzz.com/neonishikawa/tribe", "_blank", "noopener"); if (b.dataset.support === "feedback") window.open("https://tally.so/r/7RAZd2", "_blank", "noopener"); });
  $("#profilePopup").addEventListener("click", (e) => { if (e.target === $("#profilePopup")) finishEdit(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("#watchOverlay").hidden) closeWatch(); else $("#profilePopup").hidden = true; } });
  [$(".gf-header"), $(".gf-storage")].forEach(bindGenre);
  [$(".cf-main"), $(".cf-storage")].forEach(bindCharacter);
  $$(".styled-filter").forEach(bindDropdown);
  $("#mainFilterSearch").onclick = () => search(state.searchQuery);
  $("#storageFilterSearch").onclick = () => (state.storageGenres.size || state.storageCharacters.size) ? refreshStorageFilters() : renderStorage();
}
function filterVisible() { const q = state.localQuery.toLowerCase(); return state.storageItems.filter((item) => { if (state.currentTab === "Complete" && !isComplete(item)) return false; if (state.currentTab === "Plan to Watch" && item.progress) return false; if (state.currentTab === "Dislike" && !item.dislike && item.status !== "dropped") return false; if (state.currentTab === "Favorite" && !item.favorite) return false; return !q || item.title.toLowerCase().includes(q); }); }
async function loadLive() { try { const results = await Promise.allSettled([api.daily(), api.genres()]); if (results[0].status === "fulfilled") { state.daily = (results[0].value.data || []).map(normAnime); renderUpdates(); } if (results[1].status === "fulfilled") { state.genres = results[1].value.data || []; bindGenre($(".gf-header")); bindGenre($(".gf-storage")); bindCharacter($(".cf-main")); bindCharacter($(".cf-storage")); } bindActions(); } catch (error) {  } }
setup(); setupScrollReveal(); renderAll(); loadLive();
/* Hydrate metadata storage (rating, genre, karakter) di belakang layar agar
   kartu storage & detail tidak menampilkan "—" selamanya */
if (state.storageItems.length) hydrateStorageMetadata().then(() => { renderStorage(); renderProfile(); });
