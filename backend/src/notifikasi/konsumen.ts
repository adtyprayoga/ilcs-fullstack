import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import type { Pool } from "../db.ts";
import { pesanError } from "../errors.ts";
import type { PengirimEmail } from "./pengirim-email.ts";
import {
  bacaPercobaan,
  HEADER_PERCOBAAN,
  kunciIdempotensi,
  MAKS_PERCOBAAN,
  pesanSelamatDatangSchema,
  type PesanSelamatDatang,
} from "./pesan.ts";
import { klaimEmail, lepasKlaim, tandaiTerkirim } from "./repository.ts";
import { templatSelamatDatang } from "./templat/selamat-datang.ts";
import type { Topologi } from "./topologi.ts";

type Log = Pick<Console, "log" | "warn" | "error">;

export interface OpsiKonsumenEmail {
  channel: ConfirmChannel;
  pool: Pool;
  pengirim: PengirimEmail;
  topologi: Topologi;
  appUrl: string;
  log?: Log;
  /** Jeda sebelum pesan dikembalikan ke antrean setelah kesalahan tak terduga. */
  jedaGalatMs?: number;
}

/**
 * Menjalankan consumer Email Selamat Datang pada `topologi.queue`. Ack manual:
 * pesan baru di-ack setelah selesai diproses, sehingga worker yang mati di
 * tengah jalan tidak menghilangkan pesan. Mengembalikan fungsi untuk berhenti.
 */
export async function mulaiKonsumenEmail({
  channel,
  pool,
  pengirim,
  topologi,
  appUrl,
  log = console,
  jedaGalatMs = 2000,
}: OpsiKonsumenEmail): Promise<() => Promise<void>> {
  await channel.prefetch(1);

  /**
   * Memindahkan pesan ke antrean lain lalu meng-ack aslinya. Ack baru dikirim
   * setelah broker mengonfirmasi salinannya; bila worker mati di antara
   * keduanya, salinan ganda ditangkap tabel dedupe.
   */
  async function pindahkan(
    pesan: ConsumeMessage,
    queue: string,
    percobaan: number,
  ): Promise<void> {
    channel.sendToQueue(queue, pesan.content, {
      persistent: true,
      messageId: pesan.properties.messageId,
      contentType: pesan.properties.contentType,
      headers: { ...pesan.properties.headers, [HEADER_PERCOBAAN]: percobaan },
    });
    await channel.waitForConfirms();
    channel.ack(pesan);
  }

  async function gagalKirim(
    pesan: ConsumeMessage,
    isi: PesanSelamatDatang,
    kunci: string,
    error: unknown,
  ): Promise<void> {
    await lepasKlaim(pool, kunci);
    const percobaan = bacaPercobaan(pesan.properties.headers);
    log.error(
      `Email Selamat Datang gagal (Pelanggan ${isi.akunId}), percobaan ${percobaan}/${MAKS_PERCOBAAN}: ${pesanError(error)}`,
    );
    if (percobaan < MAKS_PERCOBAAN) {
      await pindahkan(pesan, topologi.queueTunda, percobaan + 1);
    } else {
      await pindahkan(pesan, topologi.queueGagal, percobaan);
    }
  }

  function baca(pesan: ConsumeMessage): PesanSelamatDatang | null {
    try {
      const hasil = pesanSelamatDatangSchema.safeParse(
        JSON.parse(pesan.content.toString()),
      );
      return hasil.success ? hasil.data : null;
    } catch {
      return null;
    }
  }

  async function proses(pesan: ConsumeMessage): Promise<void> {
    const isi = baca(pesan);
    if (isi === null) {
      // Pesan rusak tidak akan sembuh dengan dicoba ulang: langsung diparkir.
      log.error(
        `Pesan Email Selamat Datang tidak valid diparkir (messageId ${pesan.properties.messageId ?? "-"})`,
      );
      await pindahkan(pesan, topologi.queueGagal, 1);
      return;
    }
    const kunci = kunciIdempotensi(isi);
    const klaim = await klaimEmail(pool, kunci);
    if (klaim === "MENGIRIM") {
      // Klaim tertinggal biasanya berarti worker crash di tengah pengiriman.
      // Email tidak dikirim ulang (tanpa duplikat); baris ini perlu dicek manual.
      log.warn(
        `Email Selamat Datang dilewati: kunci ${kunci} sudah diklaim (MENGIRIM)`,
      );
    }
    if (klaim !== "DIKLAIM") {
      channel.ack(pesan);
      return;
    }
    try {
      await pengirim.kirim({
        ke: isi.email,
        ...templatSelamatDatang({ email: isi.email, appUrl }),
      });
    } catch (error) {
      await gagalKirim(pesan, isi, kunci, error);
      return;
    }
    await tandaiTerkirim(pool, kunci);
    log.log(`Email Selamat Datang terkirim (Pelanggan ${isi.akunId})`);
    channel.ack(pesan);
  }

  const { consumerTag } = await channel.consume(
    topologi.queue,
    (pesan) => {
      if (pesan === null) {
        // Broker membatalkan consumer, misalnya karena antrean dihapus. Channel
        // tetap terbuka, jadi tutup sendiri agar worker menyambung ulang dan
        // mendeklarasikan ulang topologi.
        log.error(
          `Consumer Email Selamat Datang dibatalkan broker (antrean ${topologi.queue} hilang?).`,
        );
        channel.close().catch(() => {});
        return;
      }
      proses(pesan).catch((error: unknown) => {
        // Database atau broker bermasalah. Pesan dikembalikan ke antrean
        // setelah jeda, agar consumer (ini atau yang lain) mencobanya lagi
        // tanpa berputar cepat selama gangguan berlangsung. Klaim yang sempat
        // dibuat membuat percobaan berikutnya dilewati, bukan dikirim ganda.
        log.error(
          `Consumer Email Selamat Datang gagal memproses pesan: ${pesanError(error)}`,
        );
        setTimeout(() => {
          try {
            channel.nack(pesan, false, true);
          } catch {
            // Channel sudah tertutup: broker mengembalikan pesan sendiri.
          }
        }, jedaGalatMs);
      });
    },
    { noAck: false },
  );

  return async () => {
    await channel.cancel(consumerTag).catch(() => {});
    await channel.close().catch(() => {});
  };
}
