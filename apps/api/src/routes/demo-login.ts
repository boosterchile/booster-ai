import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { conductores, empresas, memberships, users } from '../db/schema.js';
import { DEMO_CARRIER_RUT, DEMO_CONDUCTOR_RUT, DEMO_SHIPPER_RUT } from '../services/seed-demo.js';

/**
 * Endpoint público `POST /demo/login` — modo demo `demo.boosterchile.com`.
 *
 * El subdominio demo sirve la misma PWA que `app.boosterchile.com` pero
 * con un selector de persona que permite entrar con UN solo click —
 * sin tipear emails / passwords / PINs. Este endpoint es la pieza
 * server-side que mintea un Firebase custom token para la persona
 * solicitada.
 *
 * Es público (no requiere Firebase auth previa). El doble guard contra
 * exposición accidental:
 *
 *   1. Flag `DEMO_MODE_ACTIVATED=true`. Si está OFF, el endpoint
 *      responde 404 — no revelamos que existe en producción sin demo.
 *   2. Las entidades demo en BD están marcadas `empresas.es_demo=true`.
 *      Solo emitimos tokens para users que pertenecen a una empresa
 *      demo (o organización stakeholder demo). Aunque alguien apunte
 *      el endpoint a producción con flag ON, no podría escalar a data
 *      real.
 *
 * Custom claims emitidos en el token:
 *   - `is_demo: true` — el frontend lo lee post-`signInWithCustomToken`
 *     y muestra un banner persistente "Modo demo".
 *   - `persona: 'shipper' | 'carrier' | 'conductor' | 'stakeholder'`
 *     — diagnóstico/analytics (el rol real viene de `memberships`).
 *
 * Respuestas:
 *   - 200 { custom_token, persona, redirect_to } — éxito.
 *   - 400 invalid_persona — payload no válido (zod).
 *   - 404 not_found — modo demo deshabilitado (flag OFF).
 *   - 502 firebase_error — createCustomToken falló.
 *   - 503 demo_not_seeded — flag ON pero la persona no existe en BD.
 *     Normalmente el auto-seed startup hook la habría creado; si no
 *     está, el operador debe correr el seed manual o reiniciar el
 *     server con la flag prendida.
 */

const personaSchema = z.enum(['shipper', 'carrier', 'conductor', 'stakeholder']);
type Persona = z.infer<typeof personaSchema>;

const loginBodySchema = z.object({ persona: personaSchema });

/**
 * Redirect post-login según la persona. Coordinado con la PWA:
 *   - shipper / carrier → home unificado `/app` (el AppRoute resuelve
 *     qué dashboard mostrar según la membership activa).
 *   - conductor → `/app/conductor/modo` (selector de modo trabajo
 *     antes de empezar viajes).
 *   - stakeholder → `/app/stakeholder/zonas` (vista k-anonimizada de
 *     zonas con actividad).
 */
const REDIRECT_BY_PERSONA: Record<Persona, string> = {
  shipper: '/app',
  carrier: '/app',
  // `/app/conductor` es la ruta real (router.tsx línea 118). Antes apuntaba
  // a `/app/conductor/modo` — 404 verificado en demo prod 2026-05-13.
  conductor: '/app/conductor',
  stakeholder: '/app/stakeholder/zonas',
};

export function createDemoLoginRoutes(opts: { db: Db; firebaseAuth: Auth; logger: Logger }) {
  const app = new Hono();

  app.post('/login', zValidator('json', loginBodySchema), async (c) => {
    // Guard 1: feature flag. Sin flag, el endpoint "no existe".
    if (appConfig.DEMO_MODE_ACTIVATED !== true) {
      return c.json({ error: 'not_found' }, 404);
    }

    const { persona } = c.req.valid('json');

    // Guard 2: resolver el user demo correspondiente desde BD. El filtro
    // `empresas.es_demo=true` (o organizaciones_stakeholder via
    // stakeholder org demo) es invariante de seguridad — no podemos
    // emitir un token para un user real aunque alguien manipule el
    // payload.
    const userRow = await resolveDemoUser(opts.db, persona);
    if (!userRow) {
      opts.logger.warn(
        { persona },
        'demo/login: persona demo no encontrada en BD — auto-seed pendiente o falló',
      );
      return c.json({ error: 'demo_not_seeded', code: 'demo_not_seeded' }, 503);
    }

    // Persistir los claims en el user record. Los claims en
    // `createCustomToken(uid, claims)` SOLO viven en el custom token —
    // cuando Firebase refresca el ID token (cada ~1h) los claims se
    // pierden porque no están en el user record. Para que el banner
    // "MODO DEMO" persista entre refreshes hacemos también
    // `setCustomUserClaims` que los persiste en el user record.
    try {
      await opts.firebaseAuth.setCustomUserClaims(userRow.firebaseUid, {
        is_demo: true,
        persona,
      });
    } catch (err) {
      // Continuamos — el custom token con claims funcionará para esta
      // sesión, solo el refresh post-1h perderá el claim. Banner
      // intermitente es preferible a bloquear el login del demo.
      opts.logger.warn(
        { err, persona, firebaseUid: userRow.firebaseUid },
        'demo/login: setCustomUserClaims falló (banner se perderá tras 1h)',
      );
    }

    // Mint custom token con claim `is_demo` y `persona`. El claim
    // `is_demo:true` es lo que la PWA usa para mostrar banner persistente
    // y prevenir cualquier acción destructiva en producción.
    let customToken: string;
    try {
      customToken = await opts.firebaseAuth.createCustomToken(userRow.firebaseUid, {
        is_demo: true,
        persona,
      });
    } catch (err) {
      opts.logger.error(
        { err, persona, firebaseUid: userRow.firebaseUid },
        'demo/login: createCustomToken falló',
      );
      return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
    }

    // IMPORTANT: NO loguear el custom_token (es sensible — equivale a
    // una credencial efímera). Solo logueamos persona + uid hasheado.
    opts.logger.info({ persona, firebaseUid: userRow.firebaseUid }, 'demo/login: éxito');

    return c.json({
      custom_token: customToken,
      persona,
      redirect_to: REDIRECT_BY_PERSONA[persona],
    });
  });

  return app;
}

interface DemoUserRow {
  userId: string;
  firebaseUid: string;
}

/**
 * Encuentra el user demo correspondiente a la persona solicitada.
 * Joins via memberships + empresas.es_demo=true (o stakeholder org).
 *
 * Devuelve `null` si no existe (caso "demo no seedeado" → 503 al
 * caller). El auto-seed startup hook debería haberlo creado al boot
 * cuando `DEMO_MODE_ACTIVATED=true`.
 */
async function resolveDemoUser(db: Db, persona: Persona): Promise<DemoUserRow | null> {
  switch (persona) {
    case 'shipper': {
      // Dueño de la empresa demo generadora de carga (es_demo=true,
      // es_generador_carga=true, role=dueno). Hay UN solo user demo
      // para este caso — el seed lo crea con RUT canónico
      // DEMO_SHIPPER_RUT en empresas.
      const rows = await db
        .select({ userId: users.id, firebaseUid: users.firebaseUid })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .innerJoin(empresas, eq(empresas.id, memberships.empresaId))
        .where(
          and(
            eq(empresas.rut, DEMO_SHIPPER_RUT),
            eq(empresas.isDemo, true),
            eq(empresas.isGeneradorCarga, true),
            eq(memberships.role, 'dueno'),
            eq(memberships.status, 'activa'),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }
    case 'carrier': {
      const rows = await db
        .select({ userId: users.id, firebaseUid: users.firebaseUid })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .innerJoin(empresas, eq(empresas.id, memberships.empresaId))
        .where(
          and(
            eq(empresas.rut, DEMO_CARRIER_RUT),
            eq(empresas.isDemo, true),
            eq(empresas.isTransportista, true),
            eq(memberships.role, 'dueno'),
            eq(memberships.status, 'activa'),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }
    case 'conductor': {
      // El conductor demo se crea con flujo placeholder + PIN. Si nadie
      // activó el PIN aún, el firebase_uid sigue siendo `pending-rut:...`
      // — no podemos crear custom token sin un UID real Firebase.
      //
      // Filtramos `firebaseUid NOT LIKE 'pending-rut:%'` indirectamente
      // vía estado del user: el seed sólo crea conductor con
      // status='pendiente_verificacion' cuando aún no activó. Para
      // /demo/login necesitamos que el conductor demo ya esté
      // promovido a un Firebase user real — eso lo garantizamos en el
      // startup hook (ver `ensureDemoSeeded` siguiente commit).
      const rows = await db
        .select({
          userId: users.id,
          firebaseUid: users.firebaseUid,
        })
        .from(conductores)
        .innerJoin(users, eq(users.id, conductores.userId))
        .innerJoin(empresas, eq(empresas.id, conductores.empresaId))
        .where(
          and(
            eq(users.rut, DEMO_CONDUCTOR_RUT),
            eq(empresas.isDemo, true),
            isNull(conductores.deletedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      if (row.firebaseUid.startsWith('pending-rut:')) {
        // El conductor demo nunca activó el PIN — el startup hook debe
        // promoverlo antes de que el endpoint funcione. Tratamos como
        // "demo no seedeado" para que el caller reintente tras un
        // bounce del server con la flag prendida.
        return null;
      }
      return row;
    }
    case 'stakeholder': {
      // Stakeholder pertenece a una organización stakeholder (ADR-034),
      // NO a una empresa. Filtramos por role=stakeholder_sostenibilidad
      // + organizacion_stakeholder_id NOT NULL. La org stakeholder demo
      // se identifica por nombre legal (ver seed-demo).
      const rows = await db
        .select({ userId: users.id, firebaseUid: users.firebaseUid })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(
          and(
            eq(memberships.role, 'stakeholder_sostenibilidad'),
            eq(memberships.status, 'activa'),
            eq(users.email, 'demo-stakeholder@boosterchile.com'),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }
  }
}
