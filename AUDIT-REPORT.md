# Audit iLoveNime v2.3

Tanggal audit: 27 September 2026  
Commit yang dianalisis: `65bfbfa` (`fix: keep playback seamless when opening pip`)

> **Batasan audit:** logika mirroring/stream source YAOI Animasu tidak diubah. Bagian tersebut hanya diuji dari sisi kontrak API, input, error handling, cache, dan integrasi player.

## Ringkasan eksekutif

- **Test existing:** 29/29 lulus.
- **Integrasi route:** lulus untuk daily, catalog, detail, streams, dan isolasi source URL eksternal.
- **Stress test lokal:** 500 request paralel selesai dalam 3,324 ms; 330 HTTP 200, 170 HTTP 429; tidak ada 5xx.
- **Upstream load:** hanya 6 request diteruskan dari 500 request karena cache/coalescing.
- **API key:** tidak ada API key, bearer token, secret, atau kredensial hardcoded yang ditemukan di source tracked. Aplikasi menggunakan proxy server-side tanpa autentikasi.
- **Streaming:** server tidak mentranscode atau membuat streaming protocol sendiri; server mengembalikan URL mirror dan browser memuatnya melalui iframe cross-origin.
- **PiP:** implementasi saat ini adalah floating PiP di dokumen yang sama, bukan native OS Picture-in-Picture. Iframe dipindahkan sebagai node yang sama agar playback tidak reset.
- **Dependency:** `npm audit --omit=dev` melaporkan 3 moderate vulnerability pada rantai `express -> body-parser -> qs`, terkait parsing array/DoS di `qs`. Ini belum diperbaiki karena audit ini tidak mengubah kode.

## 1. Alur aplikasi

```text
Browser
  |
  | GET /api/daily, /api/catalog, /api/genres, /api/anime/:slug
  v
Express server
  |-- in-memory cache + pending-request coalescing
  |-- upstream queue (default concurrency 1, interval 1500 ms)
  |-- Animasu HTML fetch via axios
  |-- Cheerio parser + normalizer + fallback snapshot
  v
Animasu source

Browser -- GET /api/streams/:episodeSlug --> Express
  |-- baca mirror HTML Animasu
  |-- fallback YAOI API bila direct mirror kosong
  v
JSON URL mirror
  |
  `--> iframe cross-origin di player browser
```

### Endpoint yang ditemukan

| Endpoint | Fungsi | Status/error utama | Catatan |
|---|---|---|---|
| `GET /api/health` | Status app, source, cache, queue | 200 | Mengungkap base URL dan runtime stats; cocok untuk local app, perlu pertimbangan bila dipublikasikan |
| `GET /api/daily` | Jadwal anime hari ini | 200 / 503 | Cache; stale cache dan local snapshot fallback |
| `GET /api/genres` | Daftar genre | 200 / 503 | Cache; stale cache |
| `GET /api/catalog?search=&genre=` | Pencarian/pagination | 200 / 429 / 503 | Rate limit 30 request/IP/menit; query minimal 2 karakter |
| `GET /api/anime/:slug` | Detail dan episode | 200 / 502 | Detail fallback dari snapshot bila slug ada |
| `GET /api/streams/:episodeSlug` | Mirror stream | 200 / 502 | Kontrak YAOI/mirror dipertahankan, tidak diubah |
| `GET /*` | SPA fallback | 200 | Mengirim `public/index.html` |

## 2. Audit API dan key

### Temuan positif

- Tidak ada `Authorization`, `Bearer`, API key, client secret, password, atau token pengguna di source tracked.
- Frontend hanya memanggil endpoint relatif (`/api/...`), sehingga tidak mengekspos credential upstream ke browser.
- `sourceUrl` yang dikirim ke test eksternal tidak digunakan sebagai source provider pada route produksi; integrasi mengonfirmasi request tidak diarahkan ke domain arbitrary tersebut.
- Search memiliki batas panjang query (`search` 100 karakter, `genre` 80 karakter) dan rate limit per IP.
- Response error sudah berupa JSON terstruktur pada route API.

### Risiko dan rekomendasi

1. **API tidak memiliki autentikasi.** Ini wajar untuk aplikasi personal lokal, tetapi berisiko bila bind ke internet/public host. Tambahkan authentication/reverse-proxy access control sebelum deployment publik.
2. **Rate limit hanya ada di `/api/catalog`.** `/api/daily`, `/api/genres`, `/api/anime/:slug`, dan terutama `/api/streams/:episodeSlug` belum memiliki pembatas per IP. Tambahkan limit terpisah dan batas concurrent request bila app akan dipublikasikan.
3. **`/api/health` mengungkap konfigurasi source dan error terakhir.** Untuk public deployment, batasi detail tersebut atau pisahkan endpoint readiness internal.
4. **Tidak ada schema validation khusus untuk slug.** Express route menerima string arbitrary dan meneruskannya ke parser/upstream setelah encoding. Tambahkan allowlist slug format, panjang maksimal, dan reject control characters sebelum request upstream.
5. **`express.json()` aktif global tanpa kebutuhan body API yang terlihat.** Karena seluruh endpoint yang diaudit berbasis GET, middleware body parser dapat dihapus atau diberi limit kecil seperti `limit: "16kb"`.

## 3. Audit streaming dan mirroring

### Perilaku aktual

- Tidak ditemukan WebSocket, SSE, `MediaSource`, HLS/DASH proxy, atau `ReadableStream` di aplikasi.
- Streaming aktual dilakukan provider mirror di dalam iframe.
- Server hanya mengurai URL mirror dari HTML source/YAOI dan mengembalikan daftar `{ name, url, source }`.
- Frontend escape nilai HTML sebelum memasukkan URL mirror ke iframe.
- Mirror URL hanya diterima bila skema akhirnya HTTP(S) atau protocol-relative; test probe menolak langsung `javascript:` dan `data:` pada markup iframe biasa.
- Base64 mirror yang mendekode ke protocol non-HTTP tidak masuk ke hasil `parseMirrorOptions`, meskipun helper `decodeMirror()` secara standalone dapat mengembalikan nilai non-HTTP. Ini perlu hardening bila helper tersebut kelak dipakai di jalur lain.

### Batasan pengujian

Konten video dan buffering provider mirror tidak dapat diuji end-to-end tanpa menjadikan domain pihak ketiga sebagai target beban. Stress test memakai fixture HTTP lokal yang meniru HTML Animasu/YAOI; ini memvalidasi route, parser, cache, queue, dan error boundary, bukan kualitas bitrate atau playback mirror eksternal.

### Rekomendasi tanpa mengubah mirroring

- Pertahankan kontrak YAOI/Animasu seperti sekarang.
- Tambahkan validasi final `url.protocol === "http:" || url.protocol === "https:"` sebelum response JSON.
- Tambahkan Content Security Policy yang sesuai, khususnya `frame-src` allowlist domain mirror yang memang dipercaya; jangan memakai `frame-src *` tanpa alasan.
- Pertimbangkan `referrerpolicy="no-referrer"` pada iframe bila kompatibel dengan provider.
- Catat metrik error mirror (tanpa menyimpan URL sensitif) agar kegagalan provider dapat dibedakan dari kegagalan API.

## 4. Audit PiP

### Yang sudah baik

- `SEAMLESS_IFRAME_PIP = true` memilih handoff iframe di halaman yang sama.
- Node iframe yang sama dipindahkan ke `.pip-body`; `src` tidak diganti saat membuka PiP, sehingga posisi playback tidak sengaja reset.
- Ada kontrol Previous, Next, dan Close.
- Ada fallback pagehide untuk mengembalikan iframe ke player utama.
- Tombol memiliki `title` dan `aria-label`.
- Test existing mengunci perilaku seamless ini.

### Ekspektasi produk yang perlu didokumentasikan

- Ini **bukan native browser/media PiP** dan tidak selalu tampil sebagai window mengambang di luar tab/browser.
- PiP hanya floating overlay di dokumen yang sama. Bila user pindah tab atau menutup tab, playback tidak dijamin tetap hidup.
- Kontrol video provider tetap berada di iframe cross-origin dan tidak dapat dikendalikan oleh parent app.

### Risiko/edge case

- Ketika modal watch ditutup, `closePipWindow()` dipanggil dan PiP ikut ditutup; ini konsisten, tetapi perlu dipahami sebagai perilaku produk.
- Pergantian episode di PiP melakukan request mirror baru dan mengubah `iframe.src`; reset playback pada episode baru memang diharapkan.
- Native `documentPictureInPicture` masih ada sebagai dead/future branch tetapi dinonaktifkan oleh constant. Jika diaktifkan kembali, perlu regression test browser-specific.
- Belum ada automated browser test yang memverifikasi focus, resize, pagehide, dan recovery iframe di browser nyata.

## 5. Audit UI/UX dan aksesibilitas

### Kekuatan

- Layout responsive memiliki breakpoint desktop/mobile dan grid player/detail yang jelas.
- `:focus-visible` tersedia dengan outline yang terlihat.
- Ada dukungan `prefers-reduced-motion` pada stylesheet/ambient effect.
- Loading, empty state, fallback snapshot, dan error mirror memiliki jalur tampilan.
- Poster memakai `alt`, loading lazy, status dan progress ditampilkan.
- Modal utama menggunakan `role="dialog"`, `aria-modal="true"`; aksi penting umumnya berupa button, bukan link palsu.
- Escape menutup watch overlay/profile popup; dropdown juga memiliki Escape handling.

### Area perbaikan

- Tidak ada skip link, dan root konten utama tidak memakai elemen `<main>` (statis: `main` element tidak ditemukan). Ini mengurangi navigasi screen reader/keyboard.
- Focus trap dan restore focus untuk modal belum terlihat. Setelah modal ditutup, fokus dapat hilang atau kembali ke posisi yang tidak konsisten.
- `aria-label` ada, tetapi beberapa state dinamis perlu `aria-live` yang lebih konsisten: hasil pencarian, jumlah hasil, error API, perubahan episode, dan perubahan status watched.
- Search input memakai id `globalSearch`, bukan `searchInput`; ini bukan bug fungsional, tetapi test/UI automation sebaiknya mengandalkan label dan role bukan id asumtif.
- PiP floating window perlu `role="dialog"`, label yang lebih eksplisit, serta keyboard navigation/focus management agar usable tanpa mouse.
- Overlay kontrol video sengaja tidak menangkap pointer agar klik dapat masuk ke iframe. Ini mempertahankan playback provider, namun affordance kontrol overlay dapat terasa tidak konsisten pada mouse/touch; perlu uji manual lintas browser.
- UX sebaiknya memberi indikator jelas ketika data berasal dari snapshot stale dan ketika mirror provider sedang tidak tersedia.

## 6. Test yang dijalankan

### Existing suite

```text
npm run test:all
29 tests passed, 0 failed
search-key-audit: 14 titles, 108 positive keys, 0 failures
integration: daily/search/detail/streams/sourceIsolation passed
```

### Stress test lokal

Fixture lokal meniru response Animasu/YAOI. Dijalankan 500 request paralel:

- 100 `GET /api/health`
- 100 `GET /api/catalog?search=Demo&genre=`
- 100 `GET /api/anime/demo`
- 100 `GET /api/streams/nonton-demo-episode-1`
- 100 `GET /api/catalog?search=x&genre=`

Hasil:

```json
{
  "requests": 500,
  "statusCounts": { "200": 330, "429": 170 },
  "elapsedMs": 3324,
  "upstreamRequests": 6,
  "upstreamActive": 0,
  "upstreamQueued": 0,
  "pendingKeys": 0
}
```

Interpretasi: rate limit katalog bekerja sesuai desain 30 request/IP/menit; tidak ada 5xx dan queue kembali kosong. Cache/pending coalescing membatasi fan-out ke upstream.

### Security probes

- Secret/key grep pada source tracked: tidak ada credential ditemukan.
- `javascript:` dan `data:` pada iframe markup biasa: tidak masuk hasil mirror.
- Protocol-relative mirror `//evil.example/x`: dinormalisasi ke HTTPS dan tetap dianggap mirror; ini menegaskan perlunya domain allowlist/CSP bila aplikasi public.
- Malformed stream slug mengembalikan 502, bukan crash process.

## 7. Prioritas tindak lanjut

### P0 sebelum public exposure

1. Pasang authentication/access control di reverse proxy atau aplikasi.
2. Rate-limit semua route yang memicu upstream, terutama detail dan streams.
3. Batasi `frame-src`/validasi URL mirror dengan kebijakan domain yang disepakati.
4. Patch dependency `qs` melalui upgrade Express/lockfile yang kompatibel, lalu jalankan ulang seluruh suite.

### P1 untuk kualitas produk

1. Tambahkan browser E2E test untuk modal, episode switching, PiP handoff/close/pagehide, mobile layout, dan keyboard.
2. Tambahkan focus trap + focus restore pada modal/PiP.
3. Tambahkan landmark `<main>`, skip link, dan live region untuk search/error/status.
4. Tambahkan validation test untuk slug, URL protocol, control character, dan URL mirror malformed.

### P2 observability

1. Tambahkan metrics latency/error/cache hit untuk setiap endpoint.
2. Pisahkan status upstream blocked, timeout, empty page, dan parser mismatch.
3. Jangan log URL mirror lengkap bila tidak diperlukan; gunakan origin/hash untuk diagnosis.

## Kesimpulan

Fondasi aplikasi cukup baik untuk penggunaan personal/local: cache, stale fallback, source isolation, rate limit search, dan PiP seamless sudah diuji dan bekerja. Tidak ada API key yang bocor. Risiko terbesar muncul bila aplikasi dipublikasikan: endpoint tidak terautentikasi, rate limit belum merata, health terlalu informatif, validasi URL mirror belum berbasis allowlist, dan dependency chain Express/qs masih memiliki advisory moderat. Semua rekomendasi di atas dapat dikerjakan **tanpa mengubah mekanisme mirroring YAOI Animasu**.
