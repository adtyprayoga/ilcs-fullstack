import type { Akun } from "../domain/akun.ts";
import { pesanError } from "../errors.ts";
import { sambungDenganTopologi, type Sambungan } from "./amqp.ts";
import { kunciIdempotensi, type PesanSelamatDatang } from "./pesan.ts";
import type { Topologi } from "./topologi.ts";

/** Port penerbitan notifikasi email. Tidak pernah melempar error. */
export interface PenerbitEmail {
  selamatDatang(akun: Pick<Akun, "id" | "email">): Promise<void>;
  tutup(): Promise<void>;
}

/** Penerbit untuk tes yang tidak memeriksa email. */
export const penerbitNoop: PenerbitEmail = {
  async selamatDatang() {},
  async tutup() {},
};

type Log = Pick<Console, "error">;

/**
 * Penerbit RabbitMQ. Koneksi dibuka saat publish pertama dan dipakai ulang;
 * bila koneksi atau channel tertutup, publish berikutnya menyambung ulang.
 *
 * Registrasi tidak boleh gagal karena email: semua error dan timeout dicatat
 * (hanya id Pelanggan, tanpa alamat email) lalu ditelan.
 */
export function createPenerbitAmqp({
  url,
  topologi,
  timeoutMs = 2000,
  log = console,
}: {
  url: string;
  topologi: Topologi;
  timeoutMs?: number;
  log?: Log;
}): PenerbitEmail {
  let sambungan: Promise<Sambungan> | undefined;

  function sambung(): Promise<Sambungan> {
    sambungan ??= sambungDenganTopologi(url, topologi, { timeoutMs }).then(
      (baru) => {
        const lupakan = () => {
          sambungan = undefined;
        };
        baru.koneksi.on("close", lupakan);
        baru.channel.on("close", lupakan);
        return baru;
      },
    );
    // Koneksi yang gagal dibuka tidak disimpan, agar publish berikutnya mencoba lagi.
    sambungan.catch(() => {
      sambungan = undefined;
    });
    return sambungan;
  }

  async function terbitkan(pesan: PesanSelamatDatang): Promise<void> {
    const { channel } = await sambung();
    channel.publish(
      topologi.exchange,
      topologi.routingKey,
      Buffer.from(JSON.stringify(pesan)),
      {
        persistent: true,
        messageId: kunciIdempotensi(pesan),
        contentType: "application/json",
      },
    );
    await channel.waitForConfirms();
  }

  return {
    async selamatDatang(akun) {
      const pesan: PesanSelamatDatang = {
        jenis: "SELAMAT_DATANG",
        akunId: akun.id,
        email: akun.email,
      };
      let timer: NodeJS.Timeout | undefined;
      const batasWaktu = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`tidak ada konfirmasi broker dalam ${timeoutMs} ms`)),
          timeoutMs,
        );
      });
      try {
        await Promise.race([terbitkan(pesan), batasWaktu]);
      } catch (error) {
        log.error(
          `Email Selamat Datang gagal diterbitkan (Pelanggan ${akun.id}): ${pesanError(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },

    async tutup() {
      const aktif = sambungan;
      sambungan = undefined;
      if (!aktif) return;
      const { koneksi } = await aktif.catch(() => ({ koneksi: undefined }));
      await koneksi?.close().catch(() => {});
    },
  };
}
