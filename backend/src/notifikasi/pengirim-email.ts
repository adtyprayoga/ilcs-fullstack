import nodemailer from "nodemailer";
import type { Config } from "../config.ts";

export interface SuratEmail {
  ke: string;
  subjek: string;
  teks: string;
  html: string;
}

/** Port pengiriman email; worker tidak tahu layanan apa yang mengirimnya. */
export interface PengirimEmail {
  kirim(surat: SuratEmail): Promise<void>;
}

/** SMTP sandbox Mailtrap: email masuk ke inbox uji, tidak ke penerima sungguhan. */
export function createPengirimMailtrap(
  config: Pick<
    Config,
    | "mailtrapSmtpHost"
    | "mailtrapSmtpPort"
    | "mailtrapSmtpUser"
    | "mailtrapSmtpPass"
    | "emailPengirim"
  >,
): PengirimEmail {
  const transport = nodemailer.createTransport({
    host: config.mailtrapSmtpHost,
    port: config.mailtrapSmtpPort,
    auth: { user: config.mailtrapSmtpUser, pass: config.mailtrapSmtpPass },
  });
  return {
    async kirim(surat) {
      await transport.sendMail({
        from: config.emailPengirim,
        to: surat.ke,
        subject: surat.subjek,
        text: surat.teks,
        html: surat.html,
      });
    },
  };
}

/**
 * Pengganti Mailtrap untuk pengembangan tanpa kredensial: email dicetak ke log
 * worker. Hanya dipakai di luar produksi, jadi alamat email boleh tampil.
 */
export function createPengirimKonsol(
  log: Pick<Console, "log"> = console,
): PengirimEmail {
  return {
    async kirim(surat) {
      log.log(
        [
          "--- Email (pengirim konsol, tidak benar-benar dikirim) ---",
          `Kepada: ${surat.ke}`,
          `Subjek: ${surat.subjek}`,
          "",
          surat.teks,
          "---",
        ].join("\n"),
      );
    },
  };
}
