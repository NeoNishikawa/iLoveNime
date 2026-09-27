/*
 * Countdown iLoveNime.
 *
 * Reset contoh dari 22/21 hari menjadi 29/28 hari pada 27 Sep 2026:
 * maintenance -> 2026-10-26T23:59:59+07:00
 * domain      -> 2026-10-25T23:59:59+07:00
 *
 * Gunakan ISO timestamp dengan timezone agar hitungan konsisten di browser.
 */
export const COUNTDOWN_TARGETS = {
  maintenance: "2026-10-19T23:59:59+07:00",
  domain: "2026-10-18T23:59:59+07:00",
};
