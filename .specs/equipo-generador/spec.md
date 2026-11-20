# Spec: equipo-generador

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Aceptada por el PO (pedido del 2026-11-04, plan por etapas, etapa 1)
- Linked: `.specs/equipo-de-la-empresa/spec.md` (la sección Equipo), `.specs/capacidades-por-rol/spec.md` (quién invita y quién acepta ofertas)

## 1. Objetivo

El generador de carga ve y gestiona a las personas de su empresa igual que el transportista. Hoy la página `/app/equipo` y el API (`/me/empresa/miembros`) ya sirven a cualquier empresa, pero el generador no tiene cómo llegar a ella.

## 2. Problema verificado en `main` (2026-11-09)

1. `apps/web/src/components/nav-items.ts`: el ítem «Equipo» está dentro del bloque `if (empresa?.is_transportista)`. Un generador puro no lo ve.
2. `apps/web/src/routes/equipo.tsx` no usa `<Layout>`. La página abre sin barra lateral ni «Salir», en cualquier rol.
3. La página muestra a todos dos cosas que son solo de transporte:
   - el aviso «Los conductores se agregan desde la sección Conductores»;
   - la casilla del permiso de ofertas del despachador. `puedeAceptarOferta` exige `isTransportista`, así que en un generador la casilla no tiene efecto.

## 3. Entradas y salidas

No cambia ningún contrato. No se toca el API, el schema ni las migraciones; solo la navegación y la página web.

## 4. Criterios de éxito

- **SC1.** Una empresa con membresía activa y rol de gestión (dueño, admin, despachador, visualizador) ve «Equipo» una sola vez, en la sección general junto a «Inicio» y «Empresa». Aplica a generador puro, transportista y empresa con los dos roles.
- **SC2.** El conductor empleado sigue viendo solo «Mi viaje», y el stakeholder solo «Inicio» y «Zonas».
- **SC3.** `/app/equipo` se muestra dentro del `Layout`, con el título «Equipo».
- **SC4.** En un generador puro no aparecen el aviso de conductores ni la casilla del permiso de ofertas. En una empresa transportista siguen igual que hoy.
- **SC5.** Tests en rojo antes del cambio y en verde después; typecheck, lint y build en verde.

## 5. Fuera de alcance

- Roles propios del generador (por ejemplo, bodega o recepción). Si hace falta, entra con decisión del PO y spec propia.
- Migrar la página a las primitivas del sistema de diseño. Eso es la etapa 6 del plan; aquí solo entra el `Layout` compartido.
