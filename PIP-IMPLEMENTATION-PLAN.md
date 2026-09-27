# Rencana Perbaikan PiP iLoveNime

## Scope

Perbaikan hanya mencakup **UI/behavior PiP**. Mekanisme pengambilan mirror dari YAOI/Animasu tidak diubah.

Target:

- Iframe yang sedang diputar tetap menjadi **node iframe yang sama**.
- PiP dapat dipindahkan bebas ke kanan, kiri, atas, bawah, dan posisi mana pun di dalam viewport.
- Drag tidak menyebabkan reload, pergantian `src`, pause, atau kebutuhan klik ulang.
- Saat PiP ditutup, iframe yang sama kembali ke player utama tanpa jeda.
- Drag tidak mengganggu klik kontrol video atau kontrol mirror di dalam iframe.

## Desain interaksi

### Drag dengan mouse dan touch

- Area drag hanya pada `.pip-head`, bukan seluruh permukaan video.
- Pointer Events digunakan agar mouse, touch, dan stylus memakai satu jalur kode:
  - `pointerdown`: mulai drag dan aktifkan `setPointerCapture()`.
  - `pointermove`: hitung posisi baru.
  - `pointerup`/`pointercancel`: akhiri drag dan simpan posisi.
- Tombol Previous, Next, dan Close di header tidak memulai drag.
- Saat drag aktif:
  - `user-select: none` diterapkan pada PiP.
  - `cursor: grabbing` digunakan pada header.
  - animasi masuk/keluar tidak dijalankan ulang.
  - iframe tidak disentuh dan `src` tidak berubah.

### Posisi bebas di viewport

Posisi internal akan disimpan sebagai koordinat pixel kiri/atas:

```js
pipPosition = {
  left: number,
  top: number
}
```

Pergerakan dihitung dari offset pointer saat drag dimulai:

```text
nextLeft = pointerClientX - grabOffsetX
nextTop  = pointerClientY - grabOffsetY
```

Posisi selalu di-clamp agar seluruh frame tetap terlihat:

```js
left = Math.max(0, Math.min(nextLeft, viewportWidth - pipWidth));
top  = Math.max(0, Math.min(nextTop, viewportHeight - pipHeight));
```

Frame tidak akan dapat terseret keluar layar, termasuk pada mobile browser dengan viewport yang berubah karena address bar.

## Perubahan struktur UI

Header PiP perlu memiliki affordance drag yang jelas:

```html
<div class="pip-head" data-pip-drag-handle>
  <span class="pip-drag-hint" aria-hidden="true">⋮⋮</span>
  <span class="pip-title">...</span>
  <button data-pip-prev>...</button>
  <button data-pip-next>...</button>
  <button data-pip-close>...</button>
</div>
```

Rekomendasi aksesibilitas:

- Header diberi `aria-label="Pindahkan popup player"`.
- Tombol kontrol tetap dapat difokuskan dan tidak dianggap sebagai drag handle ketika diklik.
- Tambahkan opsi keyboard:
  - `Alt + ArrowLeft/Right/Up/Down`: memindahkan PiP bertahap.
  - `Alt + Home`: reset ke posisi kanan bawah.
- Tambahkan `aria-live` hanya untuk perubahan status penting, bukan setiap pixel drag.

## Strategi CSS

CSS saat ini menggunakan `right:20px; bottom:20px`. Setelah drag dimulai, posisi perlu memakai `left/top` agar tidak terjadi konflik dengan `right/bottom`.

Rencana:

1. Posisi awal tetap kanan bawah.
2. Saat PiP dibuat, ukur `getBoundingClientRect()`.
3. Konversi posisi awal menjadi `left/top`.
4. Hapus `right/bottom` melalui class atau inline style.
5. Selama drag, hanya update `left` dan `top`.
6. Gunakan `touch-action: none` pada header saja, bukan pada seluruh player.

Contoh state CSS:

```css
.pip-window {
  position: fixed;
  left: var(--pip-left);
  top: var(--pip-top);
  right: auto;
  bottom: auto;
}

.pip-window .pip-head {
  cursor: grab;
  touch-action: none;
}

.pip-window.is-dragging .pip-head {
  cursor: grabbing;
  user-select: none;
}
```

`touch-action: none` hanya pada header supaya video iframe tetap menerima gesture dan klik normal.

## Lifecycle tanpa jeda

### Membuka PiP

```text
Player utama
  -> cari iframe yang sedang aktif
  -> jangan ubah src
  -> ukur posisi awal
  -> pindahkan node iframe yang sama ke .pip-body
  -> pasang drag handlers
```

Tidak boleh dilakukan:

- membuat iframe baru;
- memanggil `loadMirror()` ulang;
- mengubah `iframe.src`;
- mengosongkan player sebelum iframe berpindah.

### Drag PiP

```text
pointerdown pada header
  -> simpan pointer offset
  -> pointer capture
  -> pointermove mengubah left/top
  -> iframe tetap terhubung pada browsing context yang sama
```

Drag hanya mengubah layout container. Tidak ada interaksi dengan jalur mirror.

### Menutup PiP

```text
PiP
  -> hentikan drag jika masih aktif
  -> pindahkan node iframe yang sama ke #playerBox
  -> pulihkan posisi player utama
  -> hapus container PiP setelah iframe sudah kembali
```

Urutan pemindahan iframe dilakukan sebelum animasi penutupan selesai agar tidak ada state di mana iframe hilang atau dibuat ulang.

### Menutup tab/window atau pagehide

- Tetap gunakan recovery handler.
- Jika iframe masih berada di PiP container yang akan hilang, pindahkan kembali ke `#playerBox`.
- Handler harus idempotent agar aman jika `closePipWindow()` dan `pagehide` berjalan berdekatan.

## Resize dan orientasi

PiP harus tetap terlihat ketika:

- browser di-resize;
- perangkat diputar portrait/landscape;
- keyboard virtual muncul di mobile;
- fullscreen browser berubah.

Pada `resize` dan `orientationchange`:

1. ukur ukuran PiP terbaru;
2. clamp `left/top` ke viewport baru;
3. jangan mengganti iframe atau source;
4. jangan menginterupsi playback.

Ukuran awal tetap responsif:

```css
width: min(420px, calc(100vw - 32px));
aspect-ratio: 16 / 9;
```

Jika viewport terlalu kecil, ukuran minimum perlu dibatasi agar header dan tombol tetap usable.

## Penyimpanan posisi

Rekomendasi: posisi terakhir disimpan hanya selama sesi browser menggunakan `sessionStorage`, bukan local storage permanen terlebih dahulu.

Contoh data:

```json
{
  "left": 840,
  "top": 620
}
```

Saat membuka PiP berikutnya:

- ambil posisi terakhir;
- clamp ke viewport saat ini;
- fallback ke kanan bawah jika data tidak valid atau viewport berubah terlalu banyak.

Menyimpan posisi di `sessionStorage` mencegah layout lama dari monitor besar memindahkan PiP keluar layar pada perangkat kecil.

## Acceptance criteria

### Playback continuity

- Membuka PiP tidak mengubah `iframe.src`.
- Membuka PiP tidak membuat elemen iframe kedua.
- Video tidak meminta klik play ulang.
- Menutup PiP mengembalikan elemen iframe yang sama.
- Tidak ada loading spinner atau flash kosong saat handoff.

### Drag

- Dapat digeser ke empat sisi viewport.
- Dapat diposisikan di area tengah dan posisi bebas lainnya.
- Tidak dapat keluar seluruhnya dari viewport.
- Berfungsi dengan mouse dan touch.
- Tombol Previous, Next, dan Close tetap dapat diklik.
- Drag header tidak memicu navigasi episode.
- Klik pada area video tetap diteruskan ke iframe.

### Episode switching

- Previous/Next tetap bekerja saat PiP dipindahkan ke posisi mana pun.
- Pergantian episode adalah satu-satunya kondisi normal yang boleh mengubah `iframe.src`.
- PiP tetap berada pada koordinat terakhir setelah episode berganti.
- Hanya episode baru yang boleh mengalami loading; handoff PiP tidak boleh loading ulang.

### Recovery

- Pagehide mengembalikan iframe ke player utama.
- Resize/orientation tidak membuat iframe reload.
- PiP close dipanggil dua kali tidak membuat error atau iframe duplikat.
- Jika browser tidak mendukung pointer capture, fallback tetap dapat mengakhiri drag pada `pointerup`/`pointercancel`.

## Test plan

### Unit/static test

1. Posisi awal dikonversi dari kanan-bawah ke `left/top`.
2. Fungsi clamp menangani viewport lebih kecil dari posisi tersimpan.
3. Tombol kontrol tidak memulai drag.
4. `src` tidak berubah selama open, drag, dan close.
5. `closePipWindow()` idempotent.
6. Tidak ada kode yang membuat iframe baru ketika membuka PiP.

### Browser E2E test

Dengan fixture iframe lokal:

1. Buka detail anime dan mulai episode.
2. Simpan referensi DOM iframe dan `src`.
3. Klik PiP.
4. Verifikasi iframe yang sama berpindah ke `.pip-body`.
5. Simulasikan drag dari header ke kanan atas.
6. Verifikasi posisi berada dalam viewport.
7. Drag ke kiri bawah dan tengah.
8. Klik Previous/Next; verifikasi PiP tetap terbuka dan posisi tidak berubah.
9. Tutup PiP; verifikasi objek iframe yang sama kembali ke `#playerBox`.
10. Verifikasi tidak ada iframe kedua dan tidak ada click-play recovery.
11. Ulangi dengan touch pointer.
12. Ulangi setelah resize/orientation change.

### Manual cross-browser

- Chrome desktop
- Edge desktop
- Firefox desktop
- Chrome Android
- Safari iOS bila tersedia

Native OS PiP tidak dijadikan acceptance criterion selama player masih berupa iframe cross-origin. Fallback yang benar adalah **seamless in-page draggable PiP**.

## Urutan implementasi

1. Refactor lifecycle PiP agar memiliki satu referensi iframe/session.
2. Tambahkan drag handle header dan pointer-event drag controller.
3. Ganti positioning `right/bottom` menjadi `left/top` setelah handoff pertama.
4. Tambahkan clamp saat drag, resize, dan orientation change.
5. Tambahkan keyboard move dan `sessionStorage` posisi.
6. Tambahkan recovery pagehide dan close idempotent.
7. Tambahkan unit/static tests.
8. Tambahkan browser E2E test menggunakan fixture lokal.
9. Verifikasi seluruh suite existing dan lakukan manual test pada layar desktop/mobile.

## Keputusan desain

PiP akan diposisikan sebagai **draggable in-page player dengan seamless iframe handoff**. Ini adalah satu-satunya pendekatan yang memenuhi syarat tanpa jeda dan tanpa klik ulang sambil tetap mempertahankan mirror YAOI/Animasu apa adanya. Native PiP di luar website hanya dapat ditambahkan jika sumber player memberikan elemen `<video>` yang dapat dikendalikan secara langsung.
