import type { Channel } from "amqplib";

export interface Topologi {
  exchange: string;
  routingKey: string;
  queue: string;
  /** Antrean penunda percobaan ulang; TTL-nya mengembalikan pesan ke `queue`. */
  queueTunda: string;
  /** Tempat parkir pesan yang rusak atau tetap gagal setelah percobaan habis. */
  queueGagal: string;
  jedaUlangMs: number;
}

export const TOPOLOGI_EMAIL: Topologi = {
  exchange: "notifikasi",
  routingKey: "email.selamat-datang",
  queue: "email",
  queueTunda: "email.tunda",
  queueGagal: "email.gagal",
  jedaUlangMs: 10_000,
};

/**
 * Mendeklarasikan exchange, antrean, dan binding. Aman dipanggil berulang;
 * backend dan worker sama-sama memanggilnya saat start.
 *
 * Jeda ulang memakai TTL tingkat antrean, bukan TTL per pesan: RabbitMQ hanya
 * mengedarkan pesan kedaluwarsa dari kepala antrean, sehingga TTL per pesan
 * yang berbeda-beda bisa tertahan di belakang pesan lain.
 */
export async function siapkanTopologi(
  channel: Channel,
  topologi: Topologi,
): Promise<void> {
  await channel.assertExchange(topologi.exchange, "direct", { durable: true });
  await channel.assertQueue(topologi.queue, { durable: true });
  await channel.bindQueue(topologi.queue, topologi.exchange, topologi.routingKey);
  await channel.assertQueue(topologi.queueTunda, {
    durable: true,
    messageTtl: topologi.jedaUlangMs,
    deadLetterExchange: topologi.exchange,
    deadLetterRoutingKey: topologi.routingKey,
  });
  await channel.assertQueue(topologi.queueGagal, { durable: true });
}
