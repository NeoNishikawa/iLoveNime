export const SCREEN_TIME_KEY = "iln:screen-time";
export const SCREEN_TIME_THRESHOLDS = Object.freeze({ 3: 60_000, 5: 18_000_000, 7: 25_200_000 }); // Uji sementara; kembalikan 3 jam (10_800_000 ms) setelah percobaan.
export const SCREEN_TIME_IDLE_MS = 5 * 60_000;
export const SCREEN_TIME_SNOOZE_MS = 30 * 60_000;
const SCHEDULER_MS = 45_000;

function localDateKey(epochMs) {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function freshState(date, enabled = true) {
  return { date, activeMs: 0, lastActiveAt: 0, lastTriggeredThreshold: 0, snoozeUntil: 0, enabled };
}

function normalizeState(raw, date) {
  if (!raw || typeof raw !== "object" || raw.date !== date) return freshState(date, raw?.enabled !== false);
  const threshold = Number(raw.lastTriggeredThreshold);
  return {
    date,
    activeMs: Number.isFinite(Number(raw.activeMs)) ? Math.max(0, Number(raw.activeMs)) : 0,
    lastActiveAt: Number.isFinite(Number(raw.lastActiveAt)) ? Math.max(0, Number(raw.lastActiveAt)) : 0,
    lastTriggeredThreshold: [0, 3, 5, 7].includes(threshold) ? threshold : 0,
    snoozeUntil: Number.isFinite(Number(raw.snoozeUntil)) ? Math.max(0, Number(raw.snoozeUntil)) : 0,
    enabled: raw.enabled !== false,
  };
}

/**
 * Local-only active-time tracker. Time deltas use a monotonic clock; wall time
 * is used only for local calendar-day boundaries, persistence, and snoozes.
 */
export function createScreenTimeTracker({
  storage = globalThis.localStorage,
  clock = { performanceNow: () => performance.now(), wallNow: () => Date.now() },
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  scheduler = globalThis,
  onReminder = () => {},
  idleMs = SCREEN_TIME_IDLE_MS,
  intervalMs = SCHEDULER_MS,
  storageKey = SCREEN_TIME_KEY,
  dateKey = localDateKey,
} = {}) {
  const readStored = () => {
    const today = dateKey(clock.wallNow());
    try { return normalizeState(JSON.parse(storage?.getItem(storageKey) || "null"), today); }
    catch { return freshState(today); }
  };
  let state = readStored();
  let started = false;
  let visible = true;
  let focused = true;
  let lastPerf = clock.performanceNow();
  let lastActivityPerf = lastPerf;
  let lastPersistWall = clock.wallNow();
  let timer = null;
  const listeners = [];

  const persist = (force = false) => {
    const nowWall = clock.wallNow();
    if (!force && nowWall - lastPersistWall < 15_000) return;
    try { storage?.setItem(storageKey, JSON.stringify(state)); lastPersistWall = nowWall; } catch { /* storage may be disabled or full */ }
  };
  const cloneState = () => ({ ...state });
  const attach = (target, eventName, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(eventName, handler, options);
    listeners.push(() => target.removeEventListener(eventName, handler, options));
  };
  const resetForDate = (today, nowPerf) => {
    state = freshState(today, state.enabled);
    lastPerf = nowPerf;
    lastActivityPerf = nowPerf;
    persist(true);
  };
  const rollDateIfNeeded = (nowPerf, nowWall) => {
    const today = dateKey(nowWall);
    if (today === state.date) return false;
    resetForDate(today, nowPerf);
    return true;
  };
  const advance = (nowPerf, nowWall = clock.wallNow()) => {
    if (rollDateIfNeeded(nowPerf, nowWall)) return;
    if (state.enabled && visible && focused) {
      const countUntil = Math.min(nowPerf, lastActivityPerf + idleMs);
      const from = Math.max(lastPerf, lastActivityPerf);
      if (countUntil > from) state.activeMs += countUntil - from;
    }
    lastPerf = nowPerf;
    persist();
  };
  const emitReminder = (hours, snoozed = false) => {
    const reminder = { thresholdHours: hours, activeMs: state.activeMs, date: state.date, snoozed };
    try { onReminder(reminder); } catch { /* reminders must never break time accounting */ }
  };
  const checkThresholds = (nowWall = clock.wallNow()) => {
    if (!state.enabled) return;
    if (state.activeMs >= SCREEN_TIME_THRESHOLDS[7] && state.lastTriggeredThreshold < 7) {
      state.lastTriggeredThreshold = 7;
      state.snoozeUntil = 0;
      persist(true);
      emitReminder(7);
      return;
    }
    if (state.lastTriggeredThreshold < 5 && state.activeMs >= SCREEN_TIME_THRESHOLDS[5]) {
      state.lastTriggeredThreshold = 5;
      state.snoozeUntil = 0;
      persist(true);
      emitReminder(5);
      return;
    }
    if (state.lastTriggeredThreshold === 5 && state.snoozeUntil && nowWall >= state.snoozeUntil && state.activeMs >= SCREEN_TIME_THRESHOLDS[5]) {
      state.snoozeUntil = 0;
      persist(true);
      emitReminder(5, true);
      return;
    }
    if (state.lastTriggeredThreshold < 3 && state.activeMs >= SCREEN_TIME_THRESHOLDS[3]) {
      state.lastTriggeredThreshold = 3;
      persist(true);
      emitReminder(3);
    }
  };
  const recordActivity = () => {
    if (!started) return;
    const nowPerf = clock.performanceNow();
    const nowWall = clock.wallNow();
    advance(nowPerf, nowWall);
    if (!visible || !focused || !state.enabled) return;
    lastActivityPerf = nowPerf;
    state.lastActiveAt = nowWall;
    lastPerf = nowPerf;
    persist();
    checkThresholds(nowWall);
  };
  const onVisibilityChange = () => {
    const nowPerf = clock.performanceNow();
    advance(nowPerf);
    visible = documentRef?.visibilityState === "visible";
    lastPerf = nowPerf;
    lastActivityPerf = nowPerf;
    if (visible && focused && state.enabled) state.lastActiveAt = clock.wallNow();
    persist();
  };
  const onFocus = () => {
    const nowPerf = clock.performanceNow();
    advance(nowPerf);
    focused = true;
    lastPerf = nowPerf;
    lastActivityPerf = nowPerf;
    if (visible && state.enabled) state.lastActiveAt = clock.wallNow();
    persist();
  };
  const onBlur = () => {
    const nowPerf = clock.performanceNow();
    advance(nowPerf);
    focused = false;
    lastPerf = nowPerf;
    persist();
  };

  const tick = () => {
    if (!started) return;
    const nowPerf = clock.performanceNow();
    const nowWall = clock.wallNow();
    advance(nowPerf, nowWall);
    checkThresholds(nowWall);
  };
  const start = () => {
    if (started) return api;
    started = true;
    visible = documentRef?.visibilityState ? documentRef.visibilityState === "visible" : true;
    focused = typeof documentRef?.hasFocus === "function" ? documentRef.hasFocus() : true;
    lastPerf = clock.performanceNow();
    lastActivityPerf = lastPerf;
    if (visible && focused && state.enabled) state.lastActiveAt = clock.wallNow();
    attach(documentRef, "visibilitychange", onVisibilityChange);
    attach(windowRef, "focus", onFocus);
    attach(windowRef, "blur", onBlur);
    for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
      attach(documentRef, eventName, recordActivity, eventName === "scroll" || eventName === "touchstart" ? { passive: true } : undefined);
    }
    timer = scheduler?.setInterval?.(tick, intervalMs) ?? null;
    checkThresholds(clock.wallNow());
    return api;
  };
  const stop = () => {
    if (!started) return;
    advance(clock.performanceNow(), clock.wallNow());
    started = false;
    if (timer !== null) scheduler?.clearInterval?.(timer);
    timer = null;
    listeners.splice(0).forEach((remove) => remove());
  };
  const snooze = (minutes = 30) => {
    if (state.lastTriggeredThreshold !== 5) return false;
    state.snoozeUntil = clock.wallNow() + Math.max(1, Number(minutes) || 30) * 60_000;
    persist(true);
    return true;
  };
  const dismiss = () => {
    state.snoozeUntil = 0;
    persist(true);
  };
  const setEnabled = (enabled) => {
    const nowPerf = clock.performanceNow();
    advance(nowPerf, clock.wallNow());
    state.enabled = Boolean(enabled);
    lastPerf = nowPerf;
    lastActivityPerf = nowPerf;
    persist(true);
    if (state.enabled) checkThresholds(clock.wallNow());
  };
  const api = { start, stop, tick, recordActivity, snooze, dismiss, setEnabled, getState: cloneState };
  return api;
}

const reminderCopy = {
  5: {
    image: "/assets/screen-time/5hours.png",
    title: "Saatnya istirahat sejenak",
    body: "Kamu sudah aktif selama 5 jam hari ini. Beri mata dan tubuhmu jeda sebentar.",
    alt: "Karakter mengingatkan untuk beristirahat setelah lima jam",
  },
  7: {
    image: "/assets/screen-time/7hours.png",
    title: "Sudah 7 jam — waktunya rehat",
    body: "Kamu telah aktif cukup lama hari ini. Pertimbangkan untuk menjauh dari layar dan beristirahat.",
    alt: "Karakter menangis mengingatkan agar beristirahat setelah tujuh jam",
  },
};

/** Mounts a non-blocking 3h status and an accessible 5h/7h modal. */
export function mountScreenTimeUI({ tracker, documentRef = globalThis.document } = {}) {
  if (!documentRef?.body) return { show() {}, destroy() {} };
  const root = documentRef.createElement("div");
  root.className = "screen-time-root";
  root.innerHTML = `
    <div class="screen-time-toast" data-screen-toast role="status" aria-live="polite" aria-atomic="true" hidden>
      <img src="/assets/screen-time/3hours.png" alt="" width="74" height="74" />
      <div class="screen-time-toast__copy"><strong>Waktunya jeda sebentar</strong><span>Kamu sudah aktif selama 3 jam hari ini. Istirahatkan mata sejenak.</span></div>
      <button type="button" class="screen-time-close" data-screen-dismiss aria-label="Tutup pengingat">×</button>
    </div>
    <div class="screen-time-overlay" data-screen-overlay hidden>
      <section class="screen-time-dialog" data-screen-dialog role="dialog" aria-modal="true" aria-labelledby="screen-time-title" aria-describedby="screen-time-description" tabindex="-1">
        <img class="screen-time-dialog__image" data-screen-image src="" alt="" width="168" height="168" />
        <p class="screen-time-eyebrow" data-screen-eyebrow>Pengingat waktu layar</p>
        <h2 id="screen-time-title" data-screen-title></h2>
        <p id="screen-time-description" class="screen-time-description" data-screen-description></p>
        <div class="screen-time-actions" data-screen-actions></div>
      </section>
    </div>`;
  documentRef.body.appendChild(root);
  const toast = root.querySelector("[data-screen-toast]");
  const overlay = root.querySelector("[data-screen-overlay]");
  const dialog = root.querySelector("[data-screen-dialog]");
  const image = root.querySelector("[data-screen-image]");
  const title = root.querySelector("[data-screen-title]");
  const description = root.querySelector("[data-screen-description]");
  const eyebrow = root.querySelector("[data-screen-eyebrow]");
  const actions = root.querySelector("[data-screen-actions]");
  let returnFocus = null;
  let open = false;
  let toastTimer = null;

  const closeDialog = () => {
    if (!open) return;
    open = false;
    overlay.hidden = true;
    actions.replaceChildren();
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && typeof target.focus === "function") target.focus();
  };
  const button = (label, action, primary = false) => {
    const node = documentRef.createElement("button");
    node.type = "button";
    node.className = `screen-time-btn${primary ? " is-primary" : ""}`;
    node.dataset.screenAction = action;
    node.textContent = label;
    return node;
  };
  const showDialog = (hours) => {
    const copy = reminderCopy[hours];
    if (!copy) return;
    if (!open) returnFocus = documentRef.activeElement;
    open = true;
    image.src = copy.image;
    image.alt = copy.alt;
    title.textContent = copy.title;
    description.textContent = copy.body;
    eyebrow.textContent = `${hours} jam aktif hari ini`;
    actions.replaceChildren();
    if (hours === 5) {
      actions.append(
        button("Istirahat sekarang", "dismiss", true),
        button("Lanjutkan 30 menit", "snooze"),
        button("Tutup", "dismiss"),
      );
    } else {
      actions.append(button("Saya akan beristirahat", "dismiss", true));
    }
    overlay.hidden = false;
    actions.querySelector("button")?.focus();
  };
  const show = ({ thresholdHours } = {}) => {
    if (thresholdHours === 3) {
      clearTimeout(toastTimer);
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, 15_000);
    } else if (thresholdHours === 5 || thresholdHours === 7) {
      showDialog(thresholdHours);
    }
  };
  root.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-screen-action]")?.dataset.screenAction;
    if (action === "snooze") {
      tracker?.snooze(30);
      closeDialog();
    } else if (action === "dismiss") {
      tracker?.dismiss();
      closeDialog();
    } else if (event.target.closest?.("[data-screen-dismiss]")) {
      toast.hidden = true;
      clearTimeout(toastTimer);
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (Number(eyebrow.textContent.split(" ")[0]) === 5) {
        event.preventDefault();
        tracker?.dismiss();
        closeDialog();
      } else {
        event.preventDefault();
        actions.querySelector("button")?.focus();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && documentRef.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && documentRef.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  root.show = show;
  root.destroy = () => { clearTimeout(toastTimer); closeDialog(); root.remove(); };
  return root;
}
