import type { SuratEmail } from "../pengirim-email.ts";

function escapeHtml(teks: string): string {
  return teks
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Templat Email Selamat Datang. Fungsi murni tanpa state, sehingga aman dipakai
 * bersama oleh berapa pun worker. Saat registrasi Pelanggan belum punya nama,
 * jadi sapaan memakai alamat email.
 */
export function templatSelamatDatang({
  email,
  appUrl,
}: {
  email: string;
  appUrl: string;
}): Omit<SuratEmail, "ke"> {
  const subjek = "Selamat datang di MusicPedia";
  const teks = [
    `Halo ${email},`,
    "",
    "Akun MusicPedia Anda sudah aktif. Jelajahi katalog, dengarkan Trial 30 detik,",
    "lalu beli dan unduh Lagu favorit Anda sebagai mp3.",
    "",
    `Mulai di ${appUrl}`,
    "",
    "Salam,",
    "MusicPedia",
  ].join("\n");
  const html = `<!doctype html>
<html lang="id">
  <body style="font-family: sans-serif; line-height: 1.5; color: #1f2937">
    <p>Halo ${escapeHtml(email)},</p>
    <p>Akun MusicPedia Anda sudah aktif. Jelajahi katalog, dengarkan Trial 30 detik, lalu beli dan unduh Lagu favorit Anda sebagai mp3.</p>
    <p><a href="${escapeHtml(appUrl)}">Mulai menjelajah MusicPedia</a></p>
    <p>Salam,<br>MusicPedia</p>
  </body>
</html>`;
  return { subjek, teks, html };
}
