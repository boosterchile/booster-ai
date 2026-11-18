import { and, desc, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { posicionesMovilConductor, telemetryPoints } from '../db/schema.js';
import { coordenadaGpsValidaSql } from './coordenada-gps.js';

/**
 * Última posición conocida de un conjunto de vehículos, cada uno desde la
 * fuente que le corresponde. Lo usan la flota de una empresa
 * (`GET /vehiculos/flota`) y la flota de todas las empresas en el panel de
 * plataforma (`.specs/flota-plataforma`).
 */
export interface VehiculoConEquipo {
  readonly id: string;
  readonly teltonika_imei: string | null;
  readonly teltonika_imei_espejo: string | null;
}

export interface UltimoPunto {
  timestamp_device: Date;
  latitude: string | null;
  longitude: string | null;
  speed_kmh: number | null;
  angle_deg: number | null;
}

/** Devuelve la última posición por id de vehículo. Sin posición, el id no está. */
export async function ultimasPosicionesDeVehiculos(
  db: Db,
  vehicleRows: readonly VehiculoConEquipo[],
): Promise<Map<string, UltimoPunto>> {
  type LastPoint = UltimoPunto;
  // D1/D2 — Particionamos los vehículos en tres grupos:
  //   - withOwnDevice: tienen teltonika_imei propio → lookup por
  //     vehicle_id (path histórico, eficiente con indice ya existente).
  //   - withMirrorImei: solo tienen espejo → lookup por imei. Su data
  //     pertenece al stream de otro vehículo físico (demo o redundancia).
  //   - withoutDevice: sin Teltonika → lookup en posiciones_movil_conductor
  //     por vehicle_id (D2 browser GPS).
  const withOwnDevice = vehicleRows.filter((v) => v.teltonika_imei != null);
  const withMirrorImei = vehicleRows.filter(
    (v) => v.teltonika_imei == null && v.teltonika_imei_espejo != null,
  );
  const withoutDevice = vehicleRows.filter(
    (v) => v.teltonika_imei == null && v.teltonika_imei_espejo == null,
  );

  const ownVehicleIds = withOwnDevice.map((v) => v.id);
  const ownLastPoints =
    ownVehicleIds.length === 0
      ? []
      : await db
          .selectDistinctOn([telemetryPoints.vehicleId], {
            vehicle_id: telemetryPoints.vehicleId,
            timestamp_device: telemetryPoints.timestampDevice,
            latitude: telemetryPoints.latitude,
            longitude: telemetryPoints.longitude,
            speed_kmh: telemetryPoints.speedKmh,
            angle_deg: telemetryPoints.angleDeg,
          })
          .from(telemetryPoints)
          // Última posición VÁLIDA por vehículo: descarta null + "null island"
          // (0,0) para que el marcador de flota no caiga en el Golfo de Guinea.
          .where(
            and(
              inArray(telemetryPoints.vehicleId, ownVehicleIds),
              coordenadaGpsValidaSql(telemetryPoints.latitude, telemetryPoints.longitude),
            ),
          )
          .orderBy(telemetryPoints.vehicleId, desc(telemetryPoints.timestampDevice));
  const lastByVehicleId = new Map<string, LastPoint>();
  for (const p of ownLastPoints) {
    if (p.vehicle_id != null) {
      lastByVehicleId.set(p.vehicle_id, p);
    }
  }

  const mirrorImeis = [
    ...new Set(
      withMirrorImei.map((v) => v.teltonika_imei_espejo).filter((x): x is string => x != null),
    ),
  ];
  const mirrorLastPoints =
    mirrorImeis.length === 0
      ? []
      : await db
          .selectDistinctOn([telemetryPoints.imei], {
            imei: telemetryPoints.imei,
            timestamp_device: telemetryPoints.timestampDevice,
            latitude: telemetryPoints.latitude,
            longitude: telemetryPoints.longitude,
            speed_kmh: telemetryPoints.speedKmh,
            angle_deg: telemetryPoints.angleDeg,
          })
          .from(telemetryPoints)
          .where(
            and(
              inArray(telemetryPoints.imei, mirrorImeis),
              coordenadaGpsValidaSql(telemetryPoints.latitude, telemetryPoints.longitude),
            ),
          )
          .orderBy(telemetryPoints.imei, desc(telemetryPoints.timestampDevice));
  const lastByImei = new Map<string, LastPoint>();
  for (const p of mirrorLastPoints) {
    lastByImei.set(p.imei, p);
  }

  // D2 — Browser GPS lookup para vehículos sin Teltonika.
  const noDeviceVehicleIds = withoutDevice.map((v) => v.id);
  const browserLastPoints =
    noDeviceVehicleIds.length === 0
      ? []
      : await db
          .selectDistinctOn([posicionesMovilConductor.vehicleId], {
            vehicle_id: posicionesMovilConductor.vehicleId,
            timestamp_device: posicionesMovilConductor.timestampDevice,
            latitude: posicionesMovilConductor.latitude,
            longitude: posicionesMovilConductor.longitude,
            speed_kmh: posicionesMovilConductor.speedKmh,
            heading_deg: posicionesMovilConductor.headingDeg,
          })
          .from(posicionesMovilConductor)
          .where(inArray(posicionesMovilConductor.vehicleId, noDeviceVehicleIds))
          .orderBy(
            posicionesMovilConductor.vehicleId,
            desc(posicionesMovilConductor.timestampDevice),
          );
  const browserByVehicleId = new Map<string, LastPoint>();
  for (const p of browserLastPoints) {
    browserByVehicleId.set(p.vehicle_id, {
      timestamp_device: p.timestamp_device,
      latitude: p.latitude,
      longitude: p.longitude,
      speed_kmh: p.speed_kmh != null ? Number.parseFloat(p.speed_kmh) : null,
      angle_deg: p.heading_deg,
    });
  }

  const posiciones = new Map<string, UltimoPunto>();
  for (const v of vehicleRows) {
    const punto = v.teltonika_imei
      ? lastByVehicleId.get(v.id)
      : v.teltonika_imei_espejo
        ? lastByImei.get(v.teltonika_imei_espejo)
        : browserByVehicleId.get(v.id);
    if (punto) {
      posiciones.set(v.id, punto);
    }
  }
  return posiciones;
}
