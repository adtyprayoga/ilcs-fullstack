import express from "express";
import type { ErrorRequestHandler } from "express";
import type {
  ErrorResponse,
  HealthResponse,
  KonfigurasiResponse,
} from "@musicpedia/shared";
import type { Config } from "./config.ts";
import { createAuthController } from "./controllers/auth-controller.ts";
import { createProfilController } from "./controllers/profil-controller.ts";
import type { Pool } from "./db.ts";
import { AppError } from "./errors.ts";
import { createKatalogController, katalogRouter } from "./katalog/controller.ts";
import { createKatalogService } from "./katalog/service.ts";
import {
  createKeranjangController,
  keranjangRouter,
} from "./keranjang/controller.ts";
import { createKeranjangRepository } from "./keranjang/repository.ts";
import { createKeranjangService } from "./keranjang/service.ts";
import { siapkanDirektoriAudio } from "./media/audio.ts";
import type { PenerbitEmail } from "./notifikasi/penerbit.ts";
import { createAuthMiddleware } from "./middleware/auth.ts";
import {
  createMidtransGateway,
  snapUrl,
  type PaymentGateway,
} from "./payment-gateway/client.ts";
import {
  createPembelianController,
  pembelianRouter,
} from "./pembelian/controller.ts";
import { createPembelianService, createPembelianWebhookService } from "./pembelian/service.ts";
import { createPelangganController } from "./pelanggan/controller.ts";
import { createPelangganRepository } from "./pelanggan/repository.ts";
import { createPelangganService } from "./pelanggan/service.ts";
import { createAkunRepository } from "./repositories/akun-repository.ts";
import { createAdminRouter } from "./routes/admin-routes.ts";
import { createAuthRouter } from "./routes/auth-routes.ts";
import { createProfilRouter } from "./routes/profil-routes.ts";
import { createSessionMiddleware } from "./session.ts";
import { createAuthService } from "./services/auth-service.ts";
import { createProfilService } from "./services/profil-service.ts";
import {
  createUnduhanController,
  unduhanRouter,
} from "./unduhan/controller.ts";
import {
  createWebhookController,
  webhookRouter,
} from "./webhook/controller.ts";
import { createWebhookService } from "./webhook/service.ts";

export interface AppDeps {
  pool: Pool;
  config: Config;
  paymentGateway?: PaymentGateway;
  penerbitEmail: PenerbitEmail;
}

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    const body: ErrorResponse = { error: error.message, code: error.code };
    res.status(error.status).json(body);
    return;
  }
  console.error(error);
  const body: ErrorResponse = {
    error: "Terjadi kesalahan pada server.",
    code: "KESALAHAN_SERVER",
  };
  res.status(500).json(body);
};

export function createApp({
  pool,
  config,
  paymentGateway,
  penerbitEmail,
}: AppDeps) {
  const app = express();
  siapkanDirektoriAudio(config.audioDir);
  if (config.secureCookies) {
    app.set("trust proxy", 1);
  }
  app.use(express.json());

  const akunRepo = createAkunRepository(pool);
  const pelangganRepo = createPelangganRepository(pool);
  const authService = createAuthService(akunRepo, penerbitEmail);
  const profilService = createProfilService(akunRepo);
  const pelangganService = createPelangganService(pelangganRepo);
  const authController = createAuthController({ authService });
  const profilController = createProfilController({ profilService });
  const pelangganController = createPelangganController({ pelangganService });
  const authMiddleware = createAuthMiddleware(akunRepo);
  const katalogService = createKatalogService(pool);
  const keranjangService = createKeranjangService({
    repo: createKeranjangRepository(pool),
    detailLagu: (id) => katalogService.detailLagu(id),
  });
  const keranjangController = createKeranjangController({
    service: keranjangService,
  });
  const gateway =
    paymentGateway ??
    createMidtransGateway({
      serverKey: config.midtransServerKey,
      isProduction: config.midtransProduction,
    });
  const pembelianController = createPembelianController({
    service: createPembelianService(pool, gateway),
  });
  const webhookController = createWebhookController({
    service: createWebhookService(
      gateway,
      config.midtransServerKey,
      createPembelianWebhookService(pool),
    ),
  });

  app.use(createSessionMiddleware(pool, config));
  app.use(authMiddleware.muatAkunAktif);

  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    const body: HealthResponse = { status: "ok", database: "up" };
    res.json(body);
  });

  app.get("/api/konfigurasi", (_req, res) => {
    // Hanya kunci publik yang boleh sampai ke browser. Server key Midtrans
    // tidak pernah dikirim ke klien.
    const body: KonfigurasiResponse = {
      midtransClientKey: config.midtransClientKey,
      midtransSnapUrl: snapUrl(config.midtransProduction),
    };
    res.json(body);
  });

  const unduhanController = createUnduhanController({
    pool,
    audioDir: config.audioDir,
  });

  const katalogController = createKatalogController({
    service: katalogService,
    audioDir: config.audioDir,
  });

  app.use("/api", katalogRouter(katalogController));
  app.use("/api", unduhanRouter(unduhanController, authMiddleware));
  app.use("/api", keranjangRouter(keranjangController, authMiddleware));
  app.use("/api", pembelianRouter(pembelianController, authMiddleware));
  app.use("/api", webhookRouter(webhookController));
  app.use("/api/auth", createAuthRouter(authController));
  app.use("/api/profil", createProfilRouter(profilController, authMiddleware));
  app.use(
    "/api/admin",
    createAdminRouter({
      pool,
      config,
      authMiddleware,
      pelangganController,
    }),
  );

  app.use(handleError);

  return app;
}
