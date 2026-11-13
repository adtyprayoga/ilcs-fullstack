import pg from "pg";
import {
  kredensialMailtrapTerisi,
  loadConfig,
  periksaKonfigurasiWorker,
} from "./config.ts";
import { pesanError } from "./errors.ts";
import { sambungDenganTopologi } from "./notifikasi/amqp.ts";
import { mulaiKonsumenEmail } from "./notifikasi/konsumen.ts";
import {
  createPengirimKonsol,
  createPengirimMailtrap,
} from "./notifikasi/pengirim-email.ts";
import { TOPOLOGI_EMAIL } from "./notifikasi/topologi.ts";

const JEDA_SAMBUNG_AWAL_MS = 1000;
const JEDA_SAMBUNG_MAKS_MS = 15_000;

/**
 * Worker Email Selamat Datang. Proses terpisah dari API supaya bisa diskalakan
 * sendiri (`docker compose up --scale worker=3`): semua replika membaca antrean
 * yang sama, dan RabbitMQ memberikan setiap pesan ke satu replika saja.
 *
 * Saat koneksi atau channel ditutup broker, worker menyambung ulang sendiri
 * dengan jeda yang makin panjang. Di pengembangan worker berjalan di bawah
 * `node --watch`, yang tidak keluar saat proses gagal, jadi restart policy
 * Compose tidak bisa diandalkan untuk menyambung ulang.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  periksaKonfigurasiWorker(config);

  const pakaiMailtrap = kredensialMailtrapTerisi(config);
  if (!pakaiMailtrap) {
    console.warn(
      "MAILTRAP_SMTP_USER/MAILTRAP_SMTP_PASS kosong: email hanya dicetak ke log worker.",
    );
  }
  const pengirim = pakaiMailtrap
    ? createPengirimMailtrap(config)
    : createPengirimKonsol();

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  pool.on("error", (error) => console.error("Pool error", error));

  let berhenti = false;
  let tutupAktif: (() => Promise<void>) | undefined;
  const matikan = () => {
    berhenti = true;
    void tutupAktif?.();
  };
  process.on("SIGTERM", matikan);
  process.on("SIGINT", matikan);

  /** Menyambung dan mulai mengonsumsi; resolve saat koneksi atau channel tertutup. */
  async function sambungDanKonsumsi(): Promise<Promise<void>> {
    const { koneksi, channel } = await sambungDenganTopologi(
      config.amqpUrl,
      TOPOLOGI_EMAIL,
    );
    // Broker bisa menutup channel saja (misalnya 404 karena antrean dihapus)
    // sementara koneksinya tetap hidup: tanpa ini worker berhenti mengonsumsi
    // tanpa jejak.
    channel.on("error", (error: unknown) => {
      console.error(`Channel RabbitMQ ditutup broker: ${pesanError(error)}`);
    });
    const tertutup = new Promise<void>((resolve) => {
      koneksi.on("close", () => resolve());
      channel.on("close", () => resolve());
    });
    try {
      const hentikan = await mulaiKonsumenEmail({
        channel,
        pool,
        pengirim,
        topologi: TOPOLOGI_EMAIL,
        appUrl: config.appUrl,
      });
      tutupAktif = async () => {
        await hentikan();
        await koneksi.close().catch(() => {});
      };
    } catch (error) {
      await koneksi.close().catch(() => {});
      throw error;
    }
    console.log(
      `Worker email menunggu pesan di antrean ${TOPOLOGI_EMAIL.queue} (${pakaiMailtrap ? "Mailtrap" : "konsol"}).`,
    );
    return tertutup.then(() => koneksi.close().catch(() => {}));
  }

  let jeda = JEDA_SAMBUNG_AWAL_MS;
  while (!berhenti) {
    try {
      const tertutup = await sambungDanKonsumsi();
      // SIGTERM bisa tiba saat masih menyambung, sebelum tutupAktif terpasang.
      if (berhenti) await tutupAktif?.();
      jeda = JEDA_SAMBUNG_AWAL_MS;
      await tertutup;
      tutupAktif = undefined;
      if (berhenti) break;
      console.error("Koneksi RabbitMQ terputus; menyambung ulang.");
    } catch (error) {
      console.error(`${pesanError(error)}. Mencoba lagi dalam ${jeda} ms.`);
    }
    if (berhenti) break;
    await new Promise((r) => setTimeout(r, jeda));
    jeda = Math.min(jeda * 2, JEDA_SAMBUNG_MAKS_MS);
  }
  await pool.end();
}

try {
  await main();
} catch (error) {
  // Hanya kesalahan konfigurasi yang sampai ke sini; worker tidak bisa jalan.
  console.error(pesanError(error));
  process.exit(1);
}
