# Frente 8 — Armazón con menú superior y barra inferior bajo 640 px

**Estado**: aceptada (goal del PO del 2026-11-25; decisión 1 de «Decisiones del PO del 2026-11-25» en `docs/design/rediseno-2026-11-25/README.md`).
**Reemplaza**: la barra lateral y el cajón móvil de `.specs/d2-operador-shell-sidebar/` (decisiones «Shell → sidebar persistente», `Sidebar.tsx` y el cajón `mobile-drawer`). El resto de esa spec sigue vigente.
**Maquetas**: `capturas/InicioTransportista.jpg`, `InicioGenerador.jpg`, `MovilInicioTransportista.jpg`.

## Objetivo

Que el armazón de las pantallas de operador (`Layout.tsx`, `/app/*`) sea el de las maquetas: un menú superior con pocas entradas y, bajo 640 px, una barra inferior fija con las mismas entradas. El conductor y el panel de administración conservan su armazón propio.

## Entradas

- `me` (rol, empresa activa y sus banderas, `productoDe(me)`), la bandera `rutas_api_activada`.
- Las pantallas que hoy tiene el menú lateral. Ninguna se elimina ni se fusiona aquí: fusionar pantallas es el frente 5.

## Salidas

**Modelo de menú** (`components/nav-items.ts`, `navGroupsForMe(me, { rutas })`, puro): grupos con nombre, ícono, nombre corto para la barra inferior y las pantallas que contienen. Las entradas quedan donde las ponen las maquetas y la decisión 1:

| Empresa | Grupos del menú |
|---|---|
| Transportista con servicio completo | Inicio · Flota · Viajes · Ofertas · Empresa |
| Booster Fleet solo | Inicio · Flota · Viajes propios · Empresa |
| Generadora | Inicio · Mis cargas · Huella y certificados · Empresa |
| Transportista y generadora | los de transportista, luego Mis cargas y Huella y certificados, y Empresa al final |
| Stakeholder | Inicio · Zonas |
| Conductor empleado | Mi viaje |

- **Flota**: Panel de flota (Booster Fleet), Seguimiento de flota, Trayectos, Vehículos, Conductores, Cumplimiento, Dispositivos.
- **Viajes**: Servicios, Rutas (con la bandera), Cobra hoy y Liquidaciones (con `verFinanzas`).
- **Empresa**: Empresa (admin), Equipo, Zonas de matching (admin con ofertas).
- **Mis cargas**: Mis cargas, Crear carga (con `publicarCarga`), Sucursales.
- **Inicio**: Inicio y, para el dueño que también conduce, Mi viaje.
- Los permisos de cada pantalla son los mismos de hoy: el modelo reordena, no abre ni cierra accesos.

**Armazón** (`Layout.tsx`):

- Cabecera fija arriba: marca del producto (lleva al Inicio), las entradas del menú (desde 640 px) y, a la derecha, el menú de cuenta con el nombre de la empresa activa. El menú de cuenta contiene el cambio de empresa, el perfil, «Panel de Booster» para el personal de Booster y «Salir».
- Una entrada está activa cuando la ruta actual pertenece a una de sus pantallas; se marca con `aria-current="page"` y fondo neutro, como la maqueta.
- Si el grupo activo tiene más de una pantalla, una fila de pestañas bajo la cabecera las lista (desplazable en su caja si no cabe), con la actual marcada.
- Bajo 640 px las entradas del menú pasan a una barra inferior fija (`nav` «Navegación principal en móvil»; nombre distinto del de la cabecera para que cada región sea única), con ícono y nombre corto, reservando el área segura del iPhone; el contenido deja espacio para que la barra no lo tape.
- Sin barra lateral ni cajón móvil.
- Registro `operador`, tokens D1, sin colores fijos.

## Criterios de éxito

1. `navGroupsForMe` arma los grupos de la tabla para cada tipo de empresa y rol; una empresa Booster Fleet no ve Ofertas ni Mis cargas; ninguna pantalla que hoy ve un rol desaparece de su menú. Tests unitarios.
2. Desde 640 px el menú superior muestra las entradas y no hay barra inferior; bajo 640 px la barra inferior muestra las mismas entradas y el menú superior las oculta. Comprobado en Chromium (`e2e-local/operator-shell.spec.ts`) a 1.280 y a 390 px.
3. El menú de cuenta permite cambiar de empresa, ir al perfil, volver al panel (personal de Booster) y salir. Tests de `Layout`.
4. Sin violaciones de axe en el armazón.
5. `pnpm run ci` en verde.

## Fuera de alcance

- Fusionar pantallas (Cumplimiento, Seguimiento de flota y Trayectos dentro de Flota; Zonas dentro de Empresa): frente 5.
- El armazón del conductor y del panel de administración.
- Volver al Inicio al cambiar de empresa (frente 5).
