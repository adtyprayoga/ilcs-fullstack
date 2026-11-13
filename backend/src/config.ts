import path from "node:path";

export interface Config {
  port: number;
  databaseUrl: string;
  nodeEnv: string;
  sessionSecret: string;
  secureCookies: boolean;
  adminEmail: string;
  adminPassword: string;
  audioDir: string;
  ffmpegPath: string;
  midtransServerKey: string;
  midtransClientKey: string;
  midtransProduction: boolean;
  amqpUrl: string;
  mailtrapSmtpHost: string;
  mailtrapSmtpPort: number;
  mailtrapSmtpUser: string;
  mailtrapSmtpPass: string;
  emailPengirim: string;
  appUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT tidak valid: ${env.PORT}`);
  }
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const sessionSecret =
    env.SESSION_SECRET ??
    (isProduction
      ? undefined
      : "rahasia-pengembangan-musicpedia-jangan-dipakai-di-produksi");
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET wajib diisi di produksi.");
  }
  if (isProduction && sessionSecret.length < 32) {
    throw new Error(
      "SESSION_SECRET di produksi wajib minimal 32 karakter. Buat dengan `openssl rand -base64 32`.",
    );
  }
  if (isProduction && !env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL wajib diisi di produksi lewat environment, bukan nilai bawaan pengembangan.",
    );
  }
  return {
    port,
    databaseUrl:
      env.DATABASE_URL ??
      "postgres://musicpedia:musicpedia@localhost:5433/musicpedia",
    nodeEnv,
    sessionSecret,
    secureCookies: isProduction,
    adminEmail: env.ADMIN_EMAIL ?? "admin@musicpedia.id",
    adminPassword: env.ADMIN_PASSWORD ?? "admin12345",
    audioDir: path.resolve(env.AUDIO_DIR ?? "audio"),
    ffmpegPath: env.FFMPEG_PATH ?? "ffmpeg",
    midtransServerKey: env.MIDTRANS_SERVER_KEY ?? "",
    midtransClientKey: env.MIDTRANS_CLIENT_KEY ?? "",
    midtransProduction: env.MIDTRANS_PRODUCTION === "true",
    amqpUrl: env.AMQP_URL ?? "amqp://guest:guest@localhost:5673/",
    mailtrapSmtpHost: env.MAILTRAP_SMTP_HOST ?? "sandbox.smtp.mailtrap.io",
    mailtrapSmtpPort: env.MAILTRAP_SMTP_PORT
      ? Number(env.MAILTRAP_SMTP_PORT)
      : 2525,
    mailtrapSmtpUser: env.MAILTRAP_SMTP_USER ?? "",
    mailtrapSmtpPass: env.MAILTRAP_SMTP_PASS ?? "",
    emailPengirim: env.EMAIL_PENGIRIM ?? "MusicPedia <no-reply@musicpedia.id>",
    // Diwajibkan di produksi oleh worker, satu-satunya pemakainya.
    appUrl: env.APP_URL ?? (isProduction ? "" : "http://localhost:5173"),
  };
}

/**
 * Pemeriksaan tambahan untuk worker email. Backend tidak mengirim email, jadi
 * kredensial Mailtrap dan APP_URL hanya diwajibkan saat worker start di
 * produksi. Di pengembangan, kredensial kosong berarti email dicetak ke log.
 */
export function kredensialMailtrapTerisi(
  config: Pick<Config, "mailtrapSmtpUser" | "mailtrapSmtpPass">,
): boolean {
  return Boolean(config.mailtrapSmtpUser && config.mailtrapSmtpPass);
}

export function periksaKonfigurasiWorker(config: Config): void {
  if (config.nodeEnv !== "production") return;
  if (!kredensialMailtrapTerisi(config)) {
    throw new Error(
      "MAILTRAP_SMTP_USER dan MAILTRAP_SMTP_PASS wajib diisi untuk worker email di produksi.",
    );
  }
  if (!config.appUrl) {
    throw new Error(
      "APP_URL wajib diisi untuk worker email di produksi (tautan di Email Selamat Datang).",
    );
  }
}
