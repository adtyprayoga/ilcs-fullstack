import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, periksaKonfigurasiWorker } from "../src/config.ts";

describe("konfigurasi produksi", () => {
  const rahasia = "rahasia-produksi-yang-panjang-dan-acak-123456";

  it("mewajibkan SESSION_SECRET yang panjang di produksi", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://db/app" }),
    ).toThrow(/SESSION_SECRET/);

    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://db/app",
        SESSION_SECRET: "pendek",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("mewajibkan DATABASE_URL eksplisit di produksi", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", SESSION_SECRET: rahasia }),
    ).toThrow(/DATABASE_URL/);
  });

  it("memakai cookie Secure dan nilai dari environment di produksi", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://db/app",
      SESSION_SECRET: rahasia,
      PORT: "8080",
      AUDIO_DIR: "/data/audio",
    });

    expect(config).toMatchObject({
      port: 8080,
      databaseUrl: "postgres://db/app",
      nodeEnv: "production",
      sessionSecret: rahasia,
      secureCookies: true,
      audioDir: "/data/audio",
    });
  });

  it("memberi nilai bawaan pengembangan tanpa cookie Secure", () => {
    const config = loadConfig({ NODE_ENV: "development", AUDIO_DIR: "audio" });

    expect(config.secureCookies).toBe(false);
    expect(config.audioDir).toBe(path.resolve("audio"));
  });

  it("menolak PORT yang tidak valid", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: "0" })).toThrow(/PORT/);
  });
});

describe("konfigurasi Email Selamat Datang", () => {
  const produksi = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://db/app",
    SESSION_SECRET: "rahasia-produksi-yang-panjang-dan-acak-123456",
  };

  it("memberi nilai bawaan pengembangan untuk broker, Mailtrap, dan tautan aplikasi", () => {
    const config = loadConfig({ NODE_ENV: "development" });

    expect(config).toMatchObject({
      amqpUrl: "amqp://guest:guest@localhost:5673/",
      mailtrapSmtpHost: "sandbox.smtp.mailtrap.io",
      mailtrapSmtpPort: 2525,
      mailtrapSmtpUser: "",
      mailtrapSmtpPass: "",
      emailPengirim: "MusicPedia <no-reply@musicpedia.id>",
      appUrl: "http://localhost:5173",
    });
    // Tanpa kredensial di pengembangan, worker memakai pengirim konsol.
    expect(() => periksaKonfigurasiWorker(config)).not.toThrow();
  });

  it("worker produksi mewajibkan kredensial Mailtrap dan APP_URL", () => {
    expect(() => periksaKonfigurasiWorker(loadConfig(produksi))).toThrow(
      /MAILTRAP_SMTP_USER/,
    );
    expect(() =>
      periksaKonfigurasiWorker(
        loadConfig({
          ...produksi,
          MAILTRAP_SMTP_USER: "user",
          MAILTRAP_SMTP_PASS: "pass",
        }),
      ),
    ).toThrow(/APP_URL/);
    expect(() =>
      periksaKonfigurasiWorker(
        loadConfig({
          ...produksi,
          MAILTRAP_SMTP_USER: "user",
          MAILTRAP_SMTP_PASS: "pass",
          APP_URL: "https://musicpedia.id",
        }),
      ),
    ).not.toThrow();
  });

  it("backend produksi tidak membutuhkan kredensial Mailtrap", () => {
    expect(() => loadConfig(produksi)).not.toThrow();
  });
});

