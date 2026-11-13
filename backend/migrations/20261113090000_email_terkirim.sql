-- Up Migration

-- Catatan pengiriman email untuk mencegah email ganda. Worker mengklaim kunci
-- (misalnya "selamat-datang:42") sebelum mengirim; redelivery RabbitMQ atau
-- worker lain yang menerima pesan yang sama melihat kunci sudah diklaim lalu
-- melewatinya. Tanpa FK ke akun: tabel ini log pengiriman, bukan data domain.
CREATE TABLE email_terkirim (
  kunci text PRIMARY KEY,
  -- MENGIRIM yang tertinggal berarti worker crash di tengah pengiriman.
  status text NOT NULL DEFAULT 'MENGIRIM'
    CHECK (status IN ('MENGIRIM', 'TERKIRIM')),
  diklaim_pada timestamptz NOT NULL DEFAULT now(),
  terkirim_pada timestamptz
);

-- Down Migration

DROP TABLE email_terkirim;
