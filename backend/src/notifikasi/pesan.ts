import { z } from "zod";

export const pesanSelamatDatangSchema = z.strictObject({
  jenis: z.literal("SELAMAT_DATANG"),
  akunId: z.number().int().positive(),
  email: z.email(),
});

export type PesanSelamatDatang = z.infer<typeof pesanSelamatDatangSchema>;

/** Satu Email Selamat Datang per akun, berapa kali pun pesannya terkirim. */
export function kunciIdempotensi(pesan: PesanSelamatDatang): string {
  return `selamat-datang:${pesan.akunId}`;
}

/** Percobaan kirim maksimal sebelum pesan diparkir di antrean gagal. */
export const MAKS_PERCOBAAN = 3;

export const HEADER_PERCOBAAN = "x-percobaan";

/** Nomor percobaan pesan ini; pesan yang baru diterbitkan adalah percobaan 1. */
export function bacaPercobaan(headers: Record<string, unknown> | undefined): number {
  const nilai = Number(headers?.[HEADER_PERCOBAAN] ?? 1);
  return Number.isInteger(nilai) && nilai >= 1 ? nilai : 1;
}
