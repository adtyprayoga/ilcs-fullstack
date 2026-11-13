# MusicPedia

Toko Lagu digital PT Musika Indonesia. Istilah domain ada di [GLOSSARY.md](GLOSSARY.md), keputusan arsitektur di [docs/adr](docs/adr).

## Stack
- TypeScript strict dalam npm workspaces: `frontend`, `backend`, `shared`
- Frontend: React, Vite, Tailwind CSS v4, React Router
- Backend: Express, dijalankan langsung oleh Node dengan type stripping (tanpa build)
- Database: PostgreSQL lewat `pg` tanpa ORM, migrasi dengan `node-pg-migrate`
- Antrean: RabbitMQ (`amqplib`) untuk Email Selamat Datang, dikirim lewat SMTP sandbox Mailtrap (`nodemailer`)
- `shared`: skema zod yang diimpor frontend dan backend
- Tes: Vitest, Supertest, dan Testing Library

Alasan pemilihan: [ADR 0002](docs/adr/0002-tech-stack.md).

## Setup pengembangan
Prasyarat: Docker dan Docker Compose. Backend dan frontend berjalan di dalam container, dan image pengembangan sudah membawa ffmpeg untuk seed serta unggahan Lagu, jadi host tidak perlu memasang Node atau ffmpeg.

```sh
cp .env.example .env   # opsional, nilai bawaan sudah cocok dengan Docker Compose
npm run dev            # PostgreSQL, RabbitMQ, backend (:3000), worker email, dan frontend (:5173)
npm run seed           # Data Demo lengkap (lihat bagian berikut), di terminal lain
```

`npm run dev` menjalankan `docker compose up --build -V` di depan terminal: log semua service tampil berselang-seling dan Ctrl+C menghentikan semuanya. Opsi `-V` memperbarui volume `node_modules` di dalam container, jadi setelah mengubah dependensi cukup jalankan ulang perintah yang sama. Buka http://localhost:5173. Halaman awal menampilkan katalog Lagu dari `/api/lagu` di dalam header berisi status sesi (frontend memakai proxy Vite ke `/api`, yang di dalam Compose menunjuk ke service `backend`). Watcher frontend memakai inotify, yang berjalan di Linux dan WSL. Di Docker Desktop, setel `VITE_USE_POLLING=true` saat menjalankan `npm run dev` bila perubahan berkas tidak terdeteksi.

`npm test` dan `npm run seed` juga berjalan di dalam container. `npm run seed` membutuhkan stack yang sedang berjalan. Audio Data Demo dan unggahan Admin tersimpan di `./backend/audio` pada host.

Bila sudah punya Node dan ffmpeg di host dan ingin menjalankan backend, worker email, serta frontend di luar container, pakai `npm install` lalu `npm run dev:local`. Versi host memakai PostgreSQL dan RabbitMQ dari Compose dan `FFMPEG_PATH` dari `.env`; seed gagal dengan pesan yang menyebut `FFMPEG_PATH` bila biner tidak bisa dijalankan. Audio tidak pernah di-commit ke repo.

`dockscope` (antarmuka monitoring container) tidak ikut `npm run dev`. Jalankan dengan `docker compose --profile tools up -d dockscope`, lalu buka http://localhost:4681.

## Akun dan sesi
- Registrasi hanya membuat Pelanggan. Admin tidak pernah dibuat lewat registrasi. Pelanggan baru menerima Email Selamat Datang (lihat bagian berikut).
- Tabel `akun` menyimpan `nama` (teks, default kosong sampai Pelanggan mengisi profilnya sendiri). Kolom ini dipakai halaman profil Pelanggan dan area Admin untuk mencari serta mengubah data Pelanggan.
- Sesi disimpan di tabel `sesi` PostgreSQL lewat cookie `musicpedia.sid` (`httpOnly`, `SameSite=Lax`, `Secure` bila `NODE_ENV=production`). Alasannya ada di [ADR 0003](docs/adr/0003-sesi-di-postgresql.md).
- `SESSION_SECRET` wajib diisi di produksi, minimal 32 karakter. `ADMIN_PASSWORD` juga wajib diisi saat menjalankan seed di produksi.

## Email Selamat Datang
Registrasi menerbitkan pesan ke RabbitMQ lalu langsung menjawab `201`. Service `worker` mengambil pesan dari antrean `email` dan mengirim email. Desain, dedupe, dan jawaban "banyak consumer, templat yang sama" ada di [ADR 0005](docs/adr/0005-email-selamat-datang-lewat-rabbitmq.md).

- Tanpa kredensial Mailtrap, worker hanya mencetak email ke log: `docker compose logs -f worker`.
- Untuk melihat email di inbox uji, buat inbox di Mailtrap **Sandboxes**, salin kredensial SMTP dari tab **Integration**, lalu isi `MAILTRAP_SMTP_USER` dan `MAILTRAP_SMTP_PASS` di `.env`. Email masuk ke inbox sandbox, tidak pernah ke penerima sungguhan.
- RabbitMQ UI ada di http://localhost:15673 (guest/guest). AMQP dipublikasikan di port host 5673; port host digeser agar tidak bentrok dengan RabbitMQ lain.
- Jalankan beberapa worker sekaligus dengan `docker compose up -d --scale worker=3`. Semua replika membaca antrean yang sama, sehingga setiap Pelanggan tetap menerima satu email.
- Kegagalan Mailtrap dicoba ulang setiap 10 detik, paling banyak 3 percobaan, lalu pesannya diparkir di antrean `email.gagal`. Baris `email_terkirim` berstatus `MENGIRIM` yang tertinggal menandai worker yang mati di tengah pengiriman.
- Registrasi tetap berhasil bila RabbitMQ mati; kegagalan publish dicatat di log backend dan Pelanggan itu tidak menerima Email Selamat Datang.
- Log pengiriman hanya memuat id Pelanggan, tidak pernah alamat email.

## Data Demo
`npm run seed` idempoten: menjalankannya berulang kali tidak menggandakan akun, Genre, Lagu, Pembelian, maupun berkas audio. Seed melakukan lima langkah: Admin, Pelanggan, katalog, audio, lalu Pembelian.

| Peran | Email | Kata sandi | Keterangan |
| --- | --- | --- | --- |
| Admin | `admin@musicpedia.id` | `admin12345` (atau `ADMIN_PASSWORD`) | Membuat akun hanya lewat seed |
| Pelanggan | `budi@musicpedia.id` | `pelanggan12345` | Aktif; punya 4 Lagu dari 2 Pembelian Lunas |
| Pelanggan | `siti@musicpedia.id` | `pelanggan12345` | Aktif; punya 2 Lagu Lunas, 1 Pembelian Menunggu Pembayaran, 1 Gagal |
| Pelanggan | `andi@musicpedia.id` | `pelanggan12345` | Nonaktif; punya 1 Pembelian Gagal |

Isi Data Demo:
- 5 Genre dan 10 Lagu sintetis. Setiap Lagu mendapat mp3 orisinal hasil sintesis nada (bukan rekaman pihak lain) dan Trial 30 detik yang dibuat lewat pipeline ffmpeg yang sama dengan unggahan Admin. Berkasnya deterministik dan tidak di-commit.
- 6 Pembelian: 3 Lunas, 1 Menunggu Pembayaran, 2 Gagal. Item Pembelian menyimpan harga saat checkout, dan hanya Pembelian Lunas yang punya `dibayar_pada`.
- Tanggal Pembelian Lunas dihitung dari waktu seed agar Laporan Penjualan bulan berjalan langsung berisi 6 baris dengan total Rp 155.000. Baris yang sudah ada tidak diubah saat seed dijalankan ulang.
- Pembelian Menunggu Pembayaran memiliki token Snap contoh agar halaman riwayat bisa mencoba tombol lanjutkan. Token itu bukan token Midtrans sungguhan.

Kata sandi Data Demo hanya untuk demo. Ganti `ADMIN_PASSWORD` dan kata sandi Pelanggan sebelum memakai lingkungan yang bisa diakses publik.

## Audio dan Trial
- Admin menambah Lagu lewat area Admin (`/admin/lagu`) dengan mengunggah mp3. ffmpeg memvalidasi berkas lalu membuat Trial berdurasi paling lama 30 detik.
- `AUDIO_DIR` menyimpan mp3 dan Trial di luar web root; database hanya mencatat path relatifnya. `FFMPEG_PATH` menunjuk biner ffmpeg (bawaannya `ffmpeg` di PATH).
- Trial hanya bisa di-stream lewat `/api/lagu/:id/trial` untuk Lagu yang tidak disembunyikan. mp3 penuh tidak pernah disajikan endpoint publik.
- Alasan dan konsekuensinya ada di [ADR 0004](docs/adr/0004-penyimpanan-audio-dan-trial.md).

## Area Admin
- Admin mengelola Pelanggan di `/admin/pelanggan`: daftar dengan pencarian nama atau email dan paginasi, ubah nama/email, serta nonaktifkan dan aktifkan kembali.
- Admin mengelola Lagu di `/admin/lagu` dan Genre di `/admin/genre`, termasuk menyembunyikan Lagu dan menghapus Genre yang belum dipakai.
- Pelanggan tidak pernah dihapus; API tidak menyediakan endpoint hapus. Menonaktifkan Pelanggan langsung memutus sesi aktifnya pada request berikutnya (ADR 0003), dan mengaktifkannya kembali membuat Pelanggan bisa login lagi.
- Akun Admin tidak pernah muncul di daftar Pelanggan. Admin juga tidak dapat menonaktifkan akunnya sendiri lewat area ini.

## Pembelian dan Midtrans
- Pelanggan menekan **Checkout dan bayar** di Keranjang. Keranjang menjadi satu Pembelian berstatus Menunggu Pembayaran dan halaman Snap dibuka dengan token dari server.
- Checkout berjalan dalam satu transaksi DB: baris Pelanggan dikunci (`SELECT … FOR UPDATE`), aturan Keranjang divalidasi ulang, Pembelian dan Item Pembelian dibuat dengan harga saat checkout, Keranjang dikosongkan, lalu token Snap diminta dengan masa berlaku 24 jam. Bila gateway gagal, semuanya di-rollback.
- Riwayat Pembelian ada di `/pembelian`. Pembelian Menunggu Pembayaran bisa dilanjutkan dengan token Snap yang tersimpan, tanpa membuat transaksi baru.
- `MIDTRANS_SERVER_KEY` hanya ada di server. Frontend memuat `MIDTRANS_CLIENT_KEY` dan URL snap.js lewat `GET /api/konfigurasi`.
- `MIDTRANS_PRODUCTION=true` memakai endpoint Midtrans produksi; nilai lain memakai sandbox.
- Katalog bisa diurutkan Terlaris lewat `GET /api/lagu?urutan=terlaris`: jumlah Pembelian Lunas yang memuat Lagu itu, lalu Terbaru sebagai penentu seri. Lagu tanpa penjualan ada di akhir.

### Webhook Midtrans
`POST /api/webhook/midtrans` menerima notifikasi Midtrans dan memindahkan Pembelian dari Menunggu Pembayaran ke Lunas atau Gagal.

- Endpoint ini publik karena Midtrans tidak membawa sesi Pelanggan. Keaslian permintaan dijaga oleh `signature_key`, yaitu SHA-512 dari `order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY`. Signature salah ditolak `401` tanpa mengubah data.
- Isi notifikasi tidak dipercaya sendiri: status dicek ulang ke Status API Midtrans. `settlement`, atau `capture` dengan `fraud_status=accept`, membuat Pembelian Lunas dan mencatat waktu bayar. `deny`, `cancel`, dan `expire` membuatnya Gagal. `pending` dan status lain diabaikan, tetapi tetap dijawab `200` agar Midtrans berhenti mencoba ulang.
- Transisi hanya berlaku dari Menunggu Pembayaran, jadi notifikasi ganda atau terlambat tidak mengubah Pembelian yang sudah Lunas atau Gagal.
- Jangan pernah melemahkan pemeriksaan signature atau Status API untuk membuat demo lolos. Tanpa kredensial Midtrans, checkout memang gagal dengan `502 PAYMENT_GATEWAY_GAGAL` dan Keranjang tetap utuh.

### Menerima webhook Midtrans sandbox di mesin lokal
Midtrans tidak bisa menjangkau `localhost`, jadi saat dev gunakan tunnel cloudflared:

1. Pasang cloudflared: `brew install cloudflared` di macOS, atau unduh paket dari [rilis cloudflared](https://github.com/cloudflare/cloudflared/releases) di Linux/Windows.
2. Jalankan `npm run dev`, lalu di terminal lain jalankan `cloudflared tunnel --url http://localhost:3000`. Catat URL acak yang dicetak, misalnya `https://contoh-acak.trycloudflare.com`.
3. Di dashboard Midtrans sandbox, buka **Settings → Payment Notification URL** dan isi `https://contoh-acak.trycloudflare.com/api/webhook/midtrans`.
4. Pastikan `MIDTRANS_SERVER_KEY` di `.env` sama dengan server key sandbox yang dipakai Midtrans. Nilai ini dipakai untuk memverifikasi signature dan memanggil Status API.
5. Lakukan pembayaran uji lewat Snap sandbox. Notifikasi akan masuk ke backend dan status Pembelian berubah di halaman riwayat.

URL `trycloudflare.com` berganti setiap kali tunnel dijalankan ulang, jadi perbarui Payment Notification URL bila perlu. Untuk webhook dari mesin lokal ini `MIDTRANS_PRODUCTION` harus `false`.

## Produksi dengan Docker Compose
`docker-compose.prod.yml` menjalankan PostgreSQL bervolume, RabbitMQ bervolume, backend Node 26 + ffmpeg, worker Email Selamat Datang dari image backend yang sama, frontend hasil build Vite yang disajikan nginx, dan nginx sebagai reverse proxy `/api` sekaligus terminasi TLS. Worker menolak start bila `MAILTRAP_SMTP_USER`, `MAILTRAP_SMTP_PASS`, atau `APP_URL` kosong; isi juga `RABBITMQ_USER` dan `RABBITMQ_PASSWORD` di `.env.production`.

- `web` hanya membuka port HTTP/HTTPS. Backend dan database tidak dipublikasikan ke host.
- Image backend menjalankan migrasi lalu server produksi (`node backend/src/server.ts`), bukan mode dev. Healthcheck backend memanggil `/api/health`.
- Image frontend adalah multi-stage: build dengan Node 26, lalu disalin ke `nginx:1.27-alpine`.
- `db` dan `backend` memakai healthcheck; `depends_on` memakai `condition: service_healthy`.
- Data PostgreSQL ada di volume `pgdata`; audio ada di volume `audio` yang dipasang ke `/data/audio` backend.
- Secret hanya masuk lewat environment Compose dari `.env.production`. Tidak ada secret di Dockerfile, image, atau repo.

### Menyiapkan server
```sh
cp .env.production.example .env.production
# Isi POSTGRES_PASSWORD, SESSION_SECRET, ADMIN_PASSWORD, dan kredensial Midtrans.
openssl rand -base64 32     # contoh SESSION_SECRET
chmod 600 .env.production
```

`DATABASE_URL`, `AUDIO_DIR`, dan `FFMPEG_PATH` di dalam container diisi oleh Compose. `POSTGRES_PASSWORD` harus aman dipakai di URL (hindari karakter yang perlu di-encode, misalnya `@` atau `/`).

### Sertifikat TLS
Untuk uji lokal, buat sertifikat self-signed:
```sh
./scripts/gen-certs.sh
```
Script tidak menimpa sertifikat yang sudah ada dan menaruhnya di `certs/fullchain.pem` serta `certs/privkey.pem`. Direktori `certs/` di-mount read-only ke nginx dan di-ignore git.

Untuk produksi, ganti dengan sertifikat dari Let's Encrypt atau CA. Simpan rantai penuh di `certs/fullchain.pem` dan kunci privat di `certs/privkey.pem`, lalu:
```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec web nginx -s reload
```
Perpanjangan sertifikat (certbot/acme.sh) adalah urusan host; jalankan reload setelah sertifikat diperbarui.

### Menjalankan stack
```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Bila port 80/443 di host sudah terpakai, uji lokal dengan port lain:
```sh
HTTP_PORT=18080 HTTPS_PORT=18443 HTTPS_REDIRECT_PORT=:18443 \
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
```
`HTTPS_REDIRECT_PORT` kosong untuk HTTPS standar 443; isi `:18443` agar redirect HTTP menunjuk port uji.

Mengisi Data Demo di stack produksi (sekali atau berulang, tetap idempoten):
```sh
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T backend node backend/src/seed.ts
```
Seed di container menulis audio ke volume `audio`, jadi Trial dan Unduhan langsung berfungsi. Seed produksi menolak berjalan bila `ADMIN_PASSWORD` kosong.

Verifikasi:
```sh
curl -k https://localhost/api/health
curl -k https://localhost/api/lagu?ukuran=100
# TLS 1.2 dan 1.3 harus berhasil, TLS 1.1 harus gagal:
openssl s_client -connect localhost:443 -servername localhost -tls1_2 </dev/null
openssl s_client -connect localhost:443 -servername localhost -tls1_3 </dev/null
openssl s_client -connect localhost:443 -servername localhost -tls1_1 </dev/null
```

### Catatan keamanan
- nginx hanya mengizinkan TLS 1.2 dan 1.3 (`ssl_protocols TLSv1.2 TLSv1.3`), mengalihkan HTTP ke HTTPS, dan mengirim `X-Forwarded-Proto` agar cookie sesi `Secure` bekerja.
- `client_max_body_size 55m` memberi ruang unggahan mp3 50 MB. Backend tetap menolak berkas yang bukan audio valid.
- HSTS sengaja dikomentari di `frontend/nginx.conf.template`. Aktifkan setelah domain dan sertifikat produksi stabil.
- `docker-compose.prod.yml` memakai nama project `musicpedia-prod` agar tidak bertabrakan dengan Compose pengembangan.

## Backup dan Restore
Backup harian mencakup dua hal yang tidak boleh terpisah: dump PostgreSQL dan seluruh isi volume audio. Memulihkan database saja tidak memulihkan berkas mp3 dan Trial.

### Membuat backup
```sh
./scripts/backup.sh
```
Script membaca `.env.production` secara otomatis (atau variabel environment), lalu:
1. menjalankan `pg_dump --clean --if-exists --no-owner --no-privileges` di service `db`;
2. mengarsipkan `/data/audio` dari container backend ke `audio.tar.gz`;
3. menulis `manifest.txt` dan `SHA256SUMS`;
4. menyimpan ke `BACKUP_DIR/backup-YYYYMMDDTHHMMSSZ/`;
5. menyalin ke `BACKUP_OFFSITE_DIR` bila diisi, lalu ke remote rclone bila `BACKUP_RCLONE_REMOTE` diisi;
6. menghapus backup lokal yang lebih tua dari `BACKUP_KEEP_DAYS` (bawaan 14 hari).

Script berhenti dengan pesan `GAGAL` bila database/backend tidak berjalan, dump kosong, dump tidak lengkap, atau arsip audio kosong. Di produksi (`NODE_ENV=production`), script juga berhenti sebelum memulai bila tidak ada tujuan off-site: isi `BACKUP_RCLONE_REMOTE` atau `BACKUP_OFFSITE_DIR`. Ini mencegah backup hanya menumpuk di disk server yang sama.

Variabel penting:
| Variabel | Arti |
| --- | --- |
| `BACKUP_DIR` | Tujuan lokal, misalnya `/var/backups/musicpedia` |
| `BACKUP_KEEP_DAYS` | Retensi backup lokal dan remote |
| `BACKUP_RCLONE_REMOTE` | Remote rclone tujuan off-site, misalnya `offsite:musicpedia-backup` |
| `BACKUP_OFFSITE_DIR` | Direktori off-site alternatif, misalnya mount NFS/SSHFS dari host lain |
| `NODE_ENV` | `production` mewajibkan salah satu tujuan off-site |
| `ENV_FILE` | Bawaan `.env.production`; isi kosong untuk memakai environment shell saja |

Contoh off-site dengan rclone:
```sh
rclone config       # buat remote bernama offsite
BACKUP_RCLONE_REMOTE=offsite:musicpedia-backup ./scripts/backup.sh
rclone ls offsite:musicpedia-backup
```
Alternatif tanpa rclone: mount direktori host lain (NFS/SSHFS) lalu isi `BACKUP_OFFSITE_DIR`. `BACKUP_DIR` sendiri tidak dianggap off-site. Backup yang hanya berada di volume/disk server yang sama belum memenuhi NFR Security #3.

### Menjadwalkan setiap 24 jam
Cron (pukul 02:17 waktu server):
```cron
17 2 * * * cd /opt/musicpedia && ./scripts/backup.sh >> /var/log/musicpedia-backup.log 2>&1
```

Systemd timer (lebih mudah dipantau):
```sh
sudo cp deploy/systemd/musicpedia-backup.service deploy/systemd/musicpedia-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now musicpedia-backup.timer
systemctl list-timers musicpedia-backup.timer
```
Sesuaikan `User` dan `WorkingDirectory` di unit service dengan pemilik repo di server. Timer berjalan tiap hari pukul 02:17, `Persistent=true` menjalankan backup yang terlewat setelah server mati, dan `RandomizedDelaySec` menyebarkan beban.

### Memulihkan
```sh
KONFIRMASI_RESTORE=ya ./scripts/restore.sh backups/backup-20261112T130317Z
# atau backup lokal terbaru:
KONFIRMASI_RESTORE=ya ./scripts/restore.sh
```
Restore sengaja menolak berjalan tanpa `KONFIRMASI_RESTORE=ya`. Script:
1. memeriksa `database.sql`, `audio.tar.gz`, dan checksum `SHA256SUMS` bila ada;
2. menghentikan backend agar tidak menulis saat restore;
3. memulihkan dump dengan `psql -1 -v ON_ERROR_STOP=1` (satu transaksi);
4. mengosongkan lalu mengekstrak volume audio lewat container satu kali;
5. menyalakan backend lagi dan menunggu healthcheck;
6. memverifikasi koneksi database.

Buat backup baru sebelum restore bila data saat ini masih dibutuhkan. Uji restore berkala di server terpisah; backup yang belum pernah diuji restore belum bisa diandalkan.

### Uji roundtrip yang sudah dilakukan
Backup/restore diuji pada 12 November 2026 terhadap stack produksi lokal dan terhadap database/audio pengembangan di host.

Stack produksi (volume Docker):
```sh
./scripts/backup.sh
# backup-20261112T130317Z: database.sql 18.548 byte, audio.tar.gz 4,4 MB, 20 berkas audio (mp3 + Trial)
docker compose ... exec -T db psql ... -c "UPDATE lagu SET judul='RUSAK' ..." \
  -c "DELETE FROM item_pembelian ..."
docker compose ... exec -T backend rm -f /data/audio/mp3/seed-cahaya-pagi.mp3
KONFIRMASI_RESTORE=ya ./scripts/restore.sh /tmp/opencode/mp-backups/backup-20261112T130317Z
```
Hasil: judul kembali `Cahaya Pagi`, jumlah Item Pembelian kembali 10, 10 berkas mp3 kembali, unduhan `/api/lagu/1/unduh` menjawab `200 audio/mpeg` (280.494 byte), dan `/api/health` sehat.

Database/audio pengembangan (mode host):
```sh
COMPOSE_FILE=docker-compose.yml ENV_FILE= \
  POSTGRES_DB=musicpedia_backup_test AUDIO_HOST_DIR=/tmp/opencode/mp-audio-backup-test \
  BACKUP_DIR=/tmp/opencode/mp-backups-dev ./scripts/backup.sh
# backup-20261112T130506Z: 20 berkas audio (mp3 + Trial)

# rusakkan data: ubah judul, hapus 2 Item Pembelian, hapus satu mp3
COMPOSE_FILE=docker-compose.yml ENV_FILE= \
  POSTGRES_DB=musicpedia_backup_test AUDIO_HOST_DIR=/tmp/opencode/mp-audio-backup-test \
  BACKUP_DIR=/tmp/opencode/mp-backups-dev KONFIRMASI_RESTORE=ya \
  ./scripts/restore.sh /tmp/opencode/mp-backups-dev/backup-20261112T130506Z
```
Hasil: judul `Cahaya Pagi` pulih, `item_pembelian` kembali 10, jumlah mp3 kembali 10, dan berkas `seed-cahaya-pagi.mp3` ada kembali.

## Alur Demo End-to-End
Demo punya dua lapis: alur yang **sudah diverifikasi lokal tanpa kredensial Midtrans**, dan pembayaran sandbox yang **memerlukan kunci sandbox milik operator**. Jalur gateway tidak di-fake; tanpa kunci, checkout berhenti dengan pesan yang jelas.

### Menyiapkan stack demo
```sh
cp .env.production.example .env.production
# Isi minimal: SESSION_SECRET, POSTGRES_PASSWORD, ADMIN_PASSWORD.
# Di produksi isi juga BACKUP_RCLONE_REMOTE atau BACKUP_OFFSITE_DIR untuk backup.
npm run certs
npm run prod:up
npm run prod:seed
```
Untuk pembayaran sandbox, isi juga di `.env.production` lalu jalankan ulang backend:
```sh
MIDTRANS_SERVER_KEY=<server key sandbox>
MIDTRANS_CLIENT_KEY=<client key sandbox>
MIDTRANS_PRODUCTION=false
```
```sh
npm run prod:up
```
`npm run prod:seed` bersifat idempoten: menjalankannya lagi memulihkan Data Demo ke tiga status (Menunggu Pembayaran dengan masa berlaku baru, Lunas, Gagal) tanpa membuat duplikat.

### Langkah demo
1. **Registrasi.** Buka `https://localhost:18443` (atau domain), pilih Registrasi, buat Pelanggan baru. Sesi langsung aktif. *Terverifikasi lokal via HTTPS.*
2. **Jelajah dan Trial.** Cari Lagu berdasarkan judul/Artis, filter Genre, urutkan Terbaru atau Terlaris, buka detail, dan putar Trial 30 detik. *Terverifikasi lokal (Trial 29,9 detik, `audio/mpeg`).*
3. **Keranjang.** Tambahkan dua Lagu berbeda. Keranjang tersimpan di server, bukan di browser, dan menolak Lagu yang sudah dimiliki atau sedang Menunggu Pembayaran. *Terverifikasi lokal.*
4. **Checkout tanpa kunci.** Buka Keranjang dan tekan **Checkout dan bayar** sebelum kunci Midtrans diisi: API menjawab `502 PAYMENT_GATEWAY_GAGAL` dan Keranjang tetap utuh (tidak ada Pembelian yatim). *Terverifikasi lokal; ini perilaku yang diharapkan.*
5. **Checkout dengan kunci sandbox.** Dengan `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY` sandbox terisi, checkout membuat satu Pembelian Menunggu Pembayaran (token Snap 24 jam) dan mengosongkan Keranjang. *Memerlukan kunci sandbox operator.*
6. **Bayar di sandbox.** Pilih metode pembayaran sandbox Midtrans (misalnya kartu uji `4811 1111 1111 1114` atau simulator QRIS/GoPay), selesaikan pembayaran. *Memerlukan kunci sandbox operator.*
7. **Webhook.** Untuk stack lokal di balik self-signed, jalankan tunnel ke nginx:
   ```sh
   cloudflared tunnel --url https://localhost:18443 --no-tls-verify
   ```
   Isi **Settings → Payment Notification URL** di dashboard Midtrans sandbox dengan `https://<url-tunnel>/api/webhook/midtrans`. Tanpa URL publik, status tidak akan berubah karena Midtrans tidak bisa menjangkau localhost. *Pemeriksaan signature sudah diverifikasi lokal: `signature_key` palsu ditolak `401 SIGNATURE_TIDAK_VALID`. Notifikasi asli dari Midtrans memerlukan kunci sandbox operator.*
8. **Lunas.** Webhook memverifikasi signature dan mengecek Status API. Pembelian berubah menjadi Lunas dan `dibayar_pada` tercatat. Buka `/pembelian` untuk melihat status. *Memerlukan kunci sandbox operator untuk transisi asli; status Lunas Data Demo sudah tersedia untuk langkah berikutnya.*
9. **Unduh.** Buka `/lagu-saya`, lalu unduh mp3. Nama berkas berbentuk `Artis - judul.mp3`; unduhan bisa diulang tanpa batas, termasuk untuk Lagu yang kemudian disembunyikan. *Terverifikasi lokal dengan akun `budi@musicpedia.id` (4 Lagu).*
10. **Laporan.** Login Admin, buka `/admin/laporan`, pilih rentang tanggal, lalu lihat baris Pembelian Lunas beserta kolom Harga dan Total. Unduh PDF dan Excel dari tombol ekspor. *Terverifikasi lokal: 6 baris, total Rp 155.000, PDF 1 halaman dan Excel berhasil.*
11. **Ulangi demo.** Jalankan `npm run prod:seed` lagi; Data Demo kembali ke kondisi semula tanpa duplikasi. Gunakan akun `budi@musicpedia.id` untuk mendemokan Unduhan dan Laporan tanpa menunggu Midtrans, karena Pembelian Lunas-nya sudah tersedia. *Terverifikasi lokal.*

### Hasil verifikasi stack produksi lokal
Yang sudah diverifikasi pada 12 November 2026:
- `docker compose ... up -d --wait`: database, backend, dan web sehat; HTTP `301` ke HTTPS.
- TLS 1.2 dan 1.3 berhasil; TLS 1.1 ditolak (`no protocols available`).
- `/api/health` menjawab `{"status":"ok","database":"up"}`, katalog berisi 10 Lagu, Trial dapat di-stream (29,9 detik, `audio/mpeg`).
- Registrasi, login, tambah Keranjang, dan tampilan Keranjang berjalan lewat HTTPS. Cookie sesi yang dikirim berisi `HttpOnly; Secure; SameSite=Lax`.
- Webhook dengan `signature_key` palsu ditolak `401 SIGNATURE_TIDAK_VALID`; pemeriksaan signature tidak dilemahkan.
- Checkout tanpa kredensial Midtrans menjawab `502 PAYMENT_GATEWAY_GAGAL` dan Keranjang tetap utuh. Ini diharapkan dan bukan jalur yang dilemahkan.
- Login `budi@musicpedia.id`, `GET /api/lagu-saya` berisi 4 Lagu, unduhan menjawab `200 audio/mpeg` dengan `Content-Disposition: attachment; filename="Rina Prasetya - Cahaya Pagi.mp3"`.
- Login Admin, Laporan Penjualan berisi 6 baris total Rp 155.000; ekspor PDF (1 halaman) dan Excel berhasil.
- Backup dan restore diuji pada stack produksi dan mode pengembangan seperti dicatat di atas.

Yang belum bisa diverifikasi di lingkungan ini: pembayaran Midtrans sandbox dan notifikasi webhook, karena tidak ada `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY` sandbox. Jalur gateway tidak di-fake dan signature tidak dilemahkan. Isi kredensial sandbox lalu ulangi langkah 5–8 untuk menyelesaikannya.

## Perintah
| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Build image pengembangan lalu jalankan PostgreSQL, backend, dan frontend di Compose |
| `npm run dev:local` | Backend dan frontend di host (butuh Node dan ffmpeg), PostgreSQL tetap di Compose |
| `npm test` | `tsc --noEmit` semua workspace, lalu Vitest di container backend (butuh Docker) |
| `npm run build` | Build frontend ke `frontend/dist` |
| `npm run migrate` | Menjalankan migrasi SQL di `backend/migrations` dari host (butuh `npm install`) |
| `npm run seed` | Menjalankan migrasi lalu mengisi seluruh Data Demo secara idempoten di container backend |
| `npm run db:up` | Menjalankan PostgreSQL saja |
| `npm run prod:up` | Build dan jalankan stack produksi dengan `.env.production` |
| `npm run prod:down` | Hentikan stack produksi (volume tetap) |
| `npm run prod:logs` | Ikuti log stack produksi |
| `npm run prod:seed` | Isi Data Demo di container backend produksi |
| `npm run certs` | Buat sertifikat self-signed bila belum ada |
| `npm run backup` | Backup database dan audio |
| `npm run restore -- <direktori>` | Restore; tetap membutuhkan `KONFIRMASI_RESTORE=ya` |

PostgreSQL dev berjalan di port 5433. Tes memakai database `musicpedia_test` yang dibuat ulang setiap kali dijalankan.
