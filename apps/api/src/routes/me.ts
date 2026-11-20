import type { Logger } from '@booster-ai/logger';
import { mismoRut, profileUpdateInputSchema } from '@booster-ai/shared-schemas';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { correoEnListaRespaldo, tieneAccesoPlataforma } from '../auth/acceso-plataforma.js';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { asignacionConConductor, vehiculoDeAsignacion } from '../db/configuracion-de-asignacion.js';
import {
  assignments,
  carrierMemberships,
  conductores,
  empresas,
  memberships,
  organizacionesStakeholder,
  paradasRuta,
  rutas,
  tripChangeRequests,
  trips,
  users,
  vehicles,
} from '../db/schema.js';
import { zValidator } from '../lib/validation.js';
import { extractClientIp } from '../middleware/client-ip.js';
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import { cuentaCreadaPorSolicitud } from '../services/cuenta-proveedor-reutilizable.js';

/**
 * GET /me — endpoint que el cliente web llama post-login con Firebase.
 * No usa userContext middleware porque el user puede no existir todavía.
 *
 * PATCH /me/profile — actualización parcial. RUT inmutable si ya está
 * declarado.
 */
export function createMeRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me hit without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userRows = await opts.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    let user = userRows[0];

    // ---------------------------------------------------------------------
    // Account linking automático: si no hay match por firebase_uid PERO
    // hay match por email Y el provider verificó el email (Google, etc),
    // actualizamos el firebase_uid del user existente al nuevo y lo usamos.
    //
    // Por qué es seguro: el provider OAuth (Google, Apple, etc) ya
    // demostró control del email. Si Felipe se registró con email/password
    // el martes y hoy se loguea con Google del mismo email verificado,
    // confiamos en el provider y linkeamos.
    //
    // Riesgo NO mitigado: email/password con email_verified=false. Por eso
    // restringimos a email_verified=true (Google y otros OAuth lo dan
    // siempre; email/password requiere flow explícito de verificación).
    //
    // Nota: si en el futuro permitimos email/password sin verificación,
    // habría que NO linkear desde provider verificado a email/password no
    // verificado para prevenir hijack.
    //
    // Una cuenta del proveedor creada al aprobar una solicitud entra solo por
    // el onboarding (`.specs/correos-solicitudes-panel` SC6): ni este vínculo
    // ni la cuenta de la lista de abajo. Se reconoce porque su uid es el
    // `firebase_uid` de una solicitud, y se consulta solo cuando /me está por
    // vincular o por crear la cuenta de la lista.
    // ---------------------------------------------------------------------
    let deSolicitud: boolean | undefined;
    const esCuentaDeSolicitud = async (): Promise<boolean> => {
      if (deSolicitud === undefined) {
        deSolicitud = await cuentaCreadaPorSolicitud(opts.db, claims.uid);
        if (deSolicitud) {
          opts.logger.info(
            { firebaseUid: claims.uid },
            '/me: cuenta creada por una aprobación; entra por el onboarding',
          );
        }
      }
      return deSolicitud;
    };

    if (!user && claims.email && claims.emailVerified) {
      const byEmail = await opts.db
        .select()
        .from(users)
        .where(eq(users.email, claims.email))
        .limit(1);
      const existing = byEmail[0];
      if (existing && !(await esCuentaDeSolicitud())) {
        opts.logger.info(
          {
            userId: existing.id,
            email: claims.email,
            oldFirebaseUid: existing.firebaseUid,
            newFirebaseUid: claims.uid,
          },
          'account linking: actualizando firebase_uid del user existente',
        );
        const linkedRows = await opts.db
          .update(users)
          .set({ firebaseUid: claims.uid, updatedAt: new Date() })
          .where(eq(users.id, existing.id))
          .returning();
        user = linkedRows[0] ?? existing;
      }
    }

    // ---------------------------------------------------------------------
    // Primer admin (`.specs/acceso-panel-plataforma` SC2). Si el correo de
    // Firebase está en la lista de respaldo `BOOSTER_PLATFORM_ADMIN_EMAILS`
    // y no hay cuenta, se crea marcada y activa para que `/me` devuelva
    // `needs_onboarding=false` y no quede en el flujo de /onboarding. Es solo
    // para la lista de respaldo: el resto del personal se da de alta en el
    // panel y activa en /activar. Exige que el proveedor haya verificado el
    // correo (`.specs/bordes-autenticacion` SC2), igual que el account linking
    // de arriba, y que la cuenta no venga de una aprobación (SC6).
    // ---------------------------------------------------------------------
    if (!user && claims.email && claims.emailVerified) {
      if (
        correoEnListaRespaldo(claims.email, appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS) &&
        !(await esCuentaDeSolicitud())
      ) {
        const fullName = claims.name?.trim() ?? claims.email.split('@')[0] ?? 'Platform Admin';
        const inserted = await opts.db
          .insert(users)
          .values({
            firebaseUid: claims.uid,
            email: claims.email,
            fullName,
            isPlatformAdmin: true,
            status: 'activo',
          })
          .returning();
        user = inserted[0];
        opts.logger.info(
          { email: claims.email, userId: user?.id },
          'platform admin auto-provisioned from allowlist',
        );
      }
    }

    if (!user) {
      return c.json({
        needs_onboarding: true,
        firebase: {
          uid: claims.uid,
          email: claims.email,
          name: claims.name,
          picture: claims.picture,
          email_verified: claims.emailVerified,
        },
      });
    }

    // Memberships en empresas (innerJoin filtra automáticamente las que
    // tengan organizacionStakeholderId NOT NULL por XOR).
    const empresaRows = await opts.db
      .select({ membership: memberships, empresa: empresas })
      .from(memberships)
      .innerJoin(empresas, eq(memberships.empresaId, empresas.id))
      .where(eq(memberships.userId, user.id));

    // Memberships en organizaciones stakeholder (ADR-034). Query
    // separado porque el JOIN apunta a tabla distinta.
    const stakeholderOrgRows = await opts.db
      .select({
        membership: memberships,
        org: organizacionesStakeholder,
      })
      .from(memberships)
      .innerJoin(
        organizacionesStakeholder,
        eq(memberships.organizacionStakeholderId, organizacionesStakeholder.id),
      )
      .where(eq(memberships.userId, user.id));

    /**
     * Shape unificada: cada membership tiene `empresa` o
     * `organizacion_stakeholder` populated, no ambas (XOR de DB).
     */
    type MembershipPayload = {
      id: string;
      role: (typeof memberships.role.enumValues)[number];
      puede_aceptar_ofertas: boolean;
      status: (typeof memberships.status.enumValues)[number];
      joined_at: Date | null;
      empresa: {
        id: string;
        legal_name: string | null;
        rut: string;
        is_generador_carga: boolean;
        is_transportista: boolean;
        status: (typeof empresas.status.enumValues)[number];
      } | null;
      organizacion_stakeholder: {
        id: string;
        nombre_legal: string;
        tipo: (typeof organizacionesStakeholder.tipo.enumValues)[number];
        region_ambito: string | null;
        sector_ambito: string | null;
      } | null;
    };

    const empresaMemberships: MembershipPayload[] = empresaRows.map((r) => ({
      id: r.membership.id,
      role: r.membership.role,
      puede_aceptar_ofertas: r.membership.puedeAceptarOfertas === true,
      status: r.membership.status,
      joined_at: r.membership.joinedAt,
      empresa: {
        id: r.empresa.id,
        legal_name: r.empresa.legalName,
        rut: r.empresa.rut,
        is_generador_carga: r.empresa.isGeneradorCarga,
        is_transportista: r.empresa.isTransportista,
        status: r.empresa.status,
      },
      organizacion_stakeholder: null,
    }));

    const stakeholderMemberships: MembershipPayload[] = stakeholderOrgRows.map((r) => ({
      id: r.membership.id,
      role: r.membership.role,
      puede_aceptar_ofertas: r.membership.puedeAceptarOfertas === true,
      status: r.membership.status,
      joined_at: r.membership.joinedAt,
      empresa: null,
      organizacion_stakeholder: {
        id: r.org.id,
        nombre_legal: r.org.nombreLegal,
        tipo: r.org.tipo,
        region_ambito: r.org.regionAmbito,
        sector_ambito: r.org.sectorAmbito,
      },
    }));

    const membershipsPayload: MembershipPayload[] = [
      ...empresaMemberships,
      ...stakeholderMemberships,
    ];

    const requestedEmpresaId = c.req.header('x-empresa-id');
    const activeMembershipsList = membershipsPayload.filter((m) => m.status === 'activa');
    let active: MembershipPayload | null = null;
    if (requestedEmpresaId) {
      // El header `x-empresa-id` puede referir a empresa o a org stakeholder
      // (frontend reusa el mismo header como "entidad activa").
      active =
        activeMembershipsList.find(
          (m) =>
            m.empresa?.id === requestedEmpresaId ||
            m.organizacion_stakeholder?.id === requestedEmpresaId,
        ) ?? null;
    }
    // Fallback al primer activeMembership si:
    //   - no hay requestedEmpresaId (no header), o
    //   - el header tiene un UUID que NO matchea ninguna membership del user
    //     (caso típico: localStorage stale del browser después de cambiar de
    //     cuenta, ej. user A logueado deja activeEmpresaId=X, después
    //     user B se loguea y X no es suya → null sin fallback dejaba la
    //     PWA en "Sin empresa activa" cuando el user SÍ tiene empresa).
    if (!active && activeMembershipsList.length > 0) {
      active = activeMembershipsList[0] ?? null;
    }

    // La ficha es la del propio usuario (como #814: usuario_id + LIMIT 1),
    // viva y de la empresa activa. El RUT se compara recién sobre esa fila,
    // no contra las demás fichas de la empresa.
    let fichaConductorMismoRut = false;
    if (active?.empresa) {
      const fichaRows = await opts.db
        .select({ rut: users.rut })
        .from(conductores)
        .innerJoin(users, eq(conductores.userId, users.id))
        .where(
          and(
            eq(conductores.userId, user.id),
            eq(conductores.empresaId, active.empresa.id),
            isNull(conductores.deletedAt),
          ),
        )
        .limit(1);
      const ficha = fichaRows[0];
      fichaConductorMismoRut = ficha != null && mismoRut(ficha.rut, user.rut);
    }

    // La misma regla que `requirePlatformAdmin` (`.specs/acceso-panel-plataforma`
    // SC1): la web muestra el panel solo a quien el API deja entrar.
    const isPlatformAdmin = tieneAccesoPlataforma(user, appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS);

    return c.json({
      needs_onboarding: false,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName,
        phone: user.phone,
        whatsapp_e164: user.whatsappE164,
        rut: user.rut,
        is_platform_admin: isPlatformAdmin,
        status: user.status,
        // ADR-035 Wave 4 PR 3 — flag para que el frontend detecte que
        // necesita forzar rotación de clave en el próximo login legacy.
        // No exponemos el hash, solo si está seteada. NULL = el usuario
        // no completó la migración → frontend muestra modal forzado.
        has_clave_numerica: user.claveNumericaHash != null,
      },
      memberships: membershipsPayload,
      active_membership: active,
      ficha_conductor_mismo_rut: fichaConductorMismoRut,
      // Mismo booleano, con el nombre de #814, para clientes que todavía
      // leen ese campo. La tarjeta de voz usa `esOwnerOperator`.
      tiene_ficha_conductor: fichaConductorMismoRut,
    });
  });

  // ---------------------------------------------------------------------
  // GET /me/assignments — assignments donde el user autenticado es
  // el conductor asignado (assignments.driver_user_id === user.id).
  //
  // Devuelve los assignments activos (status IN ['asignado', 'en_proceso'])
  // ordenados por más reciente primero. Sin paginación por ahora: un
  // conductor rara vez tiene > 2-3 assignments activos simultáneos.
  //
  // Uso: la UI /app/conductor (dashboard del conductor) lista los
  // assignments y deja al conductor elegir cuál activar (en vez de pedir
  // UUID copiado, que era el placeholder MVP). El conductor sólo ve los
  // que están en estado
  // operacional — si necesita el histórico (entregados), iría a otra
  // surface dedicada (futuro).
  //
  // Auth: solo Firebase claims. NO requiere activeMembership (un
  // conductor multi-empresa puede ver todos sus assignments sin tener
  // que setear empresa activa). Pero igual scope al user.id.
  // ---------------------------------------------------------------------
  app.get('/assignments', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      return c.json({ error: 'internal_server_error' }, 500);
    }
    const userRows = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: 'user_not_found', code: 'user_not_found' }, 404);
    }

    // Estados activos del assignment según assignmentStatusEnum:
    //   asignado → carrier aceptó, todavía no se recoge la carga
    //   recogido → conductor confirmó recogida, en tránsito a destino
    // Excluímos: entregado (terminal), cancelado (terminal).
    const ACTIVE_STATUSES = ['asignado', 'recogido'] as const;
    const rows = await opts.db
      .select({
        assignmentId: assignments.id,
        assignmentStatus: assignments.status,
        empresaId: assignments.empresaId,
        empresaLegalName: empresas.legalName,
        acceptedAt: assignments.acceptedAt,
        pickedUpAt: assignments.pickedUpAt,
        agreedPriceClp: assignments.agreedPriceClp,
        tripId: trips.id,
        trackingCode: trips.trackingCode,
        tripStatus: trips.status,
        originAddressRaw: trips.originAddressRaw,
        originRegionCode: trips.originRegionCode,
        destinationAddressRaw: trips.destinationAddressRaw,
        destinationRegionCode: trips.destinationRegionCode,
        cargoType: trips.cargoType,
        cargoWeightKg: trips.cargoWeightKg,
        pickupWindowStart: trips.pickupWindowStart,
        pickupWindowEnd: trips.pickupWindowEnd,
        // editar-anular-cargas §12-P4: el conductor ve contacto, notas y referencia.
        consigneeName: trips.consigneeName,
        consigneeWhatsappE164: trips.consigneeWhatsappE164,
        notes: trips.notes,
        reference: trips.reference,
        // editar-anular-cargas §12-P7: el conductor solo sabe que hay un cambio
        // pendiente, nunca los datos propuestos.
        cambioPendienteEn: sql<Date | string | null>`(
          select ${tripChangeRequests.createdAt} from ${tripChangeRequests}
          where ${tripChangeRequests.tripId} = ${trips.id}
            and ${tripChangeRequests.status} = 'pendiente'
          limit 1
        )`,
        vehicleId: vehiculoDeAsignacion,
        vehiclePlate: vehicles.plate,
        vehicleTeltonikaImei: vehicles.teltonikaImei,
        rutaId: assignments.rutaId,
      })
      .from(assignments)
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .leftJoin(empresas, eq(empresas.id, assignments.empresaId))
      .leftJoin(vehicles, eq(vehicles.id, vehiculoDeAsignacion))
      .where(and(asignacionConConductor(user.id), inArray(assignments.status, ACTIVE_STATUSES)))
      .orderBy(desc(assignments.acceptedAt));

    // Helper: serializar Dates de Drizzle de forma defensiva — un Date
    // con NaN time (raro pero ocurre con TZ awareness rara de pg) rompe
    // todo el response al hacer JSON.stringify implícito (toISOString
    // throws RangeError). Mejor null que 500.
    const safeIso = (d: unknown): string | null => {
      if (d == null) {
        return null;
      }
      if (d instanceof Date) {
        const t = d.getTime();
        return Number.isNaN(t) ? null : d.toISOString();
      }
      return typeof d === 'string' ? d : null;
    };

    // Hoja de ruta (spec ruta-parada-servicio §4.8): las paradas de cada ruta
    // del conductor, en orden. Incluye las ya resueltas y las de servicios
    // entregados o cancelados, para que el orden se entienda completo.
    const rutaIds = [...new Set(rows.map((r) => r.rutaId).filter((id): id is string => !!id))];
    const paradas =
      rutaIds.length === 0
        ? []
        : await opts.db
            .select({
              rutaId: paradasRuta.rutaId,
              rutaEstado: rutas.status,
              orden: paradasRuta.orden,
              tipo: paradasRuta.tipo,
              resolvedAt: paradasRuta.resolvedAt,
              assignmentId: assignments.id,
              assignmentStatus: assignments.status,
              trackingCode: trips.trackingCode,
              originAddressRaw: trips.originAddressRaw,
              destinationAddressRaw: trips.destinationAddressRaw,
              pickupWindowStart: trips.pickupWindowStart,
              pickupWindowEnd: trips.pickupWindowEnd,
              consigneeName: trips.consigneeName,
              consigneeWhatsappE164: trips.consigneeWhatsappE164,
              notes: trips.notes,
              reference: trips.reference,
              cargoType: trips.cargoType,
              cargoWeightKg: trips.cargoWeightKg,
            })
            // rls-allowlist: scope por conductor (rutas.conductor_id = user.id), como el SELECT de arriba
            .from(paradasRuta)
            .innerJoin(rutas, eq(rutas.id, paradasRuta.rutaId))
            .innerJoin(trips, eq(trips.id, paradasRuta.tripId))
            .innerJoin(
              assignments,
              and(
                eq(assignments.tripId, paradasRuta.tripId),
                eq(assignments.rutaId, paradasRuta.rutaId),
              ),
            )
            // Solo rutas donde este usuario es el conductor declarado.
            .where(and(inArray(paradasRuta.rutaId, rutaIds), eq(rutas.driverUserId, user.id)))
            .orderBy(asc(paradasRuta.rutaId), asc(paradasRuta.orden));
    const hojas = rutaIds.flatMap((id) => {
      const suyas = paradas.filter((p) => p.rutaId === id);
      const [primera] = suyas;
      if (!primera) {
        return [];
      }
      return [
        {
          id,
          estado: primera.rutaEstado,
          paradas: suyas.map((p) => {
            const esEntrega = p.tipo === 'entrega';
            return {
              orden: p.orden,
              tipo: p.tipo,
              resuelta_en: safeIso(p.resolvedAt),
              asignacion_id: p.assignmentId,
              cancelado: p.assignmentStatus === 'cancelado',
              codigo_seguimiento: p.trackingCode,
              direccion: esEntrega ? p.destinationAddressRaw : p.originAddressRaw,
              ventana: esEntrega
                ? null
                : { desde: safeIso(p.pickupWindowStart), hasta: safeIso(p.pickupWindowEnd) },
              // El contacto de la entrega es el destinatario (§12-P4 de editar-anular-cargas).
              contacto:
                esEntrega && (p.consigneeName || p.consigneeWhatsappE164)
                  ? { nombre: p.consigneeName, telefono_e164: p.consigneeWhatsappE164 }
                  : null,
              notas: p.notes,
              referencia: p.reference,
              tipo_carga: p.cargoType,
              peso_kg: p.cargoWeightKg,
            };
          }),
        },
      ];
    });

    return c.json({
      rutas: hojas,
      assignments: rows.map((r) => ({
        id: r.assignmentId,
        ruta_id: r.rutaId ?? null,
        status: r.assignmentStatus,
        accepted_at: safeIso(r.acceptedAt),
        picked_up_at: safeIso(r.pickedUpAt),
        agreed_price_clp: r.agreedPriceClp,
        carrier_empresa: {
          id: r.empresaId,
          legal_name: r.empresaLegalName,
        },
        // has_teltonika decide en la PWA si el teléfono debe reportar posición
        // (sin equipo) o si el camión ya lo hace solo (tarjeta guiada).
        vehicle: r.vehicleId
          ? {
              id: r.vehicleId,
              plate: r.vehiclePlate ?? null,
              has_teltonika: r.vehicleTeltonikaImei != null,
            }
          : null,
        trip: {
          id: r.tripId,
          tracking_code: r.trackingCode,
          status: r.tripStatus,
          origin: {
            address_raw: r.originAddressRaw,
            region_code: r.originRegionCode,
          },
          destination: {
            address_raw: r.destinationAddressRaw,
            region_code: r.destinationRegionCode,
          },
          cargo_type: r.cargoType,
          cargo_weight_kg: r.cargoWeightKg,
          pickup_window_start: safeIso(r.pickupWindowStart),
          pickup_window_end: safeIso(r.pickupWindowEnd),
          consignee: { name: r.consigneeName, phone_e164: r.consigneeWhatsappE164 },
          notes: r.notes,
          reference: r.reference,
          cambio_pendiente: r.cambioPendienteEn
            ? { existe: true, creado_en: safeIso(r.cambioPendienteEn) }
            : null,
        },
      })),
    });
  });

  app.patch('/profile', zValidator('json', profileUpdateInputSchema), async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/me/profile hit without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const userRows = await opts.db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json(
        {
          error: 'user_not_found',
          message: 'El usuario no existe en la DB. Completa onboarding primero.',
        },
        404,
      );
    }

    const input = c.req.valid('json');

    if (input.rut !== undefined && user.rut !== null) {
      return c.json(
        {
          error: 'rut_immutable',
          message: 'El RUT ya está declarado. Para cambiarlo, contacta soporte.',
        },
        409,
      );
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.full_name !== undefined) {
      patch.fullName = input.full_name;
    }
    if (input.phone !== undefined) {
      patch.phone = input.phone;
    }
    if (input.whatsapp_e164 !== undefined) {
      patch.whatsappE164 = input.whatsapp_e164;
    }
    if (input.rut !== undefined) {
      patch.rut = input.rut;
    }

    const updatedRows = await opts.db
      .update(users)
      .set(patch)
      .where(eq(users.id, user.id))
      .returning();
    const updated = updatedRows[0];
    if (!updated) {
      opts.logger.error({ userId: user.id }, '/me/profile UPDATE returning empty');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    return c.json({
      user: {
        id: updated.id,
        email: updated.email,
        full_name: updated.fullName,
        phone: updated.phone,
        whatsapp_e164: updated.whatsappE164,
        rut: updated.rut,
        is_platform_admin: tieneAccesoPlataforma(updated, appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS),
        status: updated.status,
      },
    });
  });

  /**
   * POST /me/consent/terms-v2 — registra la aceptación de T&Cs v2
   * por parte del carrier (ADR-031 §4).
   *
   * Resuelve la empresa activa del user vía el header `X-Empresa-Id`
   * (mismo patrón que el resto de endpoints). Si esa empresa tiene una
   * `carrier_memberships` activa, popula `consent_terms_v2_aceptado_en`
   * con `now()` + IP + user-agent.
   *
   * Idempotente: si ya hay consent (no-null), retorna 200 con el
   * timestamp original (no se sobrescribe — la fecha del primer
   * consent es la legalmente vinculante).
   */
  app.post('/consent/terms-v2', async (c) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const empresaIdHeader = c.req.header('x-empresa-id');
    if (!empresaIdHeader) {
      return c.json(
        {
          error: 'no_active_empresa',
          message: 'Header X-Empresa-Id requerido',
        },
        400,
      );
    }

    // Verificar que el user pertenece a esa empresa con membership
    // activa (RLS aplicación-enforced).
    const userRows = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.firebaseUid, claims.uid))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      return c.json({ error: 'user_not_found' }, 404);
    }

    const memshipRows = await opts.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.empresaId, empresaIdHeader),
          eq(memberships.status, 'activa'),
        ),
      )
      .limit(1);
    if (!memshipRows[0]) {
      return c.json(
        {
          error: 'forbidden_no_membership',
          message: 'No tienes membership activa en esta empresa',
        },
        403,
      );
    }

    // Lookup carrier_memberships activa de la empresa.
    const carrierMemRows = await opts.db
      .select({
        id: carrierMemberships.id,
        consentTermsV2AceptadoEn: carrierMemberships.consentTermsV2AceptadoEn,
      })
      .from(carrierMemberships)
      .where(
        and(
          eq(carrierMemberships.empresaId, empresaIdHeader),
          eq(carrierMemberships.status, 'activa'),
        ),
      )
      .limit(1);
    const carrierMem = carrierMemRows[0];
    if (!carrierMem) {
      return c.json(
        {
          error: 'no_carrier_membership',
          message:
            'Tu empresa no tiene una membresía de transportista activa. Esta funcionalidad es solo para transportistas.',
        },
        409,
      );
    }

    // Idempotencia: si ya hay consent, no sobrescribir.
    if (carrierMem.consentTermsV2AceptadoEn) {
      return c.json({
        ok: true,
        accepted_at: carrierMem.consentTermsV2AceptadoEn.toISOString(),
        already_accepted: true,
      });
    }

    const now = new Date();
    // IP confiable (penúltima entry del XFF bajo GCLB — middleware/client-ip):
    // es evidencia de consentimiento Ley 19.628; XFF[0] era falsificable
    // por el propio cliente (spec fix-xff-trust-boundary).
    const trustedIp = extractClientIp(c.req.header('x-forwarded-for'));
    const ip = trustedIp === 'unknown' ? null : trustedIp;
    const userAgent = c.req.header('user-agent') ?? null;

    await opts.db
      .update(carrierMemberships)
      .set({
        consentTermsV2AceptadoEn: now,
        consentTermsV2Ip: ip,
        consentTermsV2UserAgent: userAgent,
        updatedAt: now,
      })
      .where(eq(carrierMemberships.id, carrierMem.id));

    opts.logger.info(
      {
        userId: user.id,
        empresaId: empresaIdHeader,
        carrierMembershipId: carrierMem.id,
        ip,
      },
      'consent terms-v2 aceptado',
    );

    return c.json({
      ok: true,
      accepted_at: now.toISOString(),
      already_accepted: false,
    });
  });

  /**
   * GET /me/consent/terms-v2 — consulta si el carrier ya aceptó.
   * Útil para que el frontend decida mostrar el banner.
   */
  app.get('/consent/terms-v2', async (c) => {
    const empresaIdHeader = c.req.header('x-empresa-id');
    if (!empresaIdHeader) {
      return c.json({ accepted: false, reason: 'no_active_empresa' });
    }

    const carrierMemRows = await opts.db
      .select({
        consentTermsV2AceptadoEn: carrierMemberships.consentTermsV2AceptadoEn,
      })
      .from(carrierMemberships)
      .where(
        and(
          eq(carrierMemberships.empresaId, empresaIdHeader),
          eq(carrierMemberships.status, 'activa'),
        ),
      )
      .limit(1);
    const carrierMem = carrierMemRows[0];
    if (!carrierMem) {
      // No es carrier → no aplica T&Cs v2; reportar accepted=true para
      // que el frontend no muestre banner a empresas no-transportistas.
      return c.json({ accepted: true, reason: 'not_a_carrier' });
    }

    if (carrierMem.consentTermsV2AceptadoEn) {
      return c.json({
        accepted: true,
        accepted_at: carrierMem.consentTermsV2AceptadoEn.toISOString(),
      });
    }
    return c.json({ accepted: false, reason: 'pending' });
  });

  return app;
}
