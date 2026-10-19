"""Sonda de solo lectura contra el tag del canary. Stdlib.

Durante la ventana de espera manda GET /health y GET /health/signup-flow al
URL del tag, hasta _CANARY_MIN_REQUESTS. No escribe y no pide datos de
usuarios. Si el worker no atraviesa el ingress, emite un Job para correr la
misma sonda desde la VPC del proyecto.

Exit 0: la app respondió el plan. Exit 2: no se llegó a la app (el caller
puede aplicar el manifiesto). Exit 1: argumentos inválidos.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

RUTAS_SEGURAS = ('/health', '/health/signup-flow')
USER_AGENT = 'booster-canary-probe'

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
  console.log(JSON.stringify({ error: 'url' }));
  process.exit(1);
}
function pausa(indice) {
  if (indice === 0) return Promise.resolve();
  const quedan = count - indice;
  const margen = deadline - Date.now();
  const ms = quedan <= 0 || margen <= 0 ? 0 : Math.min(60000, Math.max(0, margen / quedan));
  return new Promise((resolver) => setTimeout(resolver, ms));
}
(async () => {
  let http = 0;
  for (let i = 0; i < count; i += 1) {
    await pausa(i);
    const path = paths[i % paths.length];
    if (!paths.includes(path)) process.exit(1);
    try {
      const res = await fetch(url + path, {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json', 'User-Agent': 'booster-canary-probe' },
      });
      await res.arrayBuffer();
      http += 1;
      console.log(JSON.stringify({ i, path, status: res.status }));
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.log(JSON.stringify({ i, path, error: message }));
    }
  }
  process.exit(http > 0 ? 0 : 1);
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


def clasificar_respuesta(
    status: int | None,
    content_type: str,
    body: str,
) -> str:
    if status is None:
        return 'transporte'
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
            'ttlSecondsAfterFinished': 600,
            'activeDeadlineSeconds': 1800,
            'template': {
                'metadata': {'labels': {'app': 'canary-probe'}},
                'spec': {
                    'restartPolicy': 'Never',
                    'automountServiceAccountToken': False,
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
) -> tuple[int, str]:
    """Devuelve (respuestas de la app, clase del primer intento)."""
    llegaron = 0
    clase = 'transporte'
    for indice, path in enumerate(rutas):
        pausa = espera_antes(indice, len(rutas), ahora(), deadline)
        if pausa > 0:
            dormir(pausa)
        status, tipo, body = pedir(url, path)
        clase_i = clasificar_respuesta(status, tipo, body)
        if indice == 0:
            clase = clase_i
            if clase != 'aplicacion':
                print(
                    f'canary-probe: GET {path} -> {status} {clase} — '
                    'el worker no llegó a la revisión'
                )
                return 0, clase
        if clase_i == 'aplicacion':
            llegaron += 1
        print(f'canary-probe: GET {path} -> {status} {clase_i}')
    return llegaron, clase


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
    args = parser.parse_args(argv)

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
    rutas = plan_rutas(args.min_requests)
    if not rutas:
        print('canary-probe: min_requests=0, no se envía sonda')
        return 0

    inicio = args.started_at or int(time.time())
    deadline = float(inicio + args.window_seconds - args.margin_seconds)
    llegaron, clase = correr_plan(
        _pedir,
        args.url.rstrip('/'),
        rutas,
        time.time,
        time.sleep,
        deadline,
    )
    if clase != 'aplicacion':
        if args.manifest_out and args.image and args.job_name:
            texto = manifiesto_job(
                job_name=args.job_name,
                image=args.image,
                url=args.url.rstrip('/'),
                tag=args.tag,
                cantidad=args.min_requests,
                deadline_epoch=int(deadline),
            )
            with open(args.manifest_out, 'w', encoding='utf-8') as fh:
                fh.write(texto)
            print(f'canary-probe: manifiesto {args.manifest_out} ({clase})')
        return 2
    print(f'canary-probe: respuestas de la app={llegaron}/{len(rutas)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
