# Spec: acceso-panel-plataforma

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Aprobada por el PO en sesión el 2026-11-09 (§10)
- Linked: `.specs/alta-personal-booster/spec.md` (panel del personal; esta spec reemplaza su decisión «Terraform + alta en panel»), `.specs/equipo-de-la-empresa/` (código de un solo uso y `/activar`), `docs/qa/runbook-bootstrap-platform-admin.md`, ADR-028 (el «Admin Booster» es la cuenta con `usuarios.es_admin_plataforma = true`), ADR-035 (RUT + clave numérica)

---

## 1. Objective

El acceso al panel de Booster lo otorga y lo quita el propio panel. Hay una sola regla de acceso, la misma para el API y la web. Las cuentas del personal se gestionan solo desde Booster, y la activación de cualquier cuenta respeta su estado. La lista de Terraform (`BOOSTER_PLATFORM_ADMIN_EMAILS`) queda como respaldo para el primer admin.

## 2. Why now

Con `.specs/alta-personal-booster` (#884) el panel ya crea la cuenta del personal, pero el acceso seguía dependiendo de un `terraform apply` del PO por cada persona, y el panel no podía quitarlo. Además, la regla de acceso estaba repetida en el guard, en `/me` y en ocho rutas admin con su propia copia, y no todas decían lo mismo: el guard miraba la lista y `/me` miraba la marca o la lista. El PO pidió el 2026-11-09 que el panel otorgue y quite el acceso.

## 3. Success criteria

- [ ] SC1 — **Una sola regla.** Un helper puro decide el acceso: tiene acceso la cuenta con `es_admin_plataforma = true` y estado `activo`, o la cuenta cuyo correo está en `BOOSTER_PLATFORM_ADMIN_EMAILS` (sin distinguir mayúsculas). `requirePlatformAdmin` y el `is_platform_admin` de `GET /me` usan ese helper. Ninguna ruta decide el acceso con su propia copia de la lista: las rutas admin que la tenían usan `requirePlatformAdmin`.
- [ ] SC2 — **Respaldo para el primer admin.** La creación automática de la cuenta en `GET /me` sigue siendo solo para un correo de la lista de respaldo. La lista no es un paso por persona.
- [ ] SC3 — **El alta otorga el acceso.** `POST /admin/personal-booster` deja marcada toda cuenta que registra: la nueva, la provisoria y la activa, esté o no en la lista. Una cuenta activa queda con acceso desde ese momento. El código emitido sale por correo a la persona aunque su correo no esté en la lista. Request y respuesta no cambian.
- [ ] SC4 — **Quitar acceso.** `POST /admin/personal-booster/:userId/quitar-acceso`, sin body, desmarca la cuenta → `200 { ok, user_id }`. Si la cuenta todavía no activó y su código es del panel, el código deja de servir (hash y vencimiento en NULL). Rechazos, sin escrituras:
  - la cuenta no existe o no está marcada → 404 `personal_not_found`;
  - su correo está en la lista de respaldo → 409 `en_lista_respaldo`: ese acceso se quita en Terraform;
  - el panel quedaría sin nadie con acceso (por ejemplo, quitarse el acceso a uno mismo siendo el último) → 409 `ultimo_acceso`. Cuentan las demás cuentas marcadas y activas, y los correos de la lista.

  La lectura bloquea las filas marcadas hasta el commit, para que dos bajas en paralelo no dejen el panel vacío.
- [ ] SC5 — **Auditoría y aviso.** Cada alta que otorga el acceso (cuenta nueva o recién marcada) y cada baja dejan un evento de auditoría (`personal_booster.acceso_otorgado`, `personal_booster.acceso_quitado`: qué admin, a quién por `user_id`) y mandan un correo de aviso a cada correo de la lista de respaldo, con quién hizo el cambio y a quién. El aviso nunca lleva el código. El evento y la métrica de negocio también registran el envío.
- [ ] SC6 — **Activación del personal.** `POST /auth/activar` activa una cuenta marcada sin invitación a empresa con un código del panel vigente. Ya no exige que el correo esté en la lista.
- [ ] SC7 — **Las cuentas del personal se gestionan desde Booster.** Los flujos de empresa responden 409 `cuenta_personal_booster`, sin escribir, cuando la cuenta está marcada, cuando su correo está en la lista de respaldo, o cuando el correo nuevo que traen está en esa lista:
  - `POST /conductores` (alta y reactivación);
  - `POST /conductores/:id/email`;
  - `POST /conductores/:id/telefono`;
  - `POST /me/empresa/miembros`.
- [ ] SC8 — **Web.** Ante `cuenta_personal_booster`, el alta y la ficha del conductor y el alta del equipo muestran: «Esta persona es del personal de Booster; su cuenta se gestiona desde Booster.»
- [ ] SC9 — **Re-emisión del panel de empresas.** `POST /admin/empresas/:id/miembros/:membershipId/codigo` (solo platform-admin) cuenta como código del panel: fija `activacion_vence_en` con su vencimiento en vez de NULL. El test estructural de emisores exige NULL a todos los demás.
- [ ] SC10 — **La activación respeta el estado.** `POST /auth/activar` y `POST /auth/driver-activate` no activan una cuenta `suspendido` ni `eliminado`: responden la misma 401 genérica de un código incorrecto, y la escritura exige que el estado siga siendo otro.
- [ ] SC11 — **Tiempo de respuesta parejo.** `POST /auth/activar` sin código pendiente verifica igual contra un hash de relleno, para que esa respuesta tarde lo mismo que la de un código incorrecto.
- [ ] SC12 — **Panel del personal.** La lista muestra «Quitar acceso» en las cuentas marcadas cuyo correo no está en la lista de respaldo, con confirmación, y traduce los rechazos de SC4. El texto del panel describe el orden nuevo (alta → `/activar` → login) sin el paso de Terraform. El alta de una cuenta que ya estaba activa avisa que quedó con acceso y pide confirmarlo con la persona.
- [ ] SC13 — **Runbook y decision log.** `docs/qa/runbook-bootstrap-platform-admin.md` deja Terraform solo para el primer admin; el orden normal es panel → `/activar` → login. El decision log de `.specs/alta-personal-booster/spec.md` registra el reemplazo.
- [ ] SC14 — Tests nombrados para SC1–SC12, con rojo exhibido antes de implementar (auth es dominio crítico). Integración contra Postgres real de la cadena alta → activar sin lista → login → `/me` → ruta admin 200 → quitar acceso → 403. `pnpm run ci` corrido en el momento.

## 4. Contratos (aprobados por el PO el 2026-11-09)

- **Nuevo** `POST /admin/personal-booster/:userId/quitar-acceso` → `200 { ok: true, user_id }` · 404 `personal_not_found` · 409 `en_lista_respaldo` · 409 `ultimo_acceso` · 400 si `userId` no es UUID. Misma cadena de middleware que el resto de `/admin/personal-booster` (firebaseAuth → userContext → impersonationWriteGuard) y `requirePlatformAdmin`.
- **Nuevo código de error** 409 `cuenta_personal_booster` en `POST /conductores`, `POST /conductores/:id/email`, `POST /conductores/:id/telefono` y `POST /me/empresa/miembros`.
- `POST /admin/personal-booster`: mismo request y respuesta; cambia a quién marca (SC3) y cuándo sale el correo con el código.
- `GET /me`: misma respuesta; `is_platform_admin` sale del helper (SC1).
- `POST /auth/activar` y `POST /auth/driver-activate`: mismos request y respuestas.
- Los schemas Zod nuevos viven en `packages/shared-schemas`.

## 5. Out of scope

- Cambiar la lista de Terraform desde el panel. El respaldo se edita en Terraform.
- Roles de staff acotados: el acceso al panel sigue siendo todo o nada.
- Una tabla de auditoría en la base: el evento sigue el patrón de log estructurado `event_type` del panel del personal.
- Revocar sesiones Firebase al quitar el acceso: el guard lee la marca en cada request, así que el acceso se corta en la request siguiente.

## 6. Constraints

1. **ADR-028**: el «Admin Booster» es la cuenta con `es_admin_plataforma = true`. Esta spec pone esa marca como la regla y deja la lista como respaldo; no cambia el stack.
2. **Principio de identidad**: el admin nunca carga la clave; una cuenta activa nunca recibe un código nuevo.
3. **Código del panel**: `activacion_vence_en` no nulo = el código lo emitió un platform-admin desde el panel (personal o re-emisión del panel de empresas). Todo otro UPDATE del código lo deja en NULL.
4. **Anti-enumeración en la activación**: todos los rechazos de `/auth/activar` son la misma 401. Los 409 de SC7 son decisión del PO: los flujos de empresa ya responden 409 por otras causas.
5. **Stack**: Zod en el boundary, cero `any`, logger estructurado sin el código, span OTel y métrica de negocio en el endpoint nuevo, coverage ≥ 80 % en código nuevo, TDD con rojo exhibido.

## 7. Approach

- `apps/api/src/auth/acceso-plataforma.ts`: `tieneAccesoPlataforma`, `correoEnListaRespaldo`, `cuentaGestionadaPorBooster`. Puro, sin I/O.
- `requirePlatformAdmin` usa el helper; las rutas con copia propia (`admin-cobra-hoy`, `admin-matching-backtest`, `admin-backfill-distancia`, `admin-signup-requests`, `site-settings`, `admin-observatorio`, `admin-stakeholder-orgs`, `admin-configuracion-comercial`) pasan a `requirePlatformAdmin`.
- `/me` calcula `is_platform_admin` con el helper.
- `admin-personal-booster.ts`: el alta marca siempre; nueva ruta `quitar-acceso`; aviso por correo a la lista con una función nueva junto a `enviarCorreoActivacionPersonalBooster`.
- `auth-activar.ts` y `auth-driver.ts`: leen el estado, rechazan `suspendido`/`eliminado` y lo exigen en el UPDATE; `auth-activar` deja de exigir la lista y verifica contra un hash de relleno sin código pendiente.
- `conductores.ts` y `me-empresa-miembros.ts` reciben la lista de respaldo por opciones y rechazan con `cuenta_personal_booster`.
- `admin-empresa-miembros.ts`: la re-emisión fija `activacion_vence_en`.
- Web: `PersonalBooster.tsx` (Quitar acceso, textos), `conductores.tsx` y `equipo.tsx` (mensaje de SC8).

## 8. Test list

- T1 (SC1, rojo) — `acceso-plataforma.test.ts`: tabla marca × estado × lista; mayúsculas y espacios de la lista; correo nulo.
- T2 (SC1, rojo) — `require-platform-admin.test.ts`: cuenta marcada y activa → ok; marcada y suspendida → 403; en la lista → ok; ninguna → 403. `me-platform-admin.test.ts`: `is_platform_admin` con la misma tabla. Test estructural: ninguna ruta compara la lista en línea.
- T3 (SC3, SC5, rojo) — `admin-personal-booster.test.ts`: la cuenta activa fuera de la lista queda marcada; el código sale por correo fuera de la lista; aviso a la lista en el alta que otorga y no en la que no cambia nada.
- T4 (SC4, SC5, rojo) — quitar acceso: 200 y UPDATE; código del panel invalidado en una provisoria; 404; 409 `en_lista_respaldo`; 409 `ultimo_acceso` a uno mismo; bloqueo de filas; impersonación 403; 401/403; aviso y auditoría.
- T5 (SC6, SC10, SC11, rojo) — `auth-activar.test.ts`: personal fuera de la lista activa; `suspendido`/`eliminado` → 401 sin escrituras; el UPDATE exige el estado; sin código pendiente se verifica contra el relleno. `auth-driver.test.ts`: `suspendido`/`eliminado` → 401 sin escrituras.
- T6 (SC7, rojo) — `conductores.test.ts` y `me-empresa-miembros.test.ts`: 409 `cuenta_personal_booster` sin escrituras en cada flujo y causa.
- T7 (SC9, rojo) — re-emisión del panel de empresas con `activacion_vence_en`; `emisores-codigo-del-panel.test.ts` exige NULL fuera del panel.
- T8 (SC8, SC12) — web: mensaje en conductores y equipo; Quitar acceso con confirmación y errores; textos sin el paso de Terraform.
- T9 (SC14) — integración `acceso-panel-plataforma-cadena.integration.test.ts`.

## 9. Rollout

1. Antes del deploy, el PO corre en prod la consulta de solo lectura del PR que lista las cuentas con `es_admin_plataforma = true`. Desde el deploy, esas cuentas tienen acceso si están activas: el PO confirma que todas corresponden y, si alguna no, la desmarca con «Quitar acceso» apenas entre el deploy.
2. Merge y release (lo dispara el PO). Sin migración.
3. Rollback: volver a la revisión anterior devuelve la regla de la lista. Las marcas que dejó el panel quedan en la base y no dan acceso en esa revisión.

## 10. Decision log

- 2026-11-09 — El PO aprueba («Sí, aplícala») la propuesta: el acceso al panel lo otorga y lo quita el panel de Booster, una sola regla de acceso para el API y la web, las cuentas del personal se gestionan solo desde Booster y la activación respeta el estado de la cuenta. Terraform queda solo para el primer admin. Los flujos de empresa responden 409 con un código propio (en vez de conservar el código y avisar).
