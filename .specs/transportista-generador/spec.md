# Spec — Transportista que también genera carga (historia 0)

**Estado**: aceptada por el brief de la historia 0 · **Fecha**: 2026-10-19
**Alcance**: solo la activación del rol. Flota propia, red de asociados y asignación directa quedan fuera.

## Hallazgo (paso 1)

Van Oosterwyk (`empresas.id = 60c344e0-b925-43a6-a7b3-aa6b07fac721`) **no** opera los dos roles en la misma fila. Dato de prod, solo SELECT, aportado por el PO el 2026-10-19: `es_transportista = true` y `es_generador_carga = false`. Quien publica cargas en el piloto es otra empresa, Prueba Generador SpA. Este agente no consultó prod.

Los dos flags ya existen (`empresas.es_generador_carga`, `empresas.es_transportista`, default `false`) y el modelo los admite a la vez (`packages/shared-schemas/src/domain/empresa.ts`). Se prenden solo al **crear** la fila:

- `POST /admin/empresas` (`routes/admin-empresa-miembros.ts`) y el alta de `services/onboarding.ts` copian los booleanos del body.
- `PATCH /admin/empresas/:id` solo cambia `estado`. No edita los flags.
- No hay otro endpoint, ni en admin ni en onboarding, que prenda `es_generador_carga` sobre una empresa ya creada.

La navegación ya es dual si los dos flags están en true. `navSectionsForMe` muestra Transporte y Generador. El inicio del transportista (`InicioTransportista`, #792) se renderiza cuando `is_transportista` es true, y debajo se agrega la sección «Como generador de carga» si también es generador. Un transportista puro no ve esa sección. Publicar en `POST /trip-requests-v2` exige `isGeneradorCarga` y estampa `generador_carga_empresa_id` con la empresa activa. Un transportista puro sigue en `403 not_a_shipper`. No se cambian las query keys de `cache-pantallas.test.tsx`.

Lo que falta es el camino de producto para prender el flag sin SQL. Se reutiliza el gate que ya cuida esa ficha: `requirePlatformAdmin` en `/admin/empresas`, la misma audiencia que crea la empresa y le cambia el estado. No se abre un segundo camino para el dueño de la empresa. Felipe lo activa desde `/app/platform-admin/empresas` (filtro Activas) después del deploy.

La auditoría sigue el patrón de gestión de flota (`gestion_flota_activada_en` / `_por`): dos columnas nulas, quién y cuándo. El flag en sí no se migra.

## Entradas

- Empresa con `es_transportista = true` y `es_generador_carga = false`.
- Llamador platform-admin (`BOOSTER_PLATFORM_ADMIN_EMAILS`).

## Salidas

1. `POST /admin/empresas/:id/activar-generador-carga` (sin body).
   - 200: `es_generador_carga = true`, `es_transportista` sigue `true`.
   - Idempotente: si ya era generador, 200 `unchanged: true` y no reescribe quién ni cuándo.
   - 403 `forbidden_platform_admin` para quien no está en la allowlist (conductor, despachador, dueño de la empresa).
   - 404 si la empresa no existe.
   - 409 `not_a_transportista` si no es transportista.
   - Log estructurado con el email del admin, el id de empresa y el antes/después. Columnas `generador_carga_activado_en` y `generador_carga_activado_por` solo en la transición false → true.
2. En Empresas del platform-admin, la fila transportista sin el rol muestra «Generar carga». Al confirmar, la fila pasa a «generador de carga» y el botón desaparece.
3. Cobro UF: un transportista que también es generador **no** suma `suscripcion_generador`. Paga lo mismo que pagaba como transportista. Un generador puro sigue pagando su UF. Desviación explícita de ADR-079 §4 (una factura con las dos líneas) pedida por esta historia; el ADR no se edita.
4. Migración `0063` aditiva (dos columnas nulas) y su `down` manual.

## Fuera de alcance

- Desactivar el rol. No hay endpoint ni botón. Con cargas activas no se evalúa.
- Dueño o admin de la empresa activándolo desde su propia cuenta.
- Historias 1, 2, 3 y C1–C4 del brief.
- Consultar o modificar datos de producción. Van Oosterwyk no se toca en este PR.

## Criterios de éxito

1. Activación: transportista sin el rol → `es_generador_carga = true` y `es_transportista` sigue `true`. Test de API.
2. Conductor y despachador que no son platform-admin reciben 403. Test de API.
3. Activar dos veces no falla ni pisa la auditoría. Test de API.
4. Empresa con los dos roles crea una carga y `generador_carga_empresa_id` es esa empresa. Test en `trip-requests-v2`.
5. Sidebar e inicio muestran Crear carga y Mis cargas sin quitar Ofertas. Tests en `Layout.test.tsx` y `app.test.tsx`.
6. Transportista puro ve el mismo inicio de hoy (`InicioTransportista`, #792). No se cambian las query keys de `use-datos-inicio.ts`. `inicio-transportista` y `cache-pantallas.test.tsx` siguen en verde.
7. Generador puro ve el mismo inicio. `gate-rol.spec.ts` no se modifica.
8. El cron de suscripciones UF no factura la línea de generador cuando la empresa ya es transportista. Test en `cobrar-suscripciones-uf`.
