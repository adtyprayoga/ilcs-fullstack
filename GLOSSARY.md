# MusicPedia

MusicPedia adalah toko musik digital berbasis web milik PT Musika Indonesia. Pelanggan membeli lagu per judul lalu mengunduhnya sebagai mp3 untuk didengarkan secara offline.

## Pengguna

**Pengunjung**:
Orang yang membuka MusicPedia tanpa akun terdaftar.
_Avoid_: Guest, tamu, user

**Pelanggan**:
Orang yang sudah registrasi dan dapat membeli serta mengunduh Lagu. Pelanggan dapat dinonaktifkan, tetapi tidak pernah dihapus.
_Avoid_: Member, customer, user, akun

**Email Selamat Datang**:
Email yang dikirim satu kali kepada Pelanggan setelah registrasi berhasil. Admin dan Data Demo tidak menerimanya.
_Avoid_: Welcome email, email konfirmasi, email verifikasi

**Admin**:
Pegawai PT Musika Indonesia yang mengelola katalog, data Pelanggan, dan Laporan Penjualan. Akunnya tidak dibuat lewat registrasi.
_Avoid_: Operator, administrator sistem

## Demo

**Data Demo**:
Isi database dan audio contoh yang disiapkan `npm run seed` untuk mendemokan MusicPedia: Admin, Pelanggan, katalog Lagu, dan Pembelian di ketiga status. Seed ulang memulihkan Data Demo tanpa membuat duplikat.
_Avoid_: Seed data, fixture, data contoh

## Katalog

**Lagu**:
Satu judul musik dengan harga sendiri yang dijual di MusicPedia. Lagu dapat disembunyikan dari katalog, tetapi Lagu yang pernah terjual tidak pernah dihapus.
_Avoid_: Track, musik, audio, produk

**Artis**:
Nama pembawa sebuah Lagu, ditulis apa adanya (misalnya "A feat. B"). Setiap Lagu punya tepat satu Artis.
_Avoid_: Penyanyi, musisi, band

**Pencipta**:
Nama penulis lagu yang dicatat sebagai keterangan sebuah Lagu.
_Avoid_: Komposer, songwriter

**Label Rekaman**:
Perusahaan pemilik rekaman sebuah Lagu, yang memberi lisensi kepada PT Musika Indonesia untuk menjualnya.
_Avoid_: Label, publisher

**Trial**:
Cuplikan 30 detik dari sebuah Lagu yang hanya bisa di-stream dan tidak bisa diunduh.
_Avoid_: Preview, sample, demo

**Terbaru**:
Urutan Lagu berdasarkan tanggal rilis, dari yang paling baru.

**Terlaris**:
Urutan Lagu berdasarkan jumlah Pembelian Lunas yang memuat Lagu tersebut.
_Avoid_: Top, populer, chart

## Pembelian

**Keranjang**:
Kumpulan Lagu yang dipilih Pelanggan sebelum checkout. Keranjang tidak menerima Lagu yang sudah dimiliki atau yang sedang Menunggu Pembayaran.
_Avoid_: Cart, troli

**Pembelian**:
Satu transaksi pembayaran untuk satu atau lebih Lagu, dengan harga yang dicatat saat checkout.
_Avoid_: Order, pesanan, transaksi, transaksi penjualan, langganan

**Item Pembelian**:
Satu Lagu di dalam satu Pembelian, beserta harga Lagu itu saat checkout.
_Avoid_: Detail pembelian, order line, baris transaksi

**Menunggu Pembayaran**:
Status awal Pembelian, sebelum Payment Gateway mengonfirmasi hasil pembayaran.
_Avoid_: Pending, status pembayaran

**Lunas**:
Status akhir Pembelian yang sudah dibayar. Semua Lagu di dalamnya menjadi milik Pelanggan.
_Avoid_: Paid, sukses, settlement

**Gagal**:
Status akhir Pembelian yang tidak dibayar: ditolak, dibatalkan, kedaluwarsa, atau tidak dibayar dalam 24 jam. Pembelian yang Gagal tidak bisa dibuka lagi.
_Avoid_: Expired, batal, cancel

**Payment Gateway**:
Layanan eksternal (Midtrans) yang menerima pembayaran dan menentukan apakah Pembelian menjadi Lunas atau Gagal.

**Unduhan**:
Pengambilan file mp3 sebuah Lagu oleh Pelanggan yang memilikinya. Unduhan bisa diulang tanpa batas.
_Avoid_: Download, streaming

## Laporan

**Laporan Penjualan**:
Rekap Pembelian Lunas dalam rentang tanggal yang dipilih Admin.
_Avoid_: Laporan transaksi, rekap order
