# Email Selamat Datang lewat RabbitMQ, dengan tabel dedupe

Setelah registrasi berhasil, backend menerbitkan pesan `{ jenis: "SELAMAT_DATANG", akunId, email }` ke exchange `notifikasi` (direct) dengan routing key `email.selamat-datang`, lalu langsung menjawab `201`. Worker terpisah membaca antrean `email`, mengirim email lewat SMTP sandbox Mailtrap, dan baru meng-ack pesan setelah selesai. Sebelum mengirim, worker mengklaim kunci `selamat-datang:<akunId>` di tabel `email_terkirim`. Kunci yang sudah diklaim dilewati.

## Banyak consumer, templat yang sama

Pertanyaan yang memicu ADR ini: bila beberapa consumer mengirim templat email yang sama, apakah Pelanggan menerima email ganda? Jawabannya bergantung pada cara consumer diikat ke broker.

- **Beberapa consumer pada satu antrean (competing consumers).** RabbitMQ memberikan setiap pesan ke tepat satu consumer secara bergiliran. Menambah worker (`docker compose up -d --scale worker=3`) hanya membagi beban dan tidak menggandakan email. Semua replika worker MusicPedia membaca antrean `email` yang sama. Tes "tiga consumer pada satu antrean mengirim tepat satu email per Pelanggan" membuktikannya.
- **Beberapa antrean pada routing key yang sama (pub/sub).** Setiap antrean menerima salinan sendiri dari setiap pesan, sehingga setiap consumer mengirim email. Pola ini hanya tepat bila consumer mengerjakan hal berbeda, misalnya satu mengirim email dan satu mencatat analitik. Bila sebuah worker keliru mendeklarasikan antrean sendiri, tabel dedupe tetap menahan email kedua. Tes "dua antrean pada routing key yang sama" membuktikannya.
- **At-least-once delivery.** Worker yang mengirim email lalu mati sebelum ack membuat pesannya dikirim ulang ke worker lain. Penyebabnya bukan jumlah consumer, melainkan ack yang datang setelah efek samping eksternal. Tabel dedupe menutup celah ini.

Templatnya sendiri aman dipakai bersama: ia fungsi murni tanpa state yang hanya merender isi pesan.

## Alasan
- Registrasi tidak boleh lambat atau gagal karena layanan email. Penerbit menunggu konfirmasi broker paling lama 2 detik, lalu mencatat kegagalan (hanya id Pelanggan) dan tetap mengembalikan `201`.
- Email unik per Pelanggan, sehingga pembuatan Pelanggan hanya sukses sekali untuk satu alamat. Sisi penerbit tidak pernah menerbitkan duplikat. Duplikat hanya bisa datang dari sisi consumer, dan di sanalah dedupe dipasang.
- Klaim dibuat sebelum mengirim, bukan sesudahnya. Kami memilih **tanpa duplikat daripada tidak pernah hilang**: bila worker mati setelah klaim dan sebelum menandai `TERKIRIM`, kita tidak tahu apakah email sudah keluar. Pesan yang dikirim ulang melihat kunci `MENGIRIM` lalu melewatinya dengan peringatan di log. Email Selamat Datang tidak kritis, sedangkan email ganda langsung terlihat oleh Pelanggan. SMTP tidak menyediakan jaminan exactly-once, jadi salah satu sisi harus dikorbankan.
- Kegagalan Mailtrap biasanya sementara (sandbox membatasi laju kirim). Pesan dicoba ulang lewat antrean `email.tunda` dengan TTL tingkat antrean 10 detik, paling banyak 3 percobaan, lalu diparkir di `email.gagal`. TTL per pesan tidak dipakai karena RabbitMQ hanya mengedarkan pesan kedaluwarsa dari kepala antrean, sehingga jeda yang berbeda-beda bisa saling menahan.
- Pesan rusak tidak akan sembuh dengan dicoba ulang, jadi langsung diparkir di `email.gagal`.
- Worker adalah proses terpisah supaya bisa diskalakan tanpa menskalakan API, dan supaya API tidak memegang kredensial SMTP.

## Considered Options
- **Transactional outbox.** Baris outbox ditulis dalam transaksi yang sama dengan pembuatan Pelanggan, lalu relay menerbitkannya ke RabbitMQ. Tidak ada email yang hilang saat broker mati. Ditolak karena menambah relay dan tabel lagi demi email yang tidak kritis; cukup kegagalan publish dicatat.
- **Tanpa tabel dedupe (ack manual saja).** Lebih sederhana, tetapi redelivery setelah crash atau antrean pub/sub yang keliru langsung menghasilkan email ganda.
- **Klaim yang kedaluwarsa bisa diambil alih.** Klaim `MENGIRIM` yang lebih tua dari beberapa menit boleh dikirim ulang. Ditolak karena membuka kembali kemungkinan email ganda, yang justru ingin dicegah.
- **Mengirim email langsung dari handler registrasi.** Ditolak karena registrasi ikut lambat atau gagal saat Mailtrap bermasalah.
- **`noAck: true` seperti repo `belajar-nodejs-rabbitmq`.** Ditolak karena pesan hilang bila worker mati di tengah pengiriman (at-most-once).

## Consequences
- `npm test` membutuhkan RabbitMQ selain PostgreSQL. Compose sudah menyediakannya; setiap file tes memakai exchange dan antrean dengan nama unik agar tidak mengambil pesan dari worker pengembangan.
- Baris `MENGIRIM` yang tertinggal menandai email yang mungkin tidak terkirim dan perlu dicek manual: `SELECT * FROM email_terkirim WHERE status = 'MENGIRIM'`.
- Pesan di `email.gagal` dikirim ulang manual lewat RabbitMQ UI (Move messages ke antrean `email`) setelah penyebabnya diperbaiki. Hapus dulu klaimnya bila ada.
- Pelanggan yang registrasi saat broker mati tidak menerima Email Selamat Datang. Kegagalannya tercatat di log backend. Backend produksi sengaja tidak menunggu RabbitMQ sehat saat start, agar situs tetap melayani Pengunjung.
- Pesan yang gagal diproses karena gangguan database dikembalikan ke antrean setelah jeda 2 detik, sehingga gangguan singkat tidak menghilangkan email dan tidak membuat redelivery berputar cepat.
- Backend mendeklarasikan topologi saat publish pertama, bukan saat start; worker mendeklarasikannya saat start. Keduanya idempoten.
- Worker menyambung ulang sendiri saat koneksi ke broker putus. Di pengembangan worker berjalan di bawah `node --watch`, yang tidak keluar saat proses gagal, jadi restart policy Compose saja tidak cukup.
- Admin yang dibuat lewat seed, Data Demo, dan Pelanggan yang sudah ada tidak menerima Email Selamat Datang.
