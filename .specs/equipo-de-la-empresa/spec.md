# Spec: equipo-de-la-empresa

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-07-31
- Status: Draft — pendiente de aceptación del PO
- Linked: `.specs/alta-cliente-autocontenida/` (define el principio de identidad §6.5 que esta spec aplica), `.specs/onboarding-flow-redesign/` (programa madre, Fases 3-5), ADR-035 (RUT + clave numérica), ADR-034 (stakeholders, fuera de alcance)

---

## 1. Objective

Que **cada empresa cliente dé de alta a su propia gente**, sin que Booster intervenga, y que cada persona entre con **su** credencial: RUT + una clave numérica que elige ella misma.

## 2. Why now

Hoy sumar una persona a una empresa existente no tiene camino de producto: se resuelve con `INSERT` a mano en producción (caso real, 2026-07-30: el gestor de Transportes Van Oosterwyk). El endpoint admin que se construyó como paliativo (`POST /admin/empresas/:id/miembros`) pone a **Booster** administrando el equipo del cliente, que es lo contrario del modelo multi-tenant.

El patrón correcto **ya existe en producción para conductores**: la empresa los da de alta y recibe un código que les entrega. Pero ese flujo arrastra dos defectos que lo hacen inservible como molde tal cual está:

| Defecto | Dónde | Consecuencia |
|---|---|---|
| El email real se pisa con uno sintético | `auth-driver.ts:173` (`UPDATE usuarios SET email = 'drivers+<rut>@boosterchile.invalid'`) | La persona queda **sin canal de comunicación** con la plataforma |
| El PIN que genera el admin queda como contraseña permanente | `auth-driver.ts:151` (`updateUser({password: body.pin})`) | **La credencial la conoce quien dio de alta** |
| El email es opcional al crear | `conductores.ts:337` (`body.email ?? placeholderEmail(rut)`) | Se crean personas sin forma de contactarlas |

## 3. Success criteria

- [ ] SC1 — El dueño o admin de una empresa da de alta a alguien de su equipo desde **su propia app** (no desde el panel de Booster), indicando nombre, RUT, **email real** y rol.
- [ ] SC2 — El sistema devuelve un **código de activación de un solo uso**, que la empresa entrega por su canal. Ese código **no es la contraseña**: sirve una vez para probar identidad.
- [ ] SC3 — La persona activa su cuenta con RUT + código y **elige su propia clave numérica** de 6 dígitos. Nadie más la conoce: ni Booster ni quien la dio de alta.
- [ ] SC4 — Tras activar, entra por el flujo principal (`POST /auth/login-rut`) con RUT + su clave.
- [ ] SC5 — El **email real se conserva siempre**. Ningún paso lo reemplaza por un sintético; el sintético queda como identificador interno de Firebase y nada más.
- [ ] SC6 — Solo `dueno` y `admin` de esa empresa pueden dar de alta; un `despachador` o `visualizador` recibe 403. Nadie puede sumar gente a una empresa que no es la suya.
- [ ] SC7 — Un RUT que ya pertenece a otra persona no puede reclamarse (mismo criterio que `alta-cliente-autocontenida` SC6), y el rechazo no revela de quién es.
- [ ] SC8 — Los conductores ya activados en producción **siguen entrando** después del cambio (no se rompe lo vivo).

## 4. User-visible behaviour

**En la app del cliente**, sección nueva **Equipo** (visible para `dueno`/`admin`): lista de personas con su rol y estado, y un formulario para sumar a alguien. Al crear, aparece el código de activación con su fecha de vencimiento, para copiar y entregar.

**La persona invitada** entra a la app, elige su tipo de usuario, pone su RUT y el código; el sistema le pide crear su clave de 6 dígitos y queda adentro.

**Diferencia con hoy para conductores**: el conductor deja de recibir "una contraseña que su jefe conoce" y pasa a tener su propia clave.

## 5. Out of scope

- Stakeholders (ADR-034, viven en organizaciones, no en empresas).
- Retirar el endpoint admin `POST /admin/empresas/:id/miembros`: queda como herramienta de soporte de Booster para casos excepcionales, no como camino principal.
- Permisos finos por rol dentro de la app (qué ve cada rol) — ya existen; esta spec solo crea la membresía con el rol elegido.

## 6. Constraints

1. **Principio de identidad** (decisión del PO, heredado de `alta-cliente-autocontenida` §6.5): email real como canal, credencial propia e intransferible. Un código entregado por un tercero prueba identidad **una vez**; jamás queda como contraseña.
2. **ADR-035**: la credencial es RUT + clave numérica de 6 dígitos.
3. **Reuso**: `generateActivationPin`/`hashActivationPin` (`services/activation-pin.ts`), `hashClaveNumerica` (`services/clave-numerica.ts`) y el patrón de pantalla de `login-conductor.tsx` ya existen en producción. Esta spec los compone.
4. **Tenant-safe**: la autorización se resuelve por la membresía activa del caller sobre esa empresa (`userContext`), nunca por un id que venga del cliente.
5. **Rate limit** en el endpoint de activación (es pre-auth, igual que `login-rut`): fail-closed, con cubo propio.
6. Stack Booster: Zod en boundary, cero `any`, logger estructurado, coverage ≥80%, clasificación en el harness ADR-057.

## 7. Approach

**Fase A — alta de miembros por la empresa (no toca conductores).**

```
POST /me/empresa/miembros      → crea persona + membresía + código de activación
GET  /me/empresa/miembros      → lista el equipo
POST /auth/activar             → RUT + código → define clave → sesión
```

- El alta crea la fila `usuarios` con **email real obligatorio**, `firebase_uid` placeholder y `activacion_pin_hash`; la membresía nace `pendiente_invitacion`.
- `POST /auth/activar` verifica el código, crea el Firebase user, guarda la `clave_numerica_hash` que eligió la persona, pasa la membresía a `activa`, limpia el `activacion_pin_hash` y devuelve un custom token.
- **El email real nunca se toca** en ese proceso.

**Fase B — migrar conductores al mismo mecanismo.** `POST /conductores` pasa a exigir email real y a emitir el mismo código; `auth-driver.ts` deja de pisar el email y de usar el PIN como contraseña. Los conductores **ya activados** no se tocan (SC8): siguen con su credencial actual hasta que la roten.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Romper el alta de conductores viva en prod (6 en Van Oosterwyk) | Fase B separada, con test de que un conductor ya activado sigue entrando (SC8) |
| Colisión de RUT entre empresas (una persona en dos empresas) | El modelo ya lo soporta (membresías múltiples); el alta reusa el usuario existente en vez de duplicarlo, y solo agrega la membresía |
| Un admin da de alta a alguien con un email ajeno | El código va a la empresa, no al email; el email es canal, no credencial. Riesgo aceptado y explícito |
| Códigos que nunca se usan | Vencimiento + listado que muestra el estado `pendiente_invitacion` para que la empresa reenvíe |

## 9. Decisiones (cerradas por el PO, 2026-07-31)

- **OQ1 — Vencimiento del código: 7 días**, con re-emisión desde el listado. Más largo que el token de onboarding (72 h) porque lo entrega la empresa en mano, no un correo: el apuro del canal no aplica.
- **OQ2 — Conductores ya activados: NO se les fuerza** a crear clave numérica. Migran cuando la roten. Es lo que hace verificable el SC8: lo que hoy funciona en producción sigue funcionando.
- **OQ3 — El listado de Equipo NO incluye conductores.** Ellos mantienen su sección, que gestiona licencias y vencimientos; duplicarlos invitaría a editar la misma persona en dos lugares con reglas distintas.
