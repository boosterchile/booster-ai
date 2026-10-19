"""Sonda de solo lectura del canary. Stdlib."""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import canary_synthetic_probe as sonda
from canary_synthetic_probe import (
    RUTAS_SEGURAS,
    clasificar_respuesta,
    correr_plan,
    espera_antes,
    extraer_url_tag,
    manifiesto_job,
    plan_rutas,
    url_es_del_tag,
)
from canary_verify_decision import decidir_canary, reintentos_de_muestra

ROOT = Path(__file__).resolve().parents[2]
CLOUDBUILD = ROOT / 'cloudbuild.production.yaml'
TAG = 'canary-signup-0123456789ab'
URL = f'https://{TAG}---booster-ai-api-abc.a.run.app'
HTML_404 = (
    '<html><head><title>404 Page not found</title></head>'
    '<body><h1>Error: Page not found</h1></body></html>'
)


class PlanTest(unittest.TestCase):
    def test_exactamente_el_piso_y_solo_health(self) -> None:
        rutas = plan_rutas(30)
        self.assertEqual(len(rutas), 30)
        self.assertTrue(set(rutas) <= set(RUTAS_SEGURAS))
        self.assertEqual(rutas[0], '/health')
        self.assertEqual(rutas[1], '/health/signup-flow')
        self.assertNotIn('/ready', rutas)

    def test_cero_no_manda_nada(self) -> None:
        self.assertEqual(plan_rutas(0), [])

    def test_rechaza_ruta_fuera_de_la_lista(self) -> None:
        with self.assertRaises(ValueError):
            plan_rutas(2, ('/health', '/me'))


class ClasificarTest(unittest.TestCase):
    def test_json_de_la_app_cuenta_como_llegada(self) -> None:
        self.assertEqual(
            clasificar_respuesta(200, 'application/json', '{"status":"ok"}'),
            'aplicacion',
        )

    def test_503_json_sigue_siendo_la_app(self) -> None:
        self.assertEqual(
            clasificar_respuesta(503, 'application/json; charset=utf-8', '{"status":"not_ready"}'),
            'aplicacion',
        )

    def test_html_404_de_google_es_ingress(self) -> None:
        self.assertEqual(
            clasificar_respuesta(404, 'text/html; charset=utf-8', HTML_404),
            'ingress',
        )

    def test_sin_respuesta_es_transporte(self) -> None:
        self.assertEqual(clasificar_respuesta(None, '', ''), 'transporte')


class UrlTagTest(unittest.TestCase):
    def test_acepta_el_url_del_tag(self) -> None:
        self.assertTrue(url_es_del_tag(URL, TAG))

    def test_rechaza_el_host_publico_y_otro_tag(self) -> None:
        self.assertFalse(url_es_del_tag('https://api.boosterchile.com/health', TAG))
        self.assertFalse(url_es_del_tag('https://otro---booster-ai-api-abc.a.run.app', TAG))
        self.assertFalse(url_es_del_tag('http://' + TAG + '---booster-ai-api-abc.a.run.app', TAG))

    def test_extrae_el_url_del_describe(self) -> None:
        payload = {
            'status': {
                'url': 'https://booster-ai-api-abc.a.run.app',
                'traffic': [
                    {'tag': 'estable', 'url': 'https://estable---booster-ai-api-abc.a.run.app'},
                    {'tag': TAG, 'url': URL, 'percent': 1},
                ],
            }
        }
        self.assertEqual(extraer_url_tag(payload, TAG), URL)

    def test_compone_el_url_si_el_tag_no_trae_url(self) -> None:
        payload = {
            'status': {
                'url': 'https://booster-ai-api-abc.a.run.app',
                'traffic': [{'tag': TAG, 'revisionName': 'booster-ai-api-00001-abc'}],
            }
        }
        self.assertEqual(extraer_url_tag(payload, TAG), URL)


class EsperaTest(unittest.TestCase):
    def test_la_primera_sale_ya_y_el_resto_cabe_antes_del_margen(self) -> None:
        self.assertEqual(espera_antes(0, 30, ahora=0, deadline=1620), 0)
        pausa = espera_antes(1, 30, ahora=0, deadline=1620)
        self.assertGreater(pausa, 0)
        self.assertLessEqual(pausa, 60)
        self.assertAlmostEqual(pausa, 1620 / 29, places=3)

    def test_sin_tiempo_no_espera(self) -> None:
        self.assertEqual(espera_antes(5, 30, ahora=1620, deadline=1620), 0)


class ManifiestoTest(unittest.TestCase):
    def test_el_job_no_arranca_el_api_ni_monta_token(self) -> None:
        texto = manifiesto_job(
            job_name='canary-probe-0123456789ab',
            image='southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/api:abc',
            url=URL,
            tag=TAG,
            cantidad=30,
            deadline_epoch=1_700_000_000,
        )
        doc = json.loads(texto)
        contenedor = doc['spec']['template']['spec']['containers'][0]
        self.assertEqual(contenedor['command'][0], 'node')
        self.assertNotIn('dist/main.js', texto)
        self.assertNotIn('POST', contenedor['command'][2])
        self.assertNotIn('Authorization', contenedor['command'][2])
        self.assertIn("method: 'GET'", contenedor['command'][2])
        self.assertIn('/health/signup-flow', contenedor['command'][2])
        self.assertNotIn('/ready', contenedor['command'][2])
        env = {item['name']: item['value'] for item in contenedor['env']}
        self.assertEqual(env['CANARY_URL'], URL)
        self.assertEqual(env['CANARY_COUNT'], '30')
        self.assertFalse(doc['spec']['template']['spec']['automountServiceAccountToken'])
        recursos = contenedor['resources']['requests']
        self.assertIn('cpu', recursos)
        self.assertIn('memory', recursos)
        self.assertEqual(doc['spec']['backoffLimit'], 0)

    def test_rechaza_url_que_no_es_del_tag(self) -> None:
        with self.assertRaises(ValueError):
            manifiesto_job(
                job_name='canary-probe-0123456789ab',
                image='api:abc',
                url='https://api.boosterchile.com',
                tag=TAG,
                cantidad=30,
                deadline_epoch=1,
            )


class DecisionSigueIgualTest(unittest.TestCase):
    def test_muestra_chica_sigue_promoviendo_sin_p95(self) -> None:
        codigo, lineas = decidir_canary(6, 30, {'2xx': 6}, [1408.0])
        self.assertEqual(codigo, 0)
        self.assertIn('WARN', lineas[0])
        self.assertNotIn('FAIL', '\n'.join(lineas))

    def test_muestra_suficiente_sigue_abortando(self) -> None:
        self.assertEqual(decidir_canary(35, 30, {'2xx': 34, '5xx': 1}, [100.0])[0], 1)
        self.assertEqual(decidir_canary(35, 30, {'2xx': 35}, [500.0])[0], 1)

    def test_reintenta_mientras_la_muestra_no_llega(self) -> None:
        self.assertTrue(reintentos_de_muestra(5, 30, 1, 4))
        self.assertFalse(reintentos_de_muestra(30, 30, 1, 4))
        self.assertFalse(reintentos_de_muestra(5, 30, 4, 4))
        self.assertFalse(reintentos_de_muestra(0, 0, 1, 4))


class CorrerPlanTest(unittest.TestCase):
    def test_ingress_en_el_primer_get_no_sigue(self) -> None:
        llamadas: list[str] = []

        def pedir(url: str, path: str) -> tuple[int | None, str, str]:
            llamadas.append(path)
            return 404, 'text/html', HTML_404

        llegaron, clase = correr_plan(
            pedir, URL, plan_rutas(30), ahora=lambda: 0, dormir=lambda _s: None, deadline=10
        )
        self.assertEqual(llegaron, 0)
        self.assertEqual(clase, 'ingress')
        self.assertEqual(llamadas, ['/health'])

    def test_cuenta_solo_respuestas_de_la_app(self) -> None:
        def pedir(url: str, path: str) -> tuple[int | None, str, str]:
            return 200, 'application/json', '{"status":"ok"}'

        llegaron, clase = correr_plan(
            pedir, URL, ['/health', '/health/signup-flow'], ahora=lambda: 0, dormir=lambda _s: None, deadline=0
        )
        self.assertEqual((llegaron, clase), (2, 'aplicacion'))


class HttpLocalTest(unittest.TestCase):
    def test_el_primer_404_html_sale_2_y_escribe_el_job(self) -> None:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                body = HTML_404.encode()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, fmt: str, *args: object) -> None:
                return

        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        puerto = server.server_address[1]
        base = f'http://127.0.0.1:{puerto}'
        original = sonda._pedir
        vistos: list[str] = []

        def pedir_local(url: str, path: str, timeout: float = 10) -> tuple[int | None, str, str]:
            vistos.append(url + path)
            return original(base, path, timeout)

        sonda._pedir = pedir_local
        self.addCleanup(lambda: setattr(sonda, '_pedir', original))
        fd, nombre = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        destino = Path(nombre)
        # el manifiesto exige URL de tag; el GET real va a localhost vía el wrapper
        codigo = sonda.main(
            [
                '--url',
                URL,
                '--tag',
                TAG,
                '--min-requests',
                '4',
                '--window-seconds',
                '60',
                '--margin-seconds',
                '0',
                '--started-at',
                '1',
                '--manifest-out',
                str(destino),
                '--image',
                'api:abc',
                '--job-name',
                'canary-probe-0123456789ab',
            ]
        )
        self.addCleanup(lambda: destino.unlink(missing_ok=True))
        self.assertEqual(codigo, 2)
        self.assertEqual(vistos, [URL + '/health'])
        doc = json.loads(destino.read_text(encoding='utf-8'))
        self.assertEqual(doc['metadata']['name'], 'canary-probe-0123456789ab')
        self.assertNotIn('dist/main.js', destino.read_text(encoding='utf-8'))


class CloudBuildTest(unittest.TestCase):
    def test_piso_y_sonda_en_la_ventana(self) -> None:
        texto = CLOUDBUILD.read_text(encoding='utf-8')
        self.assertIn("_CANARY_MIN_REQUESTS: '30'", texto)
        self.assertIn('canary_synthetic_probe.py', texto)
        self.assertNotIn('FAIL muestra insuficiente', texto)
        inicio = texto.index('id: canary-sleep')
        fin = texto.index('id: canary-verify')
        script = texto[inicio:fin]
        self.assertIn('scripts/deploy/canary_synthetic_probe.py', script)
        self.assertIn('sleep', script)
        suelto = script.replace('$$', '')
        suelto = re.sub(r'\$\{_[A-Z0-9_]+\}', '', suelto)
        suelto = suelto.replace('$PROJECT_ID', '')
        self.assertIsNone(re.search(r'\$[A-Za-z_{]', suelto), suelto)


if __name__ == '__main__':
    unittest.main()
