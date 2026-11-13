import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { penerbitNoop } from "../src/notifikasi/penerbit.ts";
import { createTestContext } from "./support.ts";

const kredensial = { email: "siti@example.com", password: "rahasia123" };

const { app, pool, config, reset, close } = createTestContext();
afterAll(close);
beforeEach(reset);

describe("POST /api/auth/register", () => {
  it("mendaftarkan Pengunjung menjadi Pelanggan", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "siti@example.com", password: "rahasia123" })
      .expect(201);

    expect(res.body.akun).toMatchObject({
      email: "siti@example.com",
      peran: "PELANGGAN",
      aktif: true,
    });
    expect(res.body.akun.id).toBeGreaterThan(0);
  });

  it("menolak email ganda dengan pesan yang jelas", async () => {
    await request(app).post("/api/auth/register").send(kredensial).expect(201);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...kredensial, email: "SITI@example.com" })
      .expect(409);

    expect(res.body.code).toBe("EMAIL_TERDAFTAR");
    expect(res.body.error).toContain("sudah terdaftar");
  });

  it("menyimpan kata sandi sebagai hash bcrypt cost 12", async () => {
    await request(app).post("/api/auth/register").send(kredensial).expect(201);

    const { rows } = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM akun WHERE email = $1",
      [kredensial.email],
    );
    const hash = rows[0]?.password_hash;
    expect(hash).toBeDefined();
    expect(hash).not.toBe(kredensial.password);
    expect(bcrypt.getRounds(hash!)).toBe(12);
    await expect(bcrypt.compare(kredensial.password, hash!)).resolves.toBe(true);
  });

  it("menolak Pendaftaran dengan peran Admin", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...kredensial, peran: "ADMIN" })
      .expect(400);

    expect(res.body.code).toBe("VALIDASI");
    const { rows } = await pool.query("SELECT 1 FROM akun");
    expect(rows).toHaveLength(0);
  });
});

describe("Sesi Pelanggan", () => {
  beforeEach(async () => {
    await request(app).post("/api/auth/register").send(kredensial).expect(201);
  });

  async function masuk() {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send(kredensial).expect(200);
    return agent;
  }

  it("melaporkan Pengunjung tanpa sesi sebagai belum masuk", async () => {
    const res = await request(app).get("/api/auth/me").expect(200);
    expect(res.body).toEqual({ akun: null });
  });

  it("melaporkan Pelanggan yang sedang masuk", async () => {
    const agent = await masuk();

    const res = await agent.get("/api/auth/me").expect(200);

    expect(res.body.akun).toMatchObject({
      email: kredensial.email,
      peran: "PELANGGAN",
    });
  });

  it("sesi tetap berlaku saat browser dibuka ulang", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send(kredensial)
      .expect(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];

    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie!)
      .expect(200);

    expect(res.body.akun.email).toBe(kredensial.email);
  });

  it("logout menghapus sesi", async () => {
    const agent = await masuk();

    const res = await agent.post("/api/auth/logout").expect(204);
    expect(String(res.headers["set-cookie"])).toContain("musicpedia.sid=;");

    const setelah = await agent.get("/api/auth/me").expect(200);
    expect(setelah.body).toEqual({ akun: null });
  });

  it("cookie sesi memakai Secure di produksi", async () => {
    const appProduksi = createApp({
      pool,
      config: {
        ...config,
        nodeEnv: "production",
        secureCookies: true,
        sessionSecret: "rahasia-produksi-tes",
      },
      penerbitEmail: penerbitNoop,
    });

    const res = await request(appProduksi)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send(kredensial)
      .expect(200);

    expect(String(res.headers["set-cookie"])).toContain("Secure");
  });
});

describe("Pelanggan nonaktif", () => {
  beforeEach(async () => {
    await request(app).post("/api/auth/register").send(kredensial).expect(201);
  });

  async function nonaktifkan() {
    await pool.query("UPDATE akun SET aktif = false WHERE email = $1", [
      kredensial.email,
    ]);
  }

  it("tidak bisa login", async () => {
    await nonaktifkan();

    const res = await request(app)
      .post("/api/auth/login")
      .send(kredensial)
      .expect(403);

    expect(res.body.code).toBe("AKUN_NONAKTIF");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("sesi yang masih aktif langsung ditolak setelah dinonaktifkan", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send(kredensial).expect(200);
    await agent.get("/api/auth/me").expect(200).expect((res) => {
      expect(res.body.akun).not.toBeNull();
    });

    await nonaktifkan();

    const res = await agent.get("/api/auth/me").expect(200);
    expect(res.body).toEqual({ akun: null });
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(app).post("/api/auth/register").send(kredensial).expect(201);
  });

  it("masuk dengan email dan kata sandi yang benar", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send(kredensial)
      .expect(200);

    expect(res.body.akun).toMatchObject({
      email: kredensial.email,
      peran: "PELANGGAN",
    });
  });

  it("mengirim cookie sesi httpOnly, SameSite=Lax, dan berumur panjang", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send(kredensial)
      .expect(200);

    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("musicpedia.sid=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/Expires=[^;]+GMT/);
  });

  it("menolak kata sandi yang salah", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ ...kredensial, password: "salah-sekali" })
      .expect(401);

    expect(res.body.code).toBe("KREDENSIAL_SALAH");
  });

  it("menolak email yang tidak terdaftar", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ ...kredensial, email: "tidak-ada@example.com" })
      .expect(401);
  });
});
