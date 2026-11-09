import type { Logger } from '@booster-ai/logger';
import {
  type PersonalBooster,
  type PersonalBoosterErrorCode,
  type VinculoPersonalBooster,
  altaPersonalBoosterResponseSchema,
  altaPersonalBoosterSchema,
  listaPersonalBoosterResponseSchema,
  quitarAccesoPersonalBoosterResponseSchema,
  reemitirCodigoPersonalBoosterResponseSchema,
} from '@booster-ai/shared-schemas';
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { correoEnListaRespaldo } from '../auth/acceso-plataforma.js';
import type { Db } from '../db/client.js';
import { esEmailDuplicado, esFirebaseUidDuplicado, esRutDuplicado } from '../db/pg-error.js';
import { users } from '../db/schema.js';
import { zValidator } from '../lib/validation.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { generateActivationPin, hashActivationPin } from '../services/activation-pin.js';
import { enviarAvisoAccesoPanel } from '../services/notifications/aviso-acceso-panel-email.js';
import { enviarCorreoActivacionPersonalBooster } from '../services/notifications/cuenta-activacion-email.js';
import type { EmailSender } from '../services/notifications/email-sender.js';
import {
  CODIGO_ACTIVACION_TTL_MS,
  PENDING_FIREBASE_UID_PREFIX,
  clasificarVinculoPersona,
  codigoPersonalVigente,
} from '../services/vinculo-persona.js';

/** Cota del listado: el personal de Booster es de decenas, no de miles. */
const LIMITE_PERSONAL = 500;

/** La lista de Terraform se compara en minúsculas y sin repetidos. */
function normalizarLista(emails: readonly string[]): string[] {
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0))];
}

function isoONull(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

type RechazoAlta = Extract<PersonalBoosterErrorCode, 'rut_mismatch' | 'rut_already_registered'>;

type ResultadoAlta =
  | { tipo: 'rechazo'; code: RechazoAlta }
  | {
      tipo: 'registrada';
      userId: string;
      vinculo: VinculoPersonalBooster;
      /** Si el alta dejó la cuenta con `es_admin_plataforma = true`. */
      marcada: boolean;
      /** La cuenta no estaba marcada antes de esta alta (o es nueva). */
      accesoOtorgado: boolean;
      /** Código en claro: solo para la respuesta y el correo. Nunca a un log. */
      codigo: string | null;
      expira: Date | string | null;
      email: string;
      nombre: string;
    };

/**
 * Personal de Booster desde el panel (`.specs/alta-personal-booster` y
 * `.specs/acceso-panel-plataforma`).
 *
 *   GET  /admin/personal-booster                       → lista del personal
 *   POST /admin/personal-booster                       → alta con correo, nombre
 *                                                        y RUT: otorga el acceso
 *   POST /admin/personal-booster/:userId/codigo        → código nuevo para quien
 *                                                        no activó
 *   POST /admin/personal-booster/:userId/quitar-acceso → quita el acceso
 *
 * **El panel otorga y quita el acceso.** La regla de acceso
 * (`auth/acceso-plataforma.ts`) da el panel a la cuenta marcada con
 * `es_admin_plataforma = true` y activa, o a un correo de la lista de respaldo
 * `BOOSTER_PLATFORM_ADMIN_EMAILS` (Terraform, para el primer admin). El alta
 * marca toda cuenta que registra; la baja la desmarca. Cada alta que otorga el
 * acceso y cada baja dejan un evento de auditoría y avisan a la lista de
 * respaldo.
 *
 * **Principio de identidad.** El admin carga datos, nunca la clave. El código
 * se guarda solo como hash con su vencimiento en `activacion_vence_en`, sale
 * una vez en la respuesta y por correo a la persona. No entra a logs, spans,
 * auditoría ni avisos. Una cuenta que ya eligió su clave nunca
 * recibe un código nuevo, y el alta no cambia RUT, nombre ni correo de una
 * cuenta existente.
 *
 * **Código de la provisoria existente.** Se conserva solo si lo emitió el
 * panel y sigue vigente (`activacion_vence_en` existe y no pasó). Sin código,
 * con uno que no emitió el panel o con el del panel vencido, se emite uno
 * nuevo con su vencimiento: una cuenta marcada se activa solo con un código
 * del panel (`/auth/activar`).
 *
 * **Cuenta ya activa.** Queda marcada y con acceso desde el alta. El panel le
 * pide al admin confirmarlo con la persona, y la lista de respaldo recibe el
 * aviso.
 *
 * **Quitar acceso.** Desmarca la cuenta. No aplica a un correo de la lista de
 * respaldo (ese acceso se quita en Terraform) ni deja el panel sin nadie con
 * acceso. La lectura bloquea las cuentas marcadas hasta el commit, para que
 * dos bajas en paralelo no se salten esa regla. Si la cuenta no activó, su
 * código del panel deja de servir.
 *
 * Auditoría: log estructurado con `event_type` `personal_booster.*` (qué
 * admin, a quién por `user_id`, qué vínculo), igual que las demás rutas admin.
 */
export function createAdminPersonalBoosterRoutes(opts: {
  db: Db;
  logger: Logger;
  /**
   * `config.BOOSTER_PLATFORM_ADMIN_EMAILS`: la lista de respaldo. Recibe los
   * avisos de acceso otorgado y quitado.
   */
  platformAdminEmails: readonly string[];
  emailSender: EmailSender;
  /** Base del enlace a `/activar` del correo. */
  webAppUrl: string;
}): Hono {
  const app = new Hono();
  const userIdParamSchema = z.object({ userId: z.string().uuid() });

  app.get('/', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    return await withBusinessSpan({ name: 'personal_booster.listar' }, async (span) => {
      const lista = normalizarLista(opts.platformAdminEmails);
      const marcadas = eq(users.isPlatformAdmin, true);
      // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
      const filas = await opts.db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          rut: users.rut,
          firebaseUid: users.firebaseUid,
          claveNumericaHash: users.claveNumericaHash,
          activationPinHash: users.activationPinHash,
          activacionVenceEn: users.activacionVenceEn,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(
          lista.length > 0
            ? or(marcadas, inArray(sql<string>`lower(${users.email})`, lista))
            : marcadas,
        )
        .orderBy(users.email)
        .limit(LIMITE_PERSONAL);

      const porCorreo = new Map<string, PersonalBooster>();
      for (const fila of filas) {
        const clave = fila.email.toLowerCase();
        if (porCorreo.has(clave)) {
          continue;
        }
        const activa = clasificarVinculoPersona(fila) === 'cuenta_activa';
        porCorreo.set(clave, {
          email: fila.email,
          en_lista: lista.includes(clave),
          user_id: fila.id,
          nombre: fila.fullName,
          rut: fila.rut,
          estado: activa ? 'activa' : 'pendiente_activacion',
          expira_en: activa ? null : isoONull(fila.activacionVenceEn),
          ultimo_login_en: activa ? isoONull(fila.lastLoginAt) : null,
        });
      }
      for (const email of lista) {
        if (!porCorreo.has(email)) {
          porCorreo.set(email, {
            email,
            en_lista: true,
            user_id: null,
            nombre: null,
            rut: null,
            estado: 'sin_cuenta',
            expira_en: null,
            ultimo_login_en: null,
          });
        }
      }

      const personal = [...porCorreo.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, persona]) => persona);

      getBusinessCounter('personal_booster_listado_total').add(1, { resultado: 'ok' });
      setResultAttributes(span, {
        'personal_booster.total': personal.length,
        'personal_booster.sin_cuenta': personal.filter((p) => p.estado === 'sin_cuenta').length,
        'personal_booster.pendientes': personal.filter((p) => p.estado === 'pendiente_activacion')
          .length,
      });

      return c.json(listaPersonalBoosterResponseSchema.parse({ personal }), 200);
    });
  });

  app.post('/', zValidator('json', altaPersonalBoosterSchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    const body = c.req.valid('json');
    const enLista = normalizarLista(opts.platformAdminEmails).includes(body.email);

    return await withBusinessSpan(
      { name: 'personal_booster.alta', attributes: { 'personal_booster.en_lista': enLista } },
      async (span) => {
        const record = (resultado: string, vinculo?: VinculoPersonalBooster) => {
          getBusinessCounter('personal_booster_alta_total').add(1, {
            resultado,
            en_lista: String(enLista),
            ...(vinculo ? { vinculo } : {}),
          });
          setResultAttributes(span, {
            'personal_booster.resultado': resultado,
            'personal_booster.vinculo': vinculo,
          });
        };

        const ahora = new Date();
        const venceEn = new Date(ahora.getTime() + CODIGO_ACTIVACION_TTL_MS);

        let resultado: ResultadoAlta;
        try {
          resultado = await opts.db.transaction(async (tx): Promise<ResultadoAlta> => {
            // La persona se identifica por su correo: es lo que la lista de
            // Terraform nombra. El RUT tiene que coincidir con el de su cuenta.
            // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
            const porEmail = await tx
              .select({
                id: users.id,
                email: users.email,
                fullName: users.fullName,
                rut: users.rut,
                firebaseUid: users.firebaseUid,
                claveNumericaHash: users.claveNumericaHash,
                activationPinHash: users.activationPinHash,
                activacionVenceEn: users.activacionVenceEn,
                isPlatformAdmin: users.isPlatformAdmin,
              })
              .from(users)
              .where(sql`lower(${users.email}) = ${body.email}`)
              // La fila queda bloqueada hasta el commit: una activación o una
              // re-emisión en paralelo espera y ve el estado que deja esta.
              .for('update')
              .limit(1);
            const existente = porEmail[0];

            if (existente) {
              // El RUT de una cuenta existente no se cambia, tampoco si falta.
              if (existente.rut !== body.rut) {
                return { tipo: 'rechazo', code: 'rut_mismatch' };
              }
              const clasificado = clasificarVinculoPersona(existente);
              // Se conserva solo un código que el panel del personal emitió a
              // esta cuenta ya marcada y que sigue vigente. Una provisoria que
              // todavía no era del personal recibe siempre uno nuevo: el que
              // tenía lo pudo conocer otra persona
              // (`.specs/acceso-panel-plataforma` SC3).
              const conservaCodigo =
                existente.isPlatformAdmin === true &&
                codigoPersonalVigente(existente.activacionVenceEn);
              const vinculo: VinculoPersonalBooster =
                clasificado === 'codigo_vigente' && !conservaCodigo
                  ? 'provisoria_sin_codigo'
                  : clasificado;
              const codigo = vinculo === 'provisoria_sin_codigo' ? generateActivationPin() : null;
              // El alta marca toda cuenta que registra: el panel otorga el
              // acceso (`.specs/acceso-panel-plataforma` SC3).
              // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
              await tx
                .update(users)
                .set({
                  isPlatformAdmin: true,
                  ...(codigo === null
                    ? {}
                    : {
                        activationPinHash: hashActivationPin(codigo),
                        activacionVenceEn: venceEn,
                      }),
                  updatedAt: ahora,
                })
                .where(eq(users.id, existente.id));
              return {
                tipo: 'registrada',
                userId: existente.id,
                vinculo,
                marcada: true,
                accesoOtorgado: existente.isPlatformAdmin !== true,
                codigo,
                expira:
                  codigo !== null
                    ? venceEn
                    : vinculo === 'codigo_vigente'
                      ? existente.activacionVenceEn
                      : null,
                email: existente.email,
                nombre: existente.fullName,
              };
            }

            // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
            const porRut = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.rut, body.rut))
              .limit(1);
            if (porRut[0]) {
              return { tipo: 'rechazo', code: 'rut_already_registered' };
            }

            const codigo = generateActivationPin();
            const insertados = await tx
              .insert(users)
              .values({
                firebaseUid: `${PENDING_FIREBASE_UID_PREFIX}${body.rut}`,
                email: body.email,
                fullName: body.full_name,
                rut: body.rut,
                activationPinHash: hashActivationPin(codigo),
                activacionVenceEn: venceEn,
                status: 'pendiente_verificacion',
                isPlatformAdmin: true,
              })
              .returning({ id: users.id });
            const creado = insertados[0];
            if (!creado) {
              throw new Error('admin-personal-booster: el INSERT de usuarios no devolvió fila');
            }
            return {
              tipo: 'registrada',
              userId: creado.id,
              vinculo: 'nueva',
              marcada: true,
              accesoOtorgado: true,
              codigo,
              expira: venceEn,
              email: body.email,
              nombre: body.full_name,
            };
          });
        } catch (err) {
          // Carrera contra otra alta del mismo RUT o correo: nada quedó escrito.
          // El uid provisorio sale del RUT, así que su UNIQUE también es el RUT.
          if (esRutDuplicado(err) || esFirebaseUidDuplicado(err)) {
            record('rut_already_registered');
            return c.json({ error: 'conflict', code: 'rut_already_registered' }, 409);
          }
          if (esEmailDuplicado(err)) {
            record('email_already_registered');
            return c.json({ error: 'conflict', code: 'email_already_registered' }, 409);
          }
          throw err;
        }

        if (resultado.tipo === 'rechazo') {
          record(resultado.code);
          return c.json({ error: 'conflict', code: resultado.code }, 409);
        }

        record('registrada', resultado.vinculo);
        opts.logger.info(
          {
            event_type: 'personal_booster.alta',
            actor_user_id: admin.userContext.user.id,
            user_id: resultado.userId,
            vinculo: resultado.vinculo,
            marcada: resultado.marcada,
            en_lista: enLista,
            codigo_emitido: resultado.codigo !== null,
          },
          'personal-booster: alta registrada (código no logueado)',
        );

        // El código sale por correo a la persona, esté o no en la lista de
        // respaldo: la lista ya no es condición para activar (SC3).
        if (resultado.codigo !== null) {
          await enviarCorreoActivacionPersonalBooster({
            sender: opts.emailSender,
            logger: opts.logger,
            userId: resultado.userId,
            email: resultado.email,
            nombre: resultado.nombre,
            rut: body.rut,
            codigo: resultado.codigo,
            webAppUrl: opts.webAppUrl,
          });
        }

        if (resultado.accesoOtorgado) {
          const aviso = await enviarAvisoAccesoPanel({
            sender: opts.emailSender,
            logger: opts.logger,
            accion: 'otorgado',
            destinatarios: opts.platformAdminEmails,
            persona: {
              userId: resultado.userId,
              nombre: resultado.nombre,
              email: resultado.email,
            },
            actorEmail: admin.adminEmail,
            webAppUrl: opts.webAppUrl,
          });
          opts.logger.info(
            {
              event_type: 'personal_booster.acceso_otorgado',
              actor_user_id: admin.userContext.user.id,
              user_id: resultado.userId,
              avisos_destinatarios: aviso.destinatarios,
              avisos_enviados: aviso.enviados,
            },
            'personal-booster: acceso al panel otorgado',
          );
        }

        return c.json(
          altaPersonalBoosterResponseSchema.parse({
            ok: true,
            user_id: resultado.userId,
            vinculo: resultado.vinculo,
            codigo_activacion: resultado.codigo,
            expira_en: isoONull(resultado.expira),
            en_lista: enLista,
          }),
          resultado.vinculo === 'nueva' ? 201 : 200,
        );
      },
    );
  });

  // Sin body a propósito: un zValidator json rechazaría el POST vacío.
  app.post('/:userId/codigo', zValidator('param', userIdParamSchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    const { userId } = c.req.valid('param');
    const lista = normalizarLista(opts.platformAdminEmails);

    return await withBusinessSpan(
      { name: 'personal_booster.reemitir_codigo', attributes: { 'booster.user_id': userId } },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('personal_booster_reemision_codigo_total').add(1, { resultado });
          setResultAttributes(span, { 'personal_booster.resultado': resultado });
        };

        const ahora = new Date();
        const venceEn = new Date(ahora.getTime() + CODIGO_ACTIVACION_TTL_MS);

        const resultado = await opts.db.transaction(async (tx) => {
          // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
          const filas = await tx
            .select({
              id: users.id,
              email: users.email,
              fullName: users.fullName,
              rut: users.rut,
              firebaseUid: users.firebaseUid,
              claveNumericaHash: users.claveNumericaHash,
              activationPinHash: users.activationPinHash,
              isPlatformAdmin: users.isPlatformAdmin,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const persona = filas[0];
          if (!persona?.isPlatformAdmin) {
            return { tipo: 'no_encontrada' } as const;
          }
          if (clasificarVinculoPersona(persona) === 'cuenta_activa') {
            return { tipo: 'ya_activada' } as const;
          }
          // El hash nuevo reemplaza al anterior: el código previo deja de servir.
          const codigo = generateActivationPin();
          // El UPDATE exige que la cuenta siga provisoria: si se activó entre
          // la lectura y esta escritura, no recibe código.
          // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
          const escritas = await tx
            .update(users)
            .set({
              activationPinHash: hashActivationPin(codigo),
              activacionVenceEn: venceEn,
              updatedAt: ahora,
            })
            .where(
              and(
                eq(users.id, persona.id),
                isNull(users.claveNumericaHash),
                like(users.firebaseUid, `${PENDING_FIREBASE_UID_PREFIX}%`),
              ),
            )
            .returning({ id: users.id });
          if (escritas.length === 0) {
            return { tipo: 'ya_activada' } as const;
          }
          return { tipo: 'emitido', persona, codigo } as const;
        });

        if (resultado.tipo === 'no_encontrada') {
          record('personal_not_found');
          return c.json({ error: 'not_found', code: 'personal_not_found' }, 404);
        }
        if (resultado.tipo === 'ya_activada') {
          record('already_activated');
          return c.json({ error: 'conflict', code: 'already_activated' }, 409);
        }

        const { persona, codigo } = resultado;
        const enLista = lista.includes(persona.email.toLowerCase());
        record('emitido');
        opts.logger.info(
          {
            event_type: 'personal_booster.reemision_codigo',
            actor_user_id: admin.userContext.user.id,
            user_id: persona.id,
            en_lista: enLista,
          },
          'personal-booster: código reemitido (código no logueado)',
        );

        if (persona.rut !== null) {
          await enviarCorreoActivacionPersonalBooster({
            sender: opts.emailSender,
            logger: opts.logger,
            userId: persona.id,
            email: persona.email,
            nombre: persona.fullName,
            rut: persona.rut,
            codigo,
            webAppUrl: opts.webAppUrl,
          });
        }

        return c.json(
          reemitirCodigoPersonalBoosterResponseSchema.parse({
            ok: true,
            user_id: persona.id,
            codigo_activacion: codigo,
            expira_en: venceEn.toISOString(),
            en_lista: enLista,
          }),
          200,
        );
      },
    );
  });

  // Sin body a propósito, como la re-emisión.
  app.post('/:userId/quitar-acceso', zValidator('param', userIdParamSchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    const { userId } = c.req.valid('param');
    const lista = normalizarLista(opts.platformAdminEmails);

    return await withBusinessSpan(
      { name: 'personal_booster.quitar_acceso', attributes: { 'booster.user_id': userId } },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('personal_booster_quitar_acceso_total').add(1, { resultado });
          setResultAttributes(span, { 'personal_booster.resultado': resultado });
        };

        const resultado = await opts.db.transaction(async (tx) => {
          // Todas las cuentas marcadas, bloqueadas hasta el commit y en orden
          // fijo: dos bajas en paralelo se ordenan y la segunda ve lo que dejó
          // la primera.
          // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
          const marcadas = await tx
            .select({
              id: users.id,
              email: users.email,
              fullName: users.fullName,
              firebaseUid: users.firebaseUid,
              claveNumericaHash: users.claveNumericaHash,
              activationPinHash: users.activationPinHash,
              activacionVenceEn: users.activacionVenceEn,
              status: users.status,
            })
            .from(users)
            .where(eq(users.isPlatformAdmin, true))
            .orderBy(users.id)
            .for('update')
            .limit(LIMITE_PERSONAL);

          const persona = marcadas.find((m) => m.id === userId);
          if (!persona) {
            return { tipo: 'no_encontrada' } as const;
          }
          if (correoEnListaRespaldo(persona.email, lista)) {
            return { tipo: 'en_lista_respaldo' } as const;
          }
          // Quién conserva el acceso: las otras cuentas marcadas y activas, y
          // los correos de la lista de respaldo.
          const otrasConAcceso = marcadas.filter(
            (m) => m.id !== persona.id && m.status === 'activo',
          ).length;
          if (otrasConAcceso + lista.length === 0) {
            return { tipo: 'ultimo_acceso' } as const;
          }

          // Si no activó, el código del panel deja de servir: sin la marca ya
          // no activaría como personal. Un código de otro flujo no se toca.
          const invalidarCodigo =
            clasificarVinculoPersona(persona) !== 'cuenta_activa' &&
            persona.activacionVenceEn !== null;
          // rls-allowlist: admin platform-wide update — protegido por requirePlatformAdmin.
          const escritas = await tx
            .update(users)
            .set({
              isPlatformAdmin: false,
              ...(invalidarCodigo ? { activationPinHash: null, activacionVenceEn: null } : {}),
              updatedAt: new Date(),
            })
            .where(and(eq(users.id, persona.id), eq(users.isPlatformAdmin, true)))
            .returning({ id: users.id });
          if (escritas.length === 0) {
            return { tipo: 'no_encontrada' } as const;
          }
          return { tipo: 'quitado', persona, invalidarCodigo } as const;
        });

        if (resultado.tipo === 'no_encontrada') {
          record('personal_not_found');
          return c.json({ error: 'not_found', code: 'personal_not_found' }, 404);
        }
        if (resultado.tipo === 'en_lista_respaldo') {
          record('en_lista_respaldo');
          return c.json({ error: 'conflict', code: 'en_lista_respaldo' }, 409);
        }
        if (resultado.tipo === 'ultimo_acceso') {
          record('ultimo_acceso');
          return c.json({ error: 'conflict', code: 'ultimo_acceso' }, 409);
        }

        const { persona, invalidarCodigo } = resultado;
        record('quitado');
        const aviso = await enviarAvisoAccesoPanel({
          sender: opts.emailSender,
          logger: opts.logger,
          accion: 'quitado',
          destinatarios: opts.platformAdminEmails,
          persona: { userId: persona.id, nombre: persona.fullName, email: persona.email },
          actorEmail: admin.adminEmail,
          webAppUrl: opts.webAppUrl,
        });
        opts.logger.info(
          {
            event_type: 'personal_booster.acceso_quitado',
            actor_user_id: admin.userContext.user.id,
            user_id: persona.id,
            codigo_invalidado: invalidarCodigo,
            avisos_destinatarios: aviso.destinatarios,
            avisos_enviados: aviso.enviados,
          },
          'personal-booster: acceso al panel quitado',
        );

        return c.json(
          quitarAccesoPersonalBoosterResponseSchema.parse({ ok: true, user_id: persona.id }),
          200,
        );
      },
    );
  });

  return app;
}
