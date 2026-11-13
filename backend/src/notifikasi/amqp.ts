import amqp, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { siapkanTopologi, type Topologi } from "./topologi.ts";

/** Menyembunyikan kata sandi agar URL aman dicetak di pesan error. */
function sensor(url: string): string {
  return url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");
}

/**
 * Terhubung ke RabbitMQ; kegagalan diubah menjadi error satu baris yang jelas.
 * `timeoutMs` membatasi koneksi TCP sekaligus handshake AMQP, sehingga broker
 * yang menerima koneksi tetapi tidak menjawab tidak menggantung selamanya.
 */
export async function connect(
  url: string,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<ChannelModel> {
  try {
    const koneksi = await amqp.connect(url, { timeout: timeoutMs });
    // Error channel yang tidak ditangani diteruskan ke sini; penolakan pada
    // pemanggilan yang gagal sudah melaporkannya.
    koneksi.on("error", () => {});
    return koneksi;
  } catch (error) {
    const err = error as { code?: string; message?: string };
    const alasan = err.code ?? err.message ?? String(error);
    throw new Error(`Tidak dapat terhubung ke RabbitMQ di ${sensor(url)}: ${alasan}`);
  }
}

/**
 * Membuka confirm channel dengan listener `error`. Saat broker menutup channel
 * (misalnya 404 karena antrean hilang), amqplib menolak pemanggilan yang gagal
 * sekaligus memancarkan `error`; tanpa listener, event itu menjatuhkan proses
 * sebelum penolakannya sempat dilaporkan.
 *
 * Selalu confirm channel: penerbit dan consumer sama-sama menunggu broker
 * menerima pesan sebelum menganggapnya terkirim.
 */
export async function openChannel(koneksi: ChannelModel): Promise<ConfirmChannel> {
  const channel = await koneksi.createConfirmChannel();
  channel.on("error", () => {});
  return channel;
}

export interface Sambungan {
  koneksi: ChannelModel;
  channel: ConfirmChannel;
}

/**
 * Terhubung, membuka confirm channel, lalu mendeklarasikan topologi. Koneksi
 * ditutup lagi bila langkah setelah connect gagal.
 */
export async function sambungDenganTopologi(
  url: string,
  topologi: Topologi,
  opsi: { timeoutMs?: number } = {},
): Promise<Sambungan> {
  const koneksi = await connect(url, opsi);
  try {
    const channel = await openChannel(koneksi);
    await siapkanTopologi(channel, topologi);
    return { koneksi, channel };
  } catch (error) {
    await koneksi.close().catch(() => {});
    throw error;
  }
}
