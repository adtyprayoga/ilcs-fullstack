import net from "node:net";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createPenerbitAmqp } from "../src/notifikasi/penerbit.ts";
import { TOPOLOGI_EMAIL } from "../src/notifikasi/topologi.ts";
import { buatLogUji } from "./email-helper.ts";
import { createTestContext } from "./support.ts";

// Server TCP yang menerima koneksi tetapi tidak pernah menjawab handshake AMQP:
// meniru broker yang macet, bukan yang menolak koneksi.
const broker = net.createServer(() => {});
const soket = new Set<net.Socket>();
broker.on("connection", (s) => soket.add(s));
await new Promise<void>((r) => broker.listen(0, "127.0.0.1", r));
const portMacet = (broker.address() as AddressInfo).port;

const log = buatLogUji();
const penerbitMacet = createPenerbitAmqp({
  url: `amqp://guest:guest@127.0.0.1:${portMacet}/`,
  topologi: TOPOLOGI_EMAIL,
  log,
});
const penerbitDitolak = createPenerbitAmqp({
  // Port 1 tidak didengarkan siapa pun: koneksi langsung ditolak.
  url: "amqp://guest:guest@127.0.0.1:1/",
  topologi: TOPOLOGI_EMAIL,
  log,
});

const macet = createTestContext({ penerbitEmail: penerbitMacet });
const ditolak = createTestContext({ penerbitEmail: penerbitDitolak });

afterAll(async () => {
  await penerbitMacet.tutup();
  await penerbitDitolak.tutup();
  for (const s of soket) s.destroy();
  broker.close();
  await macet.close();
  await ditolak.close();
});

describe("Registrasi saat RabbitMQ bermasalah", () => {
  it("tetap berhasil saat koneksi ke broker ditolak", async () => {
    await ditolak.reset();
    log.baris.length = 0;

    const res = await request(ditolak.app)
      .post("/api/auth/register")
      .send({ email: "siti@example.com", password: "rahasia123" })
      .expect(201);

    expect(res.body.akun.email).toBe("siti@example.com");
    const catatan = log.baris.join("\n");
    expect(catatan).toMatch(/gagal diterbitkan \(Pelanggan \d+\)/);
    // Alamat email Pelanggan tidak pernah masuk log.
    expect(catatan).not.toContain("siti@example.com");
  });

  it("tetap berhasil dalam sekitar 2 detik saat broker tidak menjawab", async () => {
    await macet.reset();
    log.baris.length = 0;

    const mulai = Date.now();
    await request(macet.app)
      .post("/api/auth/register")
      .send({ email: "budi@example.com", password: "rahasia123" })
      .expect(201);

    // Batas bawaan penerbit 2 detik, ditambah bcrypt registrasi.
    expect(Date.now() - mulai).toBeLessThan(3500);
    expect(log.baris.join("\n")).toMatch(/gagal diterbitkan \(Pelanggan \d+\)/);
  }, 10_000);
});
