import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import type { Pool } from "../src/db.ts";
import {
  connect,
  openChannel,
  sambungDenganTopologi,
  type Sambungan,
} from "../src/notifikasi/amqp.ts";
import { mulaiKonsumenEmail } from "../src/notifikasi/konsumen.ts";
import {
  createPenerbitAmqp,
  type PenerbitEmail,
} from "../src/notifikasi/penerbit.ts";
import type {
  PengirimEmail,
  SuratEmail,
} from "../src/notifikasi/pengirim-email.ts";
import {
  siapkanTopologi,
  type Topologi,
} from "../src/notifikasi/topologi.ts";

/** Log senyap yang tetap mencatat, agar tes bisa memeriksa peringatan. */
export function buatLogUji() {
  const baris: string[] = [];
  const catat = (...isi: unknown[]) => {
    baris.push(isi.map(String).join(" "));
  };
  return { baris, log: catat, warn: catat, error: catat };
}

export interface EmailUji {
  url: string;
  topologi: Topologi;
  appUrl: string;
  penerbit: PenerbitEmail;
  logPenerbit: ReturnType<typeof buatLogUji>;
  /** Menerbitkan isi apa adanya ke exchange uji, melewati penerbit aplikasi. */
  terbitkanMentah(isi: unknown, headers?: Record<string, unknown>): Promise<void>;
  /** Mengambil semua pesan yang diparkir di antrean gagal. */
  ambilGagal(): Promise<Array<{ isi: unknown; headers: Record<string, unknown> }>>;
  jumlahPesan(queue: string): Promise<number>;
  hapusAntrean(queue: string): Promise<void>;
  /**
   * Antrean kedua yang diikat ke routing key yang sama (pola pub/sub): setiap
   * antrean menerima salinan sendiri dari setiap pesan.
   */
  buatAntreanTambahan(): Promise<string>;
  kosongkanAntrean(): Promise<void>;
  tutup(): Promise<void>;
}

/**
 * Topologi unik per file tes dengan jeda ulang pendek, supaya tes tidak pernah
 * mengambil pesan dari worker pengembangan yang sedang berjalan.
 */
export function siapkanEmailUji(): EmailUji {
  const url = loadConfig().amqpUrl;
  const akhiran = randomUUID().slice(0, 8);
  const topologi: Topologi = {
    exchange: `uji.notifikasi.${akhiran}`,
    routingKey: "email.selamat-datang",
    queue: `uji.email.${akhiran}`,
    queueTunda: `uji.email.tunda.${akhiran}`,
    queueGagal: `uji.email.gagal.${akhiran}`,
    jedaUlangMs: 100,
  };
  const logPenerbit = buatLogUji();
  const penerbit = createPenerbitAmqp({ url, topologi, log: logPenerbit });
  let koneksi: Promise<Sambungan> | undefined;
  const antreanTambahan: string[] = [];

  function kanal() {
    koneksi ??= sambungDenganTopologi(url, topologi);
    return koneksi;
  }

  return {
    url,
    topologi,
    appUrl: "https://musicpedia.uji",
    penerbit,
    logPenerbit,
    async terbitkanMentah(isi, headers = {}) {
      const { channel: ch } = await kanal();
      const konten =
        typeof isi === "string" ? Buffer.from(isi) : Buffer.from(JSON.stringify(isi));
      ch.publish(topologi.exchange, topologi.routingKey, konten, {
        persistent: true,
        headers,
      });
      await ch.waitForConfirms();
    },
    async ambilGagal() {
      const { channel: ch } = await kanal();
      const hasil: Array<{ isi: unknown; headers: Record<string, unknown> }> = [];
      for (;;) {
        const pesan = await ch.get(topologi.queueGagal, { noAck: true });
        if (pesan === false) return hasil;
        const teks = pesan.content.toString();
        let isi: unknown = teks;
        try {
          isi = JSON.parse(teks);
        } catch {
          // Payload rusak disimpan sebagai teks.
        }
        hasil.push({ isi, headers: pesan.properties.headers ?? {} });
      }
    },
    async hapusAntrean(queue) {
      const { channel: ch } = await kanal();
      await ch.deleteQueue(queue);
    },
    async jumlahPesan(queue) {
      const { channel: ch } = await kanal();
      return (await ch.checkQueue(queue)).messageCount;
    },
    async buatAntreanTambahan() {
      const { channel: ch } = await kanal();
      const queue = `${topologi.queue}.salinan.${antreanTambahan.length}`;
      // RabbitMQ 4 menolak antrean transient non-eksklusif; antrean ini
      // durable dan dihapus oleh kosongkanAntrean/tutup.
      await ch.assertQueue(queue, { durable: true });
      await ch.bindQueue(queue, topologi.exchange, topologi.routingKey);
      antreanTambahan.push(queue);
      return queue;
    },
    async kosongkanAntrean() {
      const { channel: ch } = await kanal();
      // Tes sebelumnya mungkin menghapus antrean; deklarasikan ulang dulu.
      await siapkanTopologi(ch, topologi);
      for (const queue of [topologi.queue, topologi.queueTunda, topologi.queueGagal]) {
        await ch.purgeQueue(queue);
      }
      // Antrean salinan hanya berlaku untuk satu tes.
      for (const queue of antreanTambahan.splice(0)) {
        await ch.deleteQueue(queue).catch(() => {});
      }
    },
    async tutup() {
      await penerbit.tutup();
      if (!koneksi) return;
      const { koneksi: conn, channel: ch } = await koneksi;
      for (const queue of [
        topologi.queue,
        topologi.queueTunda,
        topologi.queueGagal,
        ...antreanTambahan,
      ]) {
        await ch.deleteQueue(queue).catch(() => {});
      }
      await ch.deleteExchange(topologi.exchange).catch(() => {});
      await conn.close().catch(() => {});
    },
  };
}

export interface PengirimPalsu extends PengirimEmail {
  terkirim: SuratEmail[];
  percobaan: number;
  /** Gagalkan `n` pengiriman berikutnya; `Infinity` untuk selalu gagal. */
  aturGagal(n: number): void;
  reset(): void;
}

export function buatPengirimPalsu(): PengirimPalsu {
  let sisaGagal = 0;
  const palsu: PengirimPalsu = {
    terkirim: [],
    percobaan: 0,
    aturGagal(n) {
      sisaGagal = n;
    },
    reset() {
      palsu.terkirim.length = 0;
      palsu.percobaan = 0;
      sisaGagal = 0;
    },
    async kirim(surat) {
      palsu.percobaan += 1;
      if (sisaGagal > 0) {
        sisaGagal -= 1;
        throw new Error("Mailtrap tidak dapat dihubungi");
      }
      palsu.terkirim.push(surat);
    },
  };
  return palsu;
}

export interface KonsumenUji {
  log: ReturnType<typeof buatLogUji>;
  /** Resolve saat channel salah satu consumer tertutup. */
  channelTertutup: Promise<void>;
  hentikan(): Promise<void>;
}

/**
 * Menjalankan `jumlah` consumer di dalam proses tes, masing-masing dengan
 * channel sendiri pada antrean `queue` (bawaan: antrean email uji).
 */
export async function jalankanKonsumen({
  email,
  pool,
  pengirim,
  jumlah = 1,
  queue = email.topologi.queue,
}: {
  email: EmailUji;
  pool: Pool;
  pengirim: PengirimEmail;
  jumlah?: number;
  queue?: string;
}): Promise<KonsumenUji> {
  const log = buatLogUji();
  const conn = await connect(email.url);
  const henti: Array<() => Promise<void>> = [];
  let tandaiTertutup = () => {};
  const channelTertutup = new Promise<void>((r) => (tandaiTertutup = r));
  for (let i = 0; i < jumlah; i++) {
    const channel = await openChannel(conn);
    channel.on("close", () => tandaiTertutup());
    await siapkanTopologi(channel, email.topologi);
    henti.push(
      await mulaiKonsumenEmail({
        channel,
        pool,
        pengirim,
        topologi: { ...email.topologi, queue },
        appUrl: email.appUrl,
        log,
        jedaGalatMs: 50,
      }),
    );
  }
  return {
    log,
    channelTertutup,
    async hentikan() {
      for (const stop of henti) await stop();
      await conn.close().catch(() => {});
    },
  };
}

export async function tungguSampai(
  kondisi: () => boolean | Promise<boolean>,
  batasMs = 5000,
): Promise<void> {
  const mulai = Date.now();
  while (!(await kondisi())) {
    if (Date.now() - mulai > batasMs) {
      throw new Error(`Kondisi tidak tercapai dalam ${batasMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Menunggu sebentar agar pesan susulan (yang seharusnya tidak ada) sempat tiba. */
export function jeda(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
