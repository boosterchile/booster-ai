/**
 * Task 12 — Integration test: POST /internal/safety-events
 *
 * Smoke-test end-to-end contra:
 *   - Postgres real (routing query vía Drizzle ORM)
 *   - Redis real (dedupe SET NX EX vía @testcontainers/redis)
 *   - OIDC client stubbeado (verifyIdToken no pega a la red)
 *   - sendWhatsapp espiado (verifica que no se llama cuando contentSid=undefined)
 *
 * Casos:
 *   1. notified   — empresa+vehículo+dueño activo → 200 { outcome: 'notified' }
 *                   + clave Redis safety:dedupe:<imei>:crash existe.
 *   2. deduped    — misma llamada inmediata → 200 { outcome: 'deduped' }
 *                   + sendWhatsapp NO llamado (contentSid undefined).
 *   3. 403        — email del SA stub no coincide con config → 403.
 *   4. unknown_vehicle — IMEI sin vehículo seedeado → 200 { outcome: 'unknown_vehicle' }.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@booster-ai/logger';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { LoginTicket, OAuth2Client, TokenPayload } from 'google-auth-library';
import { Hono } from 'hono';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createInternalSafetyEventsRoutes } from '../../src/routes/internal-safety-events.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

// ── Logger ────────────────────────────────────────────────────────────────────

const logger = createLogger({
  service: 'safety-events-integration',
  version: '0',
  level: 'silent',
  pretty: false,
});

// ── Constantes ────────────────────────────────────────────────────────────────

const CALLER_SA = 'safety-integration-test@booster-ai.iam.gserviceaccount.com';
const API_AUDIENCE = ['https://api.boosterchile.com'] as const;
/** IMEI de 15 dígitos único para este suite; lo compartimos entre tests que sí
 *  tienen vehículo seedeado. El IMEI desconocido usa un valor distinto. */
const TEST_IMEI = '123456700000001';
const UNKNOWN_IMEI = '999999999999999';

// ── OAuth2Client stub ─────────────────────────────────────────────────────────

function makeOAuthClient(email: string): OAuth2Client {
  const verifyIdToken = vi.fn(async () => {
    const payload: Partial<TokenPayload> = {
      email,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const ticket = {
      getPayload: () => payload as TokenPayload,
    } as LoginTicket;
    return ticket;
  });
  return { verifyIdToken } as unknown as OAuth2Client;
}

// ── Envelope builder ─────────────────────────────────────────────────────────

function makeEnvelope(event: unknown): Record<string, unknown> {
  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString('base64'),
      messageId: 'test-1',
    },
    subscription: 'test-sub',
  };
}

const VALID_EVENT = {
  eventType: 'crash' as const,
  imei: TEST_IMEI,
  occurredAt: '2026-06-15T14:32:00.000Z',
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('integration: POST /internal/safety-events', () => {
  let dbHandle: TestDbHandle;
  let container: StartedRedisContainer;
  let redis: Redis;

  // IDs del seed — rellenados en beforeEach para limpiar FK en orden correcto.
  let seedEmpresaId: string;
  let seedUserId: string;
  let _seedVehicleId: string;
  let seedMembershipId: string;

  beforeAll(async () => {
    dbHandle = createTestDb();

    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis({
      host: container.getHost(),
      port: container.getMappedPort(6379),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 1500,
      lazyConnect: true,
    });
    redis.on('error', () => undefined);
    await redis.connect();
    await redis.ping();
  }, 120_000);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop().catch(() => undefined);
    await dbHandle?.pool.end();
  });

  beforeEach(async () => {
    // ── cleanup previo (FK order: memberships → vehicles → users → empresas) ──
    await dbHandle.pool.query('DELETE FROM membresias WHERE id = $1', [
      seedMembershipId ?? '00000000-0000-0000-0000-000000000000',
    ]);
    await dbHandle.pool.query('DELETE FROM vehiculos WHERE empresa_id = $1', [
      seedEmpresaId ?? '00000000-0000-0000-0000-000000000000',
    ]);
    await dbHandle.pool.query("DELETE FROM usuarios WHERE email LIKE 'safety-integration-%'");
    await dbHandle.pool.query(
      "DELETE FROM empresas WHERE email_contacto LIKE 'safety-integration-%'",
    );
    await redis.flushdb();

    // ── Seed plan (gratis, onConflictDoNothing) ───────────────────────────────
    const { db } = dbHandle;
    const suffix = randomUUID().slice(0, 8);

    const [planRow] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan Gratis (integration)',
        description: 'Plan de fixture para integration tests',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });

    const planId =
      planRow?.id ??
      (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;

    if (!planId) {
      throw new Error('safety-events integration: no se pudo obtener un planId');
    }

    // ── Empresa transportista ─────────────────────────────────────────────────
    const [empresaRow] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Safety Integration SpA ${suffix}`,
        rut: `${Math.floor(10_000_000 + Math.random() * 89_999_999)}-K`,
        contactEmail: `safety-integration-empresa-${suffix}@test.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Av. Integración 100',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        planId,
      })
      .returning({ id: schema.empresas.id });

    if (!empresaRow) {
      throw new Error('safety-events integration: empresa no creada');
    }
    seedEmpresaId = empresaRow.id;

    // ── Vehículo con IMEI fijo ────────────────────────────────────────────────
    const [vehicleRow] = await db
      .insert(schema.vehicles)
      .values({
        empresaId: seedEmpresaId,
        plate: `SI${suffix.slice(0, 4).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
        teltonikaImei: TEST_IMEI,
      })
      .returning({ id: schema.vehicles.id });

    if (!vehicleRow) {
      throw new Error('safety-events integration: vehicle no creado');
    }
    _seedVehicleId = vehicleRow.id;

    // ── Usuario (dueño) ───────────────────────────────────────────────────────
    const [userRow] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-safety-integration-${suffix}`,
        email: `safety-integration-owner-${suffix}@test.invalid`,
        fullName: 'Safety Integration Dueño',
        status: 'activo',
      })
      .returning({ id: schema.users.id });

    if (!userRow) {
      throw new Error('safety-events integration: usuario no creado');
    }
    seedUserId = userRow.id;

    // ── Membership dueño activa ───────────────────────────────────────────────
    const [membershipRow] = await db
      .insert(schema.memberships)
      .values({
        userId: seedUserId,
        empresaId: seedEmpresaId,
        role: 'dueno',
        status: 'activa',
      })
      .returning({ id: schema.memberships.id });

    if (!membershipRow) {
      throw new Error('safety-events integration: membership no creada');
    }
    seedMembershipId = membershipRow.id;
  });

  // ── Helper: construye la app con el stub de OIDC indicado ────────────────

  function makeApp(callerSaEmail: string, sendWhatsappSpy = vi.fn().mockResolvedValue(undefined)) {
    const app = new Hono();
    app.route(
      '/internal/safety-events',
      createInternalSafetyEventsRoutes({
        db: dbHandle.db,
        redis,
        logger,
        config: {
          safetyPushCallerSa: CALLER_SA,
          apiAudience: API_AUDIENCE,
          contentSidSafetyAlert: undefined,
        },
        sendWhatsapp: sendWhatsappSpy,
        oauthClient: makeOAuthClient(callerSaEmail),
        // routeRecipients y dispatch NO inyectados → usa los reales (integration point)
      }),
    );
    return { app, sendWhatsappSpy };
  }

  // ── Test 1: notified ──────────────────────────────────────────────────────

  it('notified: empresa+vehículo+dueño activo → 200 { outcome: "notified" } + clave Redis', async () => {
    const { app } = makeApp(CALLER_SA);

    const res = await app.request('/internal/safety-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer faketoken',
      },
      body: JSON.stringify(makeEnvelope(VALID_EVENT)),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe('notified');

    // Verificar clave de dedupe en Redis
    const dedupeKey = `safety:dedupe:${TEST_IMEI}:crash`;
    const redisVal = await redis.get(dedupeKey);
    expect(redisVal).toBeTruthy();
  });

  // ── Test 2: deduped ───────────────────────────────────────────────────────

  it('deduped: segunda llamada inmediata → 200 { outcome: "deduped" } + sendWhatsapp no llamado', async () => {
    const sendWhatsappSpy = vi.fn().mockResolvedValue(undefined);
    const { app } = makeApp(CALLER_SA, sendWhatsappSpy);

    const envelope = makeEnvelope(VALID_EVENT);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer faketoken',
    };

    // Primera llamada → notified (setea la clave Redis)
    const first = await app.request('/internal/safety-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { outcome: string }).outcome).toBe('notified');

    // Segunda llamada → deduped (la clave ya existe)
    const second = await app.request('/internal/safety-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { outcome: string };
    expect(secondBody.outcome).toBe('deduped');

    // contentSidSafetyAlert = undefined → sendWhatsapp NUNCA debe llamarse
    expect(sendWhatsappSpy).not.toHaveBeenCalled();
  });

  // ── Test 3: 403 por SA incorrecto ─────────────────────────────────────────

  it('403: email del SA stub no coincide con config → 403', async () => {
    const { app } = makeApp('attacker@evil.iam.gserviceaccount.com');

    const res = await app.request('/internal/safety-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer faketoken',
      },
      body: JSON.stringify(makeEnvelope(VALID_EVENT)),
    });

    expect(res.status).toBe(403);
  });

  // ── Test 4: unknown_vehicle ───────────────────────────────────────────────

  it('unknown_vehicle: IMEI sin vehículo seedeado → 200 { outcome: "unknown_vehicle" }', async () => {
    const { app } = makeApp(CALLER_SA);

    const unknownEvent = {
      eventType: 'crash' as const,
      imei: UNKNOWN_IMEI,
      occurredAt: '2026-06-15T14:32:00.000Z',
    };

    const res = await app.request('/internal/safety-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer faketoken',
      },
      body: JSON.stringify(makeEnvelope(unknownEvent)),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe('unknown_vehicle');
  });
});
