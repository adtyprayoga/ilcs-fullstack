import pg from "pg";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPenerbitAmqp } from "./notifikasi/penerbit.ts";
import { TOPOLOGI_EMAIL } from "./notifikasi/topologi.ts";
import { mulaiPenyapu } from "./pembelian/penyapu.ts";

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });
pool.on("error", (error) => console.error("Pool error", error));
const penerbitEmail = createPenerbitAmqp({
  url: config.amqpUrl,
  topologi: TOPOLOGI_EMAIL,
});
const server = createApp({ pool, config, penerbitEmail }).listen(config.port, () => {
  console.log(`Backend listening on :${config.port}`);
});

// Penyapu Gagal hanya dijalankan di proses backend sungguhan, bukan saat tes.
const hentikanPenyapu = mulaiPenyapu(pool);

process.on("SIGTERM", () => {
  hentikanPenyapu();
  server.close(() => {
    void penerbitEmail.tutup();
    void pool.end();
  });
});
