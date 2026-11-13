import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buatPengirimPalsu,
  jalankanKonsumen,
  jeda,
  siapkanEmailUji,
  tungguSampai,
  type KonsumenUji,
} from "./email-helper.ts";
import { testDatabaseUrl } from "./global-setup.ts";
import { createTestContext } from "./support.ts";

const email = siapkanEmailUji();
const ctx = createTestContext({ penerbitEmail: email.penerbit });
const { app, pool } = ctx;
const pengirim = buatPengirimPalsu();
let konsumen: KonsumenUji | undefined;

beforeEach(async () => {
  await ctx.reset();
  await pool.query("TRUNCATE email_terkirim");
  await email.kosongkanAntrean();
  pengirim.reset();
});

afterEach(async () => {
  await konsumen?.hentikan();
  konsumen = undefined;
});

afterAll(async () => {
  await email.tutup();
  await ctx.close();
});

async function registrasi(alamat: string): Promise<void> {
  await request(app)
    .post("/api/auth/register")
    .send({ email: alamat, password: "rahasia123" })
    .expect(201);
}

describe("Email Selamat Datang", () => {
  it("dikirim ke Pelanggan baru setelah registrasi", async () => {
    konsumen = await jalankanKonsumen({ email, pool, pengirim });

    await registrasi("siti@example.com");

    await tungguSampai(() => pengirim.terkirim.length === 1);
    const [surat] = pengirim.terkirim;
    expect(surat!.ke).toBe("siti@example.com");
    expect(surat!.subjek).toBe("Selamat datang di MusicPedia");
    expect(surat!.teks).toContain("siti@example.com");
    expect(surat!.teks).toContain(email.appUrl);
    expect(surat!.html).toContain(`href="${email.appUrl}"`);
  });

  it("tidak dikirim saat registrasi ditolak karena email sudah terdaftar", async () => {
    konsumen = await jalankanKonsumen({ email, pool, pengirim });
    await registrasi("siti@example.com");
    await tungguSampai(() => pengirim.terkirim.length === 1);

    await request(app)
      .post("/api/auth/register")
      .send({ email: "SITI@example.com", password: "rahasia123" })
      .expect(409);

    await jeda(300);
    expect(pengirim.terkirim).toHaveLength(1);
  });
});

describe("Banyak consumer, templat yang sama", () => {
  it("tiga consumer pada satu antrean mengirim tepat satu email per Pelanggan", async () => {
    konsumen = await jalankanKonsumen({ email, pool, pengirim, jumlah: 3 });
    const alamat = Array.from({ length: 6 }, (_, i) => `pelanggan${i}@example.com`);

    for (const a of alamat) await registrasi(a);

    await tungguSampai(() => pengirim.terkirim.length >= alamat.length);
    await jeda(300);
    expect(pengirim.terkirim.map((s) => s.ke).sort()).toEqual([...alamat].sort());
    expect(await email.jumlahPesan(email.topologi.queue)).toBe(0);
    // Setiap registrasi memakai bcrypt cost 12; enam berturut-turut bisa
    // melewati batas bawaan 5 detik saat mesin sibuk.
  }, 15_000);

  it("pesan yang sama terkirim dua kali tetap menghasilkan satu email", async () => {
    konsumen = await jalankanKonsumen({ email, pool, pengirim, jumlah: 2 });
    const pesan = { jenis: "SELAMAT_DATANG", akunId: 42, email: "siti@example.com" };

    await email.terbitkanMentah(pesan);
    await email.terbitkanMentah(pesan);

    await tungguSampai(async () => (await email.jumlahPesan(email.topologi.queue)) === 0);
    await jeda(300);
    expect(pengirim.terkirim).toHaveLength(1);
    const { rows } = await pool.query("SELECT kunci, status FROM email_terkirim");
    expect(rows).toEqual([{ kunci: "selamat-datang:42", status: "TERKIRIM" }]);
  });

  it("dua antrean pada routing key yang sama tetap mengirim satu email berkat tabel dedupe", async () => {
    // Pub/sub: masing-masing antrean mendapat salinan pesan, sehingga tanpa
    // dedupe Pelanggan akan menerima dua email.
    const salinan = await email.buatAntreanTambahan();
    konsumen = await jalankanKonsumen({ email, pool, pengirim });
    const konsumenSalinan = await jalankanKonsumen({
      email,
      pool,
      pengirim,
      queue: salinan,
    });

    try {
      await registrasi("siti@example.com");

      await tungguSampai(async () => {
        const sisa =
          (await email.jumlahPesan(email.topologi.queue)) +
          (await email.jumlahPesan(salinan));
        return sisa === 0 && pengirim.terkirim.length >= 1;
      });
      await jeda(300);
      expect(pengirim.terkirim).toHaveLength(1);
    } finally {
      await konsumenSalinan.hentikan();
    }
  });

  it("melewati kunci yang tertinggal MENGIRIM dan mencatat peringatan", async () => {
    // Worker sebelumnya crash setelah klaim: kita tidak tahu apakah email sudah
    // terkirim, jadi email tidak dikirim ulang (tanpa duplikat).
    await pool.query(
      "INSERT INTO email_terkirim (kunci, status) VALUES ('selamat-datang:42', 'MENGIRIM')",
    );
    konsumen = await jalankanKonsumen({ email, pool, pengirim });

    await email.terbitkanMentah({
      jenis: "SELAMAT_DATANG",
      akunId: 42,
      email: "siti@example.com",
    });

    await tungguSampai(() =>
      konsumen!.log.baris.some((b) => b.includes("selamat-datang:42")),
    );
    expect(pengirim.terkirim).toHaveLength(0);
    expect(konsumen.log.baris.join("\n")).toMatch(/dilewati.*selamat-datang:42.*MENGIRIM/);
    expect(await email.jumlahPesan(email.topologi.queue)).toBe(0);
  });
});

describe("Kegagalan Mailtrap", () => {
  it("dicoba ulang dengan jeda lalu terkirim sekali", async () => {
    pengirim.aturGagal(2);
    konsumen = await jalankanKonsumen({ email, pool, pengirim });

    await registrasi("siti@example.com");

    await tungguSampai(() => pengirim.terkirim.length === 1);
    expect(pengirim.percobaan).toBe(3);
    expect(konsumen.log.baris.join("\n")).toMatch(/percobaan 2\/3/);
    const { rows } = await pool.query("SELECT status FROM email_terkirim");
    expect(rows).toEqual([{ status: "TERKIRIM" }]);
  });

  it("diparkir di antrean gagal setelah tiga percobaan tanpa meninggalkan klaim", async () => {
    pengirim.aturGagal(Infinity);
    konsumen = await jalankanKonsumen({ email, pool, pengirim });

    await registrasi("siti@example.com");

    await tungguSampai(async () => (await email.jumlahPesan(email.topologi.queueGagal)) === 1);
    expect(pengirim.percobaan).toBe(3);
    expect(pengirim.terkirim).toHaveLength(0);
    const [parkir] = await email.ambilGagal();
    expect(parkir!.isi).toMatchObject({ jenis: "SELAMAT_DATANG", email: "siti@example.com" });
    expect(parkir!.headers["x-percobaan"]).toBe(3);
    const { rows } = await pool.query("SELECT * FROM email_terkirim");
    expect(rows).toEqual([]);
  });
});

describe("Pesan rusak", () => {
  it("diparkir tanpa mengirim email dan worker tetap berjalan", async () => {
    konsumen = await jalankanKonsumen({ email, pool, pengirim });

    await email.terbitkanMentah("bukan json");
    await email.terbitkanMentah({ jenis: "SELAMAT_DATANG", akunId: "x" });
    await registrasi("siti@example.com");

    await tungguSampai(() => pengirim.terkirim.length === 1);
    await tungguSampai(async () => (await email.jumlahPesan(email.topologi.queueGagal)) === 2);
    const gagal = await email.ambilGagal();
    expect(gagal.map((g) => g.isi)).toEqual([
      "bukan json",
      { jenis: "SELAMAT_DATANG", akunId: "x" },
    ]);
  });
});

describe("Antrean dihapus", () => {
  it("consumer yang dibatalkan broker menutup channel-nya agar worker menyambung ulang", async () => {
    // Menghapus antrean tidak menutup channel; broker hanya membatalkan
    // consumer. Tanpa penanganan, worker diam tanpa jejak.
    konsumen = await jalankanKonsumen({ email, pool, pengirim });

    await email.hapusAntrean(email.topologi.queue);

    await konsumen.channelTertutup;
    expect(konsumen.log.baris.join("\n")).toMatch(/dibatalkan broker/);
  });
});

describe("Database bermasalah", () => {
  it("consumer melepas pesan agar consumer lain bisa mengirimnya", async () => {
    // Pool ke database yang tidak ada: setiap klaim gagal.
    const url = new URL(testDatabaseUrl());
    url.pathname = "/database_yang_tidak_ada";
    const poolRusak = new pg.Pool({ connectionString: url.toString() });
    const rusak = await jalankanKonsumen({ email, pool: poolRusak, pengirim });
    try {
      await registrasi("siti@example.com");
      await tungguSampai(() =>
        rusak.log.baris.some((b) => b.includes("gagal memproses pesan")),
      );

      // Consumer yang rusak masih hidup; pesan harus kembali ke antrean.
      konsumen = await jalankanKonsumen({ email, pool, pengirim });
      await tungguSampai(() => pengirim.terkirim.length === 1);
      expect(pengirim.terkirim[0]!.ke).toBe("siti@example.com");
    } finally {
      await rusak.hentikan();
      await poolRusak.end();
    }
  }, 15_000);
});
