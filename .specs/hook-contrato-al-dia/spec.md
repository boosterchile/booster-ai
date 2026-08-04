# Hook contrato al día — detectar clones rezagados sin gritar en falso

**Estado**: aceptada · **Fecha**: 2026-08-03 · **Pedido por**: PO
> «detecte rezago por ascendencia, no por diferencia de contenido»

> **Orden real**: esta spec se escribió **después** del código, a pedido del PO
> al cerrar el trabajo. El contrato pide la spec antes del primer commit; acá el
> criterio de salida vino dictado paso a paso en sesión y se transcribe tal cual.
> Se deja declarado en vez de fingir que precedió a la implementación. Aplica al
> PR [#647](https://github.com/boosterchile/booster-ai/pull/647).

## 1. El problema

`.claude/hooks/check-contrato-al-dia.sh` existía en disco y estaba **inerte**,
por dos razones independientes:

| Falla | Evidencia |
|---|---|
| **No se ejecutaba** | Ninguna de las 4 fuentes de settings (`.claude/settings.json`, `.claude/settings.local.json`, y sus pares en `~/.claude/`) tenía clave `hooks`. |
| **No viajaba con el repo** | `.gitignore:136` ignora `.claude/*` con una sola excepción, `!.claude/settings.json`. El script era local a un clon. |

La segunda es la irónica: el hook existe para detectar clones rezagados, y él
mismo no existía en los demás clones.

Y tenía un tercer defecto, de diseño: comparaba el **contenido** de
`CLAUDE.md`/`AGENTS.md` contra el remoto. Cualquier rama que editara el contrato
—que es trabajo legítimo y frecuente, `chore/corregir-contratos` (#646) sin ir
más lejos— disparaba el aviso en cada sesión, durante toda la vida de la rama.
Un aviso que suena siempre deja de leerse.

## 2. Decisiones

### 2.1 El criterio es ascendencia, no diferencia

Avisa **solo si el último commit que tocó el archivo en `<remoto>/main` no es
ancestro de `HEAD`**.

Esto separa las dos situaciones que la comparación de contenido confundía:

- *Yo edité el contrato en mi rama* → el commit remoto **sigue siendo ancestro**
  → silencio. Correcto: no estoy rezagado, estoy trabajando.
- *Mi clon quedó atrás* → el commit remoto **no es ancestro** → aviso. Correcto.

El working tree sucio es irrelevante bajo este criterio, que es justamente lo
que se busca.

### 2.2 Tres estados, no dos

`git merge-base --is-ancestor` devuelve `0` (al día), `1` (rezagado) y `>1`
cuando **no puede decidir** — clon shallow, `HEAD` sin commits. Ese tercer caso
se reporta como «NO verificado», nunca se colapsa contra «al día».

Misma regla para el `fetch` que falla: red caída o credenciales vencidas se
avisan explícitamente. **El silencio significa una sola cosa: al día.** Un hook
que calla cuando no pudo verificar es peor que no tenerlo, porque enseña a
confiar en su silencio.

### 2.3 El remoto se resuelve por URL, no por nombre

Se busca la URL `boosterchile/booster-ai` en `git remote -v`. El nombre varía
entre clones y no es confiable: en `~/booster-ai` el remoto se llama `origin`;
en `~/Developer/booster-ai` se llama `github` y `origin` apunta a un GitLab.

### 2.4 Nunca bloquea

`exit 0` siempre. Es un aviso para el humano al inicio de sesión, no un gate.
Los gates viven en CI y en los reviewers de GitHub (ADR-072).

### 2.5 El script se versiona

Excepción `!.claude/hooks/` en `.gitignore`. Sin esto el hook no existe en los
demás clones y no hay nada que cablear allá.

## 3. Salidas

1. **`.claude/hooks/check-contrato-al-dia.sh`** — reescrito con el criterio de
   ascendencia; versionado (modo `100755`).
2. **`.claude/settings.json`** — bloque `hooks.SessionStart` con `timeout: 20`
   (hace un `git fetch`, no debe colgar el arranque de sesión).
3. **`.gitignore`** — `!.claude/hooks/`.

Formato del aviso: archivo afectado, ruta del clon, y el commit que falta con
hash, fecha y asunto, más el comando para traerlo.

## 4. Criterios de éxito

1. Clon al día → **silencio**.
2. Clon rezagado (`~/Developer/booster-ai`, HEAD en junio) → **aviso** con el
   commit que falta.
3. Rama que **edita** el contrato → **silencio** (el falso positivo que se
   corrige).
4. `fetch` fallido o remoto no identificado → aviso de «NO verificado», nunca
   silencio.
5. El hook **se ejecuta** al iniciar sesión — verificado abriendo una sesión
   real, no por inspección del JSON.
6. `git check-ignore` deja de emparejar el script.
7. El diff de `settings.json` agrega solo el bloque `hooks`.

Evidencia de los 7 en [`verify.md`](verify.md).

## 5. Fuera de alcance

- **Auto-merge del contrato.** El hook avisa y entrega el comando; traer el
  cambio es decisión de quien opera. Un `git merge` automático al inicio de
  sesión tocaría el working tree sin permiso.
- **Otros archivos de contrato.** Solo `CLAUDE.md` y `AGENTS.md`. Los ADRs y las
  specs no se chequean: son inmutables por convención (se supersede, no se
  edita), así que el rezago no los corrompe del mismo modo.
- **Cablear el hook en los demás clones.** Post-merge, cada clon lo obtiene al
  traer `main`. `~/Developer/booster-ai` tiene trabajo propio sin mergear y no
  se toca desde acá.
- **Gate en CI.** Es una ayuda de sesión local; duplicarla en CI no aporta —
  GitHub ya mergea contra `main` fresco.
