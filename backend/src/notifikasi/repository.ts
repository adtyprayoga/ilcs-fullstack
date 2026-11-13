import type { Pool } from "../db.ts";

export type HasilKlaim = "DIKLAIM" | "MENGIRIM" | "TERKIRIM";

/**
 * Mengklaim kunci sebelum email dikirim. Hanya satu pemanggil yang mendapat
 * "DIKLAIM"; pemanggil lain mendapat status klaim yang sudah ada, termasuk
 * worker lain yang menerima pesan yang sama atau redelivery setelah crash.
 */
export async function klaimEmail(pool: Pool, kunci: string): Promise<HasilKlaim> {
  const baru = await pool.query(
    `INSERT INTO email_terkirim (kunci) VALUES ($1)
     ON CONFLICT (kunci) DO NOTHING
     RETURNING kunci`,
    [kunci],
  );
  if ((baru.rowCount ?? 0) > 0) return "DIKLAIM";
  const { rows } = await pool.query<{ status: "MENGIRIM" | "TERKIRIM" }>(
    "SELECT status FROM email_terkirim WHERE kunci = $1",
    [kunci],
  );
  // Klaim dilepas di antara dua kueri: anggap masih dipegang pihak lain.
  return rows[0]?.status ?? "MENGIRIM";
}

export async function tandaiTerkirim(pool: Pool, kunci: string): Promise<void> {
  await pool.query(
    `UPDATE email_terkirim
     SET status = 'TERKIRIM', terkirim_pada = now()
     WHERE kunci = $1`,
    [kunci],
  );
}

/** Melepas klaim setelah pengiriman gagal, agar percobaan ulang bisa mengklaim lagi. */
export async function lepasKlaim(pool: Pool, kunci: string): Promise<void> {
  await pool.query(
    "DELETE FROM email_terkirim WHERE kunci = $1 AND status = 'MENGIRIM'",
    [kunci],
  );
}
