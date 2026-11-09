import type { Logger } from '@booster-ai/logger';
import {
  type ConfirmarAccesoBoosterErrorCode,
  confirmarAccesoBoosterResponseSchema,
  confirmarAccesoBoosterSchema,
} from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { zValidator } from '../lib/validation.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { confirmarAccesoBooster } from '../services/confirmacion-acceso-booster.js';
import { enviarAvisoAccesoPanel } from '../services/notifications/aviso-acceso-panel-email.js';
import type { EmailSender } from '../services/notifications/email-sender.js';
import type { UserContext } from '../services/user-context.js';

/** Mismo cuerpo que el impersonation-write-guard. */
const ESCRITURA_IMPERSONADA = {
  error: 'forbidden_impersonation_write',
  code: 'forbidden_impersonation_write',
} as const;

const CODIGO_INVALIDO: ConfirmarAccesoBoosterErrorCode = 'codigo_invalido';

/** Si no se encuentra el correo de quien emitió el código, el aviso dice esto. */
const EMISOR_SIN_CORREO = 'un admin de Booster';

/**
 * `POST /me/confirmar-acceso-booster` (`.specs/confirmar-acceso-booster`).
 *
 * La persona confirma desde su sesión el código que el admin de Booster le
 * entregó en persona al darla de alta en el panel del personal. Si coincide
 * con su confirmación pendiente, está vigente y le quedan intentos, la cuenta
 * queda marcada como personal (`es_admin_plataforma = true`) y la regla única
 * de acceso (`auth/acceso-plataforma.ts`) le da el panel desde la request
 * siguiente si la cuenta está activa.
 *
 * - Solo con la sesión de la persona: el usuario sale del userContext, nunca
 *   del body. En una sesión de impersonación es una escritura bloqueada
 *   (403), también si la empresa activa es de prueba.
 * - Todo rechazo es la misma 400 `codigo_invalido`: sin confirmación
 *   pendiente, cuenta que no está activa, código incorrecto, vencido o sin
 *   intentos.
 * - Cinco intentos fallidos por código; al quinto el admin emite otro.
 * - La confirmación deja el evento `personal_booster.acceso_otorgado` y avisa
 *   a la lista de respaldo. Todo lo que necesitan se lee en la transacción:
 *   después del commit no hay lecturas que puedan fallar. El código no entra
 *   a logs, spans, métricas, auditoría ni avisos.
 */
export function createMeConfirmarAccesoBoosterRoutes(opts: {
  db: Db;
  logger: Logger;
  /** `config.BOOSTER_PLATFORM_ADMIN_EMAILS`: recibe el aviso de acceso otorgado. */
  platformAdminEmails: readonly string[];
  emailSender: EmailSender;
  /** Base del enlace al panel del personal en el aviso. */
  webAppUrl: string;
}): Hono {
  const app = new Hono();

  app.post('/', zValidator('json', confirmarAccesoBoosterSchema), async (c) => {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const usuarioId = userContext.user.id;
    const { codigo } = c.req.valid('json');

    return await withBusinessSpan(
      { name: 'personal_booster.confirmar_acceso', attributes: { 'booster.user_id': usuarioId } },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('personal_booster_confirmacion_total').add(1, { resultado });
          setResultAttributes(span, { 'personal_booster.resultado': resultado });
        };

        if (userContext.impersonatedBy) {
          record('impersonacion');
          opts.logger.warn(
            {
              event_type: 'personal_booster.confirmacion_impersonada',
              user_id: usuarioId,
              impersonated_by: userContext.impersonatedBy,
            },
            'personal-booster: confirmación bloqueada en una sesión de impersonación',
          );
          return c.json(ESCRITURA_IMPERSONADA, 403);
        }

        const ahora = new Date();
        const resultado = await opts.db.transaction((tx) =>
          confirmarAccesoBooster(tx, { usuarioId, codigo, ahora }),
        );

        if (resultado.tipo === 'rechazada') {
          record(resultado.motivo);
          opts.logger.info(
            {
              event_type: 'personal_booster.confirmacion_rechazada',
              user_id: usuarioId,
              motivo: resultado.motivo,
              ...(resultado.intentosFallidos === null
                ? {}
                : { intentos_fallidos: resultado.intentosFallidos }),
            },
            'personal-booster: confirmación rechazada (código no logueado)',
          );
          return c.json({ error: CODIGO_INVALIDO, code: CODIGO_INVALIDO }, 400);
        }

        record('confirmado');
        const { persona, emitidoPorUsuarioId, emitidoPorEmail } = resultado;

        if (resultado.yaMarcada) {
          opts.logger.info(
            {
              event_type: 'personal_booster.confirmacion_sin_cambios',
              actor_user_id: emitidoPorUsuarioId,
              user_id: persona.id,
            },
            'personal-booster: confirmación consumida en una cuenta ya marcada',
          );
        } else {
          // Nunca lanza: cada fallo de envío queda registrado.
          const aviso = await enviarAvisoAccesoPanel({
            sender: opts.emailSender,
            logger: opts.logger,
            accion: 'confirmado',
            destinatarios: opts.platformAdminEmails,
            persona: { userId: persona.id, nombre: persona.fullName, email: persona.email },
            actorEmail: emitidoPorEmail ?? EMISOR_SIN_CORREO,
            webAppUrl: opts.webAppUrl,
          });
          opts.logger.info(
            {
              event_type: 'personal_booster.acceso_otorgado',
              actor_user_id: emitidoPorUsuarioId,
              user_id: persona.id,
              via: 'confirmacion',
              avisos_destinatarios: aviso.destinatarios,
              avisos_enviados: aviso.enviados,
            },
            'personal-booster: acceso al panel confirmado por la persona',
          );
        }

        return c.json(
          confirmarAccesoBoosterResponseSchema.parse({ ok: true, user_id: persona.id }),
          200,
        );
      },
    );
  });

  return app;
}
