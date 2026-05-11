-- Migration 0023 — Sucursales del generador de carga (D7b)
--
-- Modelo:
--   Un shipper puede tener N sucursales físicas (bodegas, plantas, centros
--   de distribución). Una sucursal es un punto de origen/destino para
--   ofertas. Ejemplo: cadena de retail con bodegas en distintas ciudades
--   que mueve producto entre ellas, o fabricante que despacha desde planta
--   a centro de distribución (intra-empresa).
--
-- Decisiones:
--
--   1. **Tabla separada vs columnas en `empresas`**: separada porque son N
--      por empresa. Empresas pequeñas tendrán 0-1; grandes 50+.
--
--   2. **Coords nullable**: el shipper puede crear la sucursal sin saber
--      las coords exactas (las pide después con un picker de mapas). Sin
--      coords, la sucursal NO se puede usar en oferta (UI valida).
--
--   3. **Horario texto libre** para MVP. Iterar a horarios estructurados
--      cuando el matching los necesite para auto-rechazar ofertas fuera
--      de ventana.
--
--   4. **Soft delete vía `eliminado_en`**: ofertas históricas pueden
--      referenciar sucursales que ya no operan. Hard delete rompería
--      trazabilidad.
--
--   5. **Sin FK desde `ofertas` todavía**: se agrega en un PR separado
--      cuando wiremos la UI de "selecciona sucursal" en el form de carga
--      nueva.
--
-- Riesgo deploy: bajo. Tabla nueva sin FK desde otras tablas. Reversible.

CREATE TABLE "sucursales_empresa" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "empresa_id" uuid NOT NULL REFERENCES "empresas"("id") ON DELETE RESTRICT,
  "nombre" varchar(100) NOT NULL,
  "direccion_calle" varchar(200) NOT NULL,
  "direccion_ciudad" varchar(100) NOT NULL,
  "direccion_region" varchar(4) NOT NULL,
  "latitud" numeric(10, 7),
  "longitud" numeric(10, 7),
  "horario_operacion" varchar(200),
  "es_activa" boolean NOT NULL DEFAULT true,
  "creado_en" timestamp with time zone NOT NULL DEFAULT now(),
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now(),
  "eliminado_en" timestamp with time zone
);

CREATE INDEX "idx_sucursales_empresa" ON "sucursales_empresa" ("empresa_id");

CREATE INDEX "idx_sucursales_activas"
  ON "sucursales_empresa" ("empresa_id", "es_activa")
  WHERE "eliminado_en" IS NULL;
