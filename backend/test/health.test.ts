import pg from "pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { healthResponseSchema } from "@musicpedia/shared";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { withTransaction } from "../src/db.ts";
import { penerbitNoop } from "../src/notifikasi/penerbit.ts";
import { testDatabaseUrl } from "./global-setup.ts";

const databaseUrl = testDatabaseUrl();
const pool = new pg.Pool({ connectionString: databaseUrl });
afterAll(() => pool.end());

describe("GET /api/health", () => {
  it("melaporkan database aktif dengan bentuk yang sesuai skema shared", async () => {
    const app = createApp({
      pool,
      config: { ...loadConfig(), databaseUrl },
      penerbitEmail: penerbitNoop,
    });
    const res = await request(app).get("/api/health").expect(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: "ok",
      database: "up",
    });
  });

  it("menjalankan migrasi pada database tes", async () => {
    const { rows } = await pool.query("SELECT to_regclass('pgmigrations') AS t");
    expect(rows[0].t).toBe("pgmigrations");
  });
});

describe("withTransaction", () => {
  it("commit saat berhasil dan rollback saat gagal", async () => {
    await pool.query("DROP TABLE IF EXISTS tx_probe");
    await pool.query("CREATE TABLE tx_probe (n int)");

    await withTransaction(pool, (db) => db.query("INSERT INTO tx_probe VALUES (1)"));
    await expect(
      withTransaction(pool, async (db) => {
        await db.query("INSERT INTO tx_probe VALUES (2)");
        throw new Error("gagal");
      }),
    ).rejects.toThrow("gagal");

    const { rows } = await pool.query("SELECT n FROM tx_probe");
    expect(rows).toEqual([{ n: 1 }]);
  });
});
