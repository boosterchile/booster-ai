"""Sonda de solo lectura contra el tag del canary. Stdlib.

Durante la ventana de espera manda GET /health y GET /health/signup-flow al
URL del tag: _CANARY_MIN_REQUESTS más cinco, sin bajar el piso. No escribe
datos de negocio y no pide datos de usuarios. Si el worker no atraviesa el
ingress, emite un Job (imagen por digest) para correr la misma sonda desde
la VPC del proyecto. El pod resuelve el host del tag a private.googleapis.com
(199.36.153.8): el DNS público de *.run.app sale por Cloud NAT y el ingress
INTERNAL_LOAD_BALANCER responde 404.

Escribe el resultado en --result-out (por defecto /workspace/canary-probe.json):
respuestas 5xx, timeouts y errores de conexión. canary-verify aborta si la
sonda llegó a la app y vio esos errores, o si fallaron el camino directo y
el Job teniendo URL.

Exit 0: la app respondió el plan (aunque haya 5xx; el gate los lee del
archivo). Exit 2: no se llegó a la app (el caller puede aplicar el
manifiesto). Exit 1: argumentos inválidos.
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

from canary_verify_decision import percentil_95

RUTAS_SEGURAS = ('/health', '/health/signup-flow')
USER_AGENT = 'booster-canary-probe'
RUTA_RESULTADO = '/workspace/canary-probe.json'
EXTRA_SONDA = 5
# Mismo piso que _CANARY_MIN_REQUESTS. Unos 200 sueltos, por debajo, no
# cuentan como llegada: el gate los vería como muestra corta y revertiría
# el tag. Un 5xx se reporta igual aunque sean pocos.
PISO_RESPUESTAS_EN_LOG = 30
# private.googleapis.com (199.36.153.8/30). La subnet booster-ai-private tiene
# Private Google Access: estos VIP no salen por Cloud NAT. El DNS público
# de *.run.app sí.
IPS_GOOGLE_PRIVADA = (
    '199.36.153.8',
    '199.36.153.9',
    '199.36.153.10',
    '199.36.153.11',
)
# El Job tiene que seguir existiendo cuando leemos logs. 600s lo borraba
# mientras kubectl wait seguía hasta 1500s (NotFound).
TTL_JOB_SEGUNDOS = 1800
ESTADOS_JOB = ('ok', 'fallo', 'no_corrido', 'no_necesario', 'perdido')
_IMAGEN_DIGEST = re.compile(r'^.+@sha256:[0-9a-f]{64}$')

# Node del Job. Solo GET, solo RUTAS_SEGURAS, sin seguir redirects.
_SCRIPT_NODE = """
const paths = __PATHS__;
const url = process.env.CANARY_URL || '';
const tag = process.env.CANARY_TAG || '';
const count = Number(process.env.CANARY_COUNT || '0');
const deadline = Number(process.env.CANARY_DEADLINE_EPOCH || '0') * 1000;
const host = (() => {
  try { return new URL(url).host; } catch (e) { return ''; }
})();
if (!host.startsWith(tag + '---') || !host.endsWith('.run.app')) {
  console.log(JSON.stringify({
    error: 'url',
    resumen: {
      llego_a_la_app: false,
      cinco_xx: 0,
      cuatro_xx: 0,
      errores_transporte: 0,
      respuestas_app: 0,
      latencias_ms: [],
      p95_ms: null,
      total_plan: count,
    },
  }));
  process.exit(1);
}
function pausa(indice) {
  if (indice === 0) return Promise.resolve();
  const quedan = count - indice;
  const margen = deadline - Date.now();
  const ms = quedan <= 0 || margen <= 0 ? 0 : Math.min(60000, Math.max(0, margen / quedan));
  return new Promise((resolver) => setTimeout(resolver, ms));
}
function p95(valores) {
  if (!valores.length) return null;
  const orden = valores.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(0.95 * orden.length) - 1);
  return orden[idx];
}
(async () => {
  let respuestasApp = 0;
  let cincoXx = 0;
  let cuatroXx = 0;
  let erroresTransporte = 0;
  let llego = false;
  let fallosSinLlegar = 0;
  const latencias = [];
  const reintentosAntesDeCortar = 3;
  for (let i = 0; i < count; i += 1) {
    await pausa(i);
    const path = paths[i % paths.length];
    if (!paths.includes(path)) process.exit(1);
    try {
      const t0 = Date.now();
      const res = await fetch(url + path, {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json', 'User-Agent': 'booster-canary-probe' },
      });
      await res.arrayBuffer();
      const ms = Date.now() - t0;
      const status = res.status;
      if (status >= 500) {
        cincoXx += 1;
        respuestasApp += 1;
        llego = true;
        latencias.push(ms);
      } else if (status >= 200 && status < 300) {
        respuestasApp += 1;
        llego = true;
        latencias.push(ms);
      } else if (status >= 400 && status < 500) {
        cuatroXx += 1;
      }
      console.log(JSON.stringify({ i, path, status, ms }));
    } catch (err) {
      erroresTransporte += 1;
      const message = err && err.message ? err.message : String(err);
      console.log(JSON.stringify({ i, path, error: message }));
    }
    // Un blip no corta. Tras el primer fallo hay 3 reintentos; si ninguno
    // llegó a la app, el resumen queda antes de que el TTL borre el Job.
    // Un 4xx se cuenta y no marca llegada ni 5xx.
    if (!llego) {
      fallosSinLlegar += 1;
      if (fallosSinLlegar > reintentosAntesDeCortar) break;
    }
  }
  console.log(JSON.stringify({
    resumen: {
      llego_a_la_app: llego,
      cinco_xx: cincoXx,
      cuatro_xx: cuatroXx,
      errores_transporte: erroresTransporte,
      respuestas_app: respuestasApp,
      latencias_ms: latencias,
      p95_ms: p95(latencias),
      total_plan: count,
    },
  }));
  process.exit(llego ? 0 : 1);
})();
""".strip().replace('__PATHS__', json.dumps(list(RUTAS_SEGURAS)))


def plan_rutas(cantidad: int, rutas: tuple[str, ...] = RUTAS_SEGURAS) -> list[str]:
    if cantidad < 0:
        raise ValueError('cantidad negativa')
    ajenas = [ruta for ruta in rutas if ruta not in RUTAS_SEGURAS]
    if ajenas:
        raise ValueError(f'ruta fuera de la lista segura: {ajenas[0]}')
    if cantidad == 0 or not rutas:
        return []
    return [rutas[i % len(rutas)] for i in range(cantidad)]


def cantidad_a_enviar(min_requests: int) -> int:
    """El piso no cambia. Se mandan cinco de más para que la muestra sobre."""
    if min_requests < 0:
        raise ValueError('cantidad negativa')
    if min_requests == 0:
        return 0
    return min_requests + EXTRA_SONDA


def clasificar_respuesta(
    status: int | None,
    content_type: str,
    body: str,
) -> str:
    if status is None:
        return 'transporte'
    # Un 5xx de *.run.app lo sirve la revisión (Cloud Run manda HTML en el
    # 503). No es el 404 HTML del frontend de Google.
    if status >= 500:
        return 'aplicacion'
    tipo = content_type.lower()
    prefijo = body.lstrip()
    if 'application/json' in tipo or prefijo.startswith('{') or prefijo.startswith('['):
        return 'aplicacion'
    if 'html' in tipo or prefijo.lower().startswith('<html') or '<html' in prefijo.lower()[:200]:
        return 'ingress'
    if status == 404 and 'not found' in prefijo.lower():
        return 'ingress'
    return 'aplicacion'


def url_es_del_tag(url: str, tag: str) -> bool:
    partes = urllib.parse.urlparse(url)
    host = partes.hostname or ''
    if partes.scheme != 'https' or partes.username or partes.password:
        return False
    if not tag or '/' in tag or tag.startswith('-'):
        return False
    return host.startswith(f'{tag}---') and (host.endswith('.run.app') or host.endswith('.a.run.app'))


def extraer_url_tag(describe: dict[str, Any], tag: str) -> str:
    status = describe.get('status') or {}
    for target in status.get('traffic') or []:
        if target.get('tag') != tag:
            continue
        candidato = str(target.get('url') or '')
        if url_es_del_tag(candidato, tag):
            return candidato.rstrip('/')
        break
    servicio = str(status.get('url') or status.get('address', {}).get('url') or '')
    partes = urllib.parse.urlparse(servicio)
    host = partes.hostname or ''
    if partes.scheme == 'https' and host:
        compuesto = f'https://{tag}---{host}'
        if url_es_del_tag(compuesto, tag):
            return compuesto
    return ''


def espera_antes(indice: int, total: int, ahora: float, deadline: float) -> float:
    if indice <= 0:
        return 0.0
    quedan = total - indice
    if quedan <= 0:
        return 0.0
    margen = deadline - ahora
    if margen <= 0:
        return 0.0
    return min(60.0, max(0.0, margen / quedan))


def manifiesto_job(
    job_name: str,
    image: str,
    url: str,
    tag: str,
    cantidad: int,
    deadline_epoch: int,
) -> str:
    if not url_es_del_tag(url, tag):
        raise ValueError('el url no es el del tag')
    if cantidad < 1:
        raise ValueError('cantidad')
    if not job_name or not image or ' ' in image or ' ' in job_name:
        raise ValueError('job o imagen')
    if not _IMAGEN_DIGEST.match(image):
        raise ValueError('la imagen del job tiene que ir por digest')
    doc = {
        'apiVersion': 'batch/v1',
        'kind': 'Job',
        'metadata': {
            'name': job_name,
            'namespace': 'default',
            'labels': {'app': 'canary-probe'},
        },
        'spec': {
            'backoffLimit': 0,
            'ttlSecondsAfterFinished': TTL_JOB_SEGUNDOS,
            'activeDeadlineSeconds': 1800,
            'template': {
                'metadata': {'labels': {'app': 'canary-probe'}},
                'spec': {
                    'restartPolicy': 'Never',
                    'automountServiceAccountToken': False,
                    # Sin esto el pod resuelve el tag por DNS público, Cloud NAT
                    # lo saca a internet y el ingress responde el HTML 404.
                    'hostAliases': [
                        {
                            'ip': ip,
                            'hostnames': [urllib.parse.urlparse(url).hostname],
                        }
                        for ip in IPS_GOOGLE_PRIVADA
                    ],
                    'containers': [
                        {
                            'name': 'probe',
                            'image': image,
                            'imagePullPolicy': 'IfNotPresent',
                            'command': ['node', '-e', _SCRIPT_NODE],
                            'env': [
                                {'name': 'CANARY_URL', 'value': url},
                                {'name': 'CANARY_TAG', 'value': tag},
                                {'name': 'CANARY_COUNT', 'value': str(cantidad)},
                                {'name': 'CANARY_DEADLINE_EPOCH', 'value': str(deadline_epoch)},
                            ],
                            'resources': {
                                'requests': {'cpu': '250m', 'memory': '512Mi'},
                                'limits': {'cpu': '1', 'memory': '512Mi'},
                            },
                        }
                    ],
                },
            },
        },
    }
    return json.dumps(doc)


Pedir = Callable[[str, str], tuple[int | None, str, str]]


def _pedir(url: str, path: str, timeout: float = 10) -> tuple[int | None, str, str]:
    if path not in RUTAS_SEGURAS:
        raise ValueError(path)
    opener = urllib.request.build_opener(_SinRedirect())
    req = urllib.request.Request(
        url.rstrip('/') + path,
        method='GET',
        headers={'Accept': 'application/json', 'User-Agent': USER_AGENT},
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            body = resp.read(512).decode('utf-8', 'replace')
            tipo = resp.headers.get('Content-Type', '')
            return int(resp.status), tipo, body
    except urllib.error.HTTPError as err:
        raw = err.read(512) if err.fp is not None else b''
        tipo = err.headers.get('Content-Type', '') if err.headers else ''
        return int(err.code), tipo, raw.decode('utf-8', 'replace')
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, '', ''


class _SinRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


def correr_plan(
    pedir: Pedir,
    url: str,
    rutas: list[str],
    ahora: Callable[[], float],
    dormir: Callable[[float], None],
    deadline: float,
) -> dict[str, Any]:
    """Cuenta llegadas, 5xx y errores de transporte. Corta si el primero no es la app."""
    corrida: dict[str, Any] = {
        'llegaron': 0,
        'clase': 'transporte',
        'cinco_xx': 0,
        'cuatro_xx': 0,
        'errores_transporte': 0,
        'llego_a_la_app': False,
        'latencias_ms': [],
    }
    for indice, path in enumerate(rutas):
        pausa = espera_antes(indice, len(rutas), ahora(), deadline)
        if pausa > 0:
            dormir(pausa)
        inicio = time.perf_counter()
        status, tipo, body = pedir(url, path)
        transcurrido_ms = round((time.perf_counter() - inicio) * 1000.0, 1)
        clase_i = clasificar_respuesta(status, tipo, body)
        if status is not None and 400 <= status < 500:
            corrida['cuatro_xx'] += 1
        if status is None:
            corrida['errores_transporte'] += 1
        elif clase_i == 'aplicacion':
            corrida['llegaron'] += 1
            corrida['llego_a_la_app'] = True
            corrida['latencias_ms'].append(transcurrido_ms)
            if status >= 500:
                corrida['cinco_xx'] += 1
        if indice == 0:
            corrida['clase'] = clase_i
            if clase_i != 'aplicacion':
                print(
                    f'canary-probe: GET {path} -> {status} {clase_i} — '
                    'el worker no llegó a la revisión'
                )
                return corrida
        print(f'canary-probe: GET {path} -> {status} {clase_i}')
    return corrida


def armar_resultado(url: str, total_plan: int, corrida: dict[str, Any]) -> dict[str, Any]:
    llego = bool(corrida['llego_a_la_app'])
    latencias = [float(item) for item in corrida.get('latencias_ms') or []]
    resultado: dict[str, Any] = {
        'version': 1,
        'url': url,
        'tenia_url': bool(url),
        'llego_a_la_app': llego,
        'respuestas_app': int(corrida['llegaron']),
        'cinco_xx': int(corrida['cinco_xx']),
        'cuatro_xx': int(corrida['cuatro_xx']),
        'errores_transporte': int(corrida['errores_transporte']),
        'latencias_ms': latencias,
        'p95_ms': percentil_95(latencias),
        'total_plan': total_plan,
        'camino_directo': 'ok' if llego else str(corrida['clase']),
        'job': 'no_necesario' if llego else 'no_corrido',
    }
    return resultado


def _json_de_linea(linea: str) -> dict[str, Any] | None:
    """Objeto JSON de la línea, aunque kubectl le haya puesto un prefijo."""
    texto = linea.strip()
    inicio = texto.find('{')
    if inicio < 0:
        return None
    try:
        payload, _fin = json.JSONDecoder().raw_decode(texto[inicio:])
    except json.JSONDecodeError:
        return None
    if isinstance(payload, dict):
        return payload
    return None


def _extraer_resumen(log: str) -> dict[str, Any] | None:
    for linea in reversed(log.splitlines()):
        payload = _json_de_linea(linea)
        if payload is None:
            continue
        resumen = payload.get('resumen')
        if isinstance(resumen, dict):
            return resumen
    return None


def _ms(valor: object) -> float | None:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    return float(valor)


def _resumen_desde_eventos(log: str) -> dict[str, Any] | None:
    """Si el objeto resumen no está, las líneas status=200/4xx/5xx deciden.

    El step no lee el exit code del contenedor. Sin este conteo, un log con
    HTTP 200 y sin el objeto resumen se marcaba como fallo. Un 404 que no
    llegó a la app, o un 5xx, siguen siendo fallo.
    """
    respuestas = 0
    cinco = 0
    cuatro = 0
    transporte = 0
    latencias: list[float] = []
    vio = False
    for linea in log.splitlines():
        payload = _json_de_linea(linea)
        if payload is None or isinstance(payload.get('resumen'), dict):
            continue
        status = payload.get('status')
        if isinstance(status, bool) or not isinstance(status, int):
            if 'error' in payload:
                transporte += 1
                vio = True
            continue
        vio = True
        demora = _ms(payload.get('ms'))
        if status >= 500:
            cinco += 1
            respuestas += 1
            if demora is not None:
                latencias.append(demora)
        elif 200 <= status < 300:
            respuestas += 1
            if demora is not None:
                latencias.append(demora)
        elif 400 <= status < 500:
            cuatro += 1
    if not vio:
        return None
    # Por debajo del piso y sin 5xx no hay llegada: si no, el gate revierte
    # el tag por muestra corta. El 5xx se entrega siempre.
    if cinco == 0 and respuestas < PISO_RESPUESTAS_EN_LOG:
        return {
            'llego_a_la_app': False,
            'cinco_xx': 0,
            'cuatro_xx': cuatro,
            'errores_transporte': transporte,
            'respuestas_app': 0,
            'latencias_ms': [],
            'p95_ms': None,
        }
    return {
        'llego_a_la_app': respuestas > 0,
        'cinco_xx': cinco,
        'cuatro_xx': cuatro,
        'errores_transporte': transporte,
        'respuestas_app': respuestas,
        'latencias_ms': latencias,
        'p95_ms': percentil_95(latencias),
    }


def aplicar_log_job(resultado: dict[str, Any], log: str) -> dict[str, Any]:
    """El Job que llegó a la app reemplaza la muestra. Si no llegó, el Job falló."""
    resumen = _extraer_resumen(log)
    if resumen is None:
        resumen = _resumen_desde_eventos(log)
    if resumen is None:
        resultado['job'] = 'fallo'
        return resultado
    if not resumen.get('llego_a_la_app'):
        resultado['job'] = 'fallo'
        resultado['errores_transporte'] = int(resultado.get('errores_transporte') or 0) + int(
            resumen.get('errores_transporte') or 0
        )
        resultado['cinco_xx'] = int(resultado.get('cinco_xx') or 0) + int(resumen.get('cinco_xx') or 0)
        resultado['cuatro_xx'] = int(resultado.get('cuatro_xx') or 0) + int(resumen.get('cuatro_xx') or 0)
        return resultado
    resultado['job'] = 'ok'
    resultado['llego_a_la_app'] = True
    resultado['cinco_xx'] = int(resumen.get('cinco_xx') or 0)
    resultado['cuatro_xx'] = int(resumen.get('cuatro_xx') or 0)
    resultado['errores_transporte'] = int(resumen.get('errores_transporte') or 0)
    resultado['respuestas_app'] = int(resumen.get('respuestas_app') or 0)
    latencias = resumen.get('latencias_ms')
    resultado['latencias_ms'] = latencias if isinstance(latencias, list) else []
    resultado['p95_ms'] = resumen.get('p95_ms')
    return resultado


def marcar_job(resultado: dict[str, Any], estado: str) -> dict[str, Any]:
    if estado not in ESTADOS_JOB:
        raise ValueError(estado)
    resultado['job'] = estado
    return resultado


def clasificar_job(doc: dict[str, Any] | None) -> str:
    """Estado del Job para dejar de esperarlo y leer logs enseguida.

    completo / fallido: condición terminal. ausente: el objeto ya no está
    (TTL o delete). pendiente: sigue corriendo.
    """
    if not isinstance(doc, dict) or not doc:
        return 'ausente'
    status = doc.get('status') if isinstance(doc.get('status'), dict) else {}
    if not isinstance(status, dict):
        status = {}
    vistos: set[str] = set()
    for cond in status.get('conditions') or []:
        if not isinstance(cond, dict) or cond.get('status') != 'True':
            continue
        tipo = str(cond.get('type') or '')
        if tipo in ('Complete', 'Failed'):
            vistos.add(tipo)
    if 'Complete' in vistos:
        return 'completo'
    if 'Failed' in vistos:
        return 'fallido'
    if int(status.get('succeeded') or 0) > 0:
        return 'completo'
    if int(status.get('failed') or 0) > 0:
        return 'fallido'
    return 'pendiente'


def _escribir(path: str, payload: dict[str, Any]) -> None:
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh)


def _leer_resultado(path: str) -> dict[str, Any]:
    with open(path, encoding='utf-8') as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise ValueError('resultado')
    return payload


def _imprimir_url_tag(tag: str) -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        print('canary-probe: describe no es JSON', file=sys.stderr)
        return 0
    if not isinstance(payload, dict):
        return 0
    sys.stdout.write(extraer_url_tag(payload, tag))
    return 0


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description='Sonda GET de solo lectura al tag del canary')
    parser.add_argument('--print-tag-url', action='store_true')
    parser.add_argument('--tag', default='')
    parser.add_argument('--url', default='')
    parser.add_argument('--min-requests', type=int, default=0)
    parser.add_argument('--window-seconds', type=int, default=1800)
    parser.add_argument('--margin-seconds', type=int, default=180)
    parser.add_argument('--started-at', type=int, default=0)
    parser.add_argument('--manifest-out', default='')
    parser.add_argument('--image', default='')
    parser.add_argument('--job-name', default='')
    parser.add_argument('--result-out', default='')
    parser.add_argument('--aplicar-log-job', default='')
    parser.add_argument('--log-file', default='')
    parser.add_argument('--marcar-job', default='')
    parser.add_argument('--job-estado', default='')
    parser.add_argument('--estado-job', action='store_true')
    args = parser.parse_args(argv)

    if args.estado_job:
        raw = sys.stdin.read()
        try:
            payload = json.loads(raw) if raw.strip() else None
        except json.JSONDecodeError:
            payload = None
        if payload is not None and not isinstance(payload, dict):
            payload = None
        sys.stdout.write(clasificar_job(payload))
        return 0

    if args.aplicar_log_job:
        if not args.log_file:
            print('canary-probe: falta --log-file', file=sys.stderr)
            return 1
        resultado = _leer_resultado(args.aplicar_log_job)
        with open(args.log_file, encoding='utf-8') as fh:
            log = fh.read()
        _escribir(args.aplicar_log_job, aplicar_log_job(resultado, log))
        return 0

    if args.marcar_job:
        if args.job_estado not in ESTADOS_JOB:
            print('canary-probe: --job-estado inválido', file=sys.stderr)
            return 1
        try:
            resultado = _leer_resultado(args.marcar_job)
        except FileNotFoundError:
            resultado = armar_resultado('', 0, {
                'llego_a_la_app': False,
                'llegaron': 0,
                'cinco_xx': 0,
                'errores_transporte': 0,
                'clase': 'transporte',
            })
            resultado['tenia_url'] = True
        _escribir(args.marcar_job, marcar_job(resultado, args.job_estado))
        return 0

    if args.print_tag_url:
        if not args.tag:
            print('canary-probe: falta --tag', file=sys.stderr)
            return 1
        return _imprimir_url_tag(args.tag)

    if not url_es_del_tag(args.url, args.tag):
        print('canary-probe: URL no es la del tag', file=sys.stderr)
        return 1
    if args.min_requests < 0 or args.window_seconds < 1:
        print('canary-probe: ventana o mínimo inválido', file=sys.stderr)
        return 1
    total = cantidad_a_enviar(args.min_requests)
    rutas = plan_rutas(total)
    if not rutas:
        print('canary-probe: min_requests=0, no se envía sonda')
        return 0

    inicio = args.started_at or int(time.time())
    deadline = float(inicio + args.window_seconds - args.margin_seconds)
    corrida = correr_plan(
        _pedir,
        args.url.rstrip('/'),
        rutas,
        time.time,
        time.sleep,
        deadline,
    )
    resultado = armar_resultado(args.url.rstrip('/'), total, corrida)
    _escribir(args.result_out or RUTA_RESULTADO, resultado)
    if not corrida['llego_a_la_app']:
        if args.manifest_out and args.image and args.job_name:
            try:
                texto = manifiesto_job(
                    job_name=args.job_name,
                    image=args.image,
                    url=args.url.rstrip('/'),
                    tag=args.tag,
                    cantidad=total,
                    deadline_epoch=int(deadline),
                )
            except ValueError as err:
                print(f'canary-probe: sin manifiesto ({err})', file=sys.stderr)
                return 2
            with open(args.manifest_out, 'w', encoding='utf-8') as fh:
                fh.write(texto)
            print(f'canary-probe: manifiesto {args.manifest_out} ({corrida["clase"]})')
        return 2
    print(
        f'canary-probe: respuestas de la app={corrida["llegaron"]}/{len(rutas)} '
        f'5xx={corrida["cinco_xx"]} transporte={corrida["errores_transporte"]}'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
