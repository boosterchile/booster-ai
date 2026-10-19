"""Sonda de solo lectura del canary. Stdlib."""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import canary_synthetic_probe as sonda
from canary_synthetic_probe import (
    RUTAS_SEGURAS,
    aplicar_log_job,
    cantidad_a_enviar,
    clasificar_respuesta,
    correr_plan,
    espera_antes,
    clasificar_job,
    extraer_url_tag,
    manifiesto_job,
    plan_rutas,
    url_es_del_tag,
)
from canary_verify_decision import (
    decidir_canary,
    decidir_gate,
    decidir_resultado_sonda,
    reintentos_de_muestra,
)

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

    def test_la_sonda_manda_cinco_de_mas_sin_bajar_el_piso(self) -> None:
        self.assertEqual(cantidad_a_enviar(30), 35)
        self.assertEqual(cantidad_a_enviar(0), 0)
        rutas = plan_rutas(cantidad_a_enviar(30))
        self.assertEqual(len(rutas), 35)
        self.assertTrue(set(rutas) <= set(RUTAS_SEGURAS))

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

    def test_503_html_de_cloud_run_no_es_ingress(self) -> None:
        html_503 = (
            '<html><head><title>503 Service Unavailable</title></head>'
            '<body><h1>Error: Service Unavailable</h1></body></html>'
        )
        self.assertEqual(
            clasificar_respuesta(503, 'text/html; charset=UTF-8', html_503),
            'aplicacion',
        )
        self.assertEqual(clasificar_respuesta(500, 'text/html', html_503), 'aplicacion')
        self.assertEqual(clasificar_respuesta(502, 'text/html', '<html>bad gateway</html>'), 'aplicacion')

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
            image='southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/api@sha256:' + ('b' * 64),
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
        host = URL.split('//', 1)[1]
        alias = doc['spec']['template']['spec']['hostAliases']
        self.assertEqual(
            [item['ip'] for item in alias],
            ['199.36.153.8', '199.36.153.9', '199.36.153.10', '199.36.153.11'],
        )
        self.assertTrue(all(item['hostnames'] == [host] for item in alias))
        self.assertGreaterEqual(doc['spec']['ttlSecondsAfterFinished'], 1800)
        self.assertIn('if (i === 0 && !llego) break;', contenedor['command'][2])
        self.assertEqual(doc['metadata']['namespace'], 'default')
        self.assertEqual(doc['metadata']['name'], 'canary-probe-0123456789ab')

    def test_la_imagen_del_job_va_por_digest(self) -> None:
        digest = 'a' * 64
        texto = manifiesto_job(
            job_name='canary-probe-0123456789ab',
            image=f'southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/api@sha256:{digest}',
            url=URL,
            tag=TAG,
            cantidad=35,
            deadline_epoch=1,
        )
        imagen = json.loads(texto)['spec']['template']['spec']['containers'][0]['image']
        self.assertIn(f'@sha256:{digest}', imagen)
        with self.assertRaises(ValueError):
            manifiesto_job(
                job_name='canary-probe-0123456789ab',
                image='southamerica-west1-docker.pkg.dev/booster-ai-494222/containers/api:abc',
                url=URL,
                tag=TAG,
                cantidad=35,
                deadline_epoch=1,
            )

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

        corrida = correr_plan(
            pedir, URL, plan_rutas(30), ahora=lambda: 0, dormir=lambda _s: None, deadline=10
        )
        self.assertEqual(corrida['llegaron'], 0)
        self.assertEqual(corrida['clase'], 'ingress')
        self.assertEqual(llamadas, ['/health'])

    def test_cuenta_solo_respuestas_de_la_app(self) -> None:
        def pedir(url: str, path: str) -> tuple[int | None, str, str]:
            return 200, 'application/json', '{"status":"ok"}'

        corrida = correr_plan(
            pedir, URL, ['/health', '/health/signup-flow'], ahora=lambda: 0, dormir=lambda _s: None, deadline=0
        )
        self.assertEqual((corrida['llegaron'], corrida['clase']), (2, 'aplicacion'))


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
                '--result-out',
                str(destino) + '.resultado.json',
                '--image',
                'southamerica-west1-docker.pkg.dev/p/c/api@sha256:' + ('c' * 64),
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
        self.assertIn('image_summary.digest', script)
        self.assertIn('/workspace/canary-probe.json', texto)
        self.assertNotIn('kubectl wait --for=condition=complete', script)
        self.assertIn('--estado-job', script)
        self.assertIn('--job-estado perdido', script)
        self.assertLess(script.index('kubectl delete job'), script.index('kubectl logs'))
        self.assertLess(script.index('kubectl logs'), script.rindex('kubectl delete job'))
        verify = texto[fin:texto.index('id: deploy-api', fin)]
        self.assertLess(
            verify.index('decidir_resultado_sonda('),
            verify.index('total, counts, p95s = leer_muestra()'),
        )
        self.assertIn('dominado por /health', texto)

    def test_el_ci_corre_los_unittest_de_deploy(self) -> None:
        ci = (ROOT / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        self.assertIn("python3 -m unittest discover -s scripts/deploy -p '*_test.py'", ci)
        self.assertIn('deploy-scripts', ci)


HTML_503 = (
    '<html><head><title>503 Service Unavailable</title></head>'
    '<body><h1>Error: Service Unavailable</h1></body></html>'
)


class ResultadoSondaTest(unittest.TestCase):
    def test_503_html_llega_a_la_app_y_no_termina_en_warn(self) -> None:
        def pedir(url: str, path: str) -> tuple[int | None, str, str]:
            return 503, 'text/html; charset=UTF-8', HTML_503

        corrida = correr_plan(
            pedir, URL, plan_rutas(35), ahora=lambda: 0, dormir=lambda _s: None, deadline=10
        )
        self.assertTrue(corrida['llego_a_la_app'])
        self.assertGreater(corrida['cinco_xx'], 0)
        self.assertNotEqual(corrida['clase'], 'ingress')
        resultado = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'cinco_xx': corrida['cinco_xx'],
            'errores_transporte': corrida['errores_transporte'],
            'camino_directo': 'ok',
            'job': 'no_necesario',
        }
        # La muestra de Monitoring sigue chica: antes esto promovía con WARN.
        codigo, lineas = decidir_gate(resultado, 6, 30, {'2xx': 6}, [1408.0])
        self.assertNotEqual(codigo, 0)
        texto = '\n'.join(lineas)
        self.assertIn('FAIL', texto)
        self.assertNotIn('Promoviendo', texto)
        self.assertEqual(decidir_canary(6, 30, {'2xx': 6}, [1408.0])[0], 0)

    def test_timeout_y_conexion_salen_en_el_resultado_y_cuentan(self) -> None:
        respuestas = iter(
            [
                (200, 'application/json', '{"status":"ok"}'),
                (None, '', ''),
                (None, '', ''),
            ]
        )

        def pedir(url: str, path: str) -> tuple[int | None, str, str]:
            return next(respuestas)

        corrida = correr_plan(
            pedir,
            URL,
            ['/health', '/health/signup-flow', '/health'],
            ahora=lambda: 0,
            dormir=lambda _s: None,
            deadline=0,
        )
        self.assertTrue(corrida['llego_a_la_app'])
        self.assertEqual(corrida['errores_transporte'], 2)
        resultado = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'cinco_xx': 0,
            'errores_transporte': corrida['errores_transporte'],
            'camino_directo': 'ok',
            'job': 'no_necesario',
        }
        codigo, lineas = decidir_resultado_sonda(resultado)
        self.assertNotEqual(codigo, 0)
        self.assertIn('conexión', '\n'.join(lineas))

    def test_directo_y_job_fallaron_con_url_no_es_warn(self) -> None:
        resultado = {
            'tenia_url': True,
            'llego_a_la_app': False,
            'cinco_xx': 0,
            'errores_transporte': 1,
            'camino_directo': 'transporte',
            'job': 'fallo',
        }
        codigo, lineas = decidir_gate(resultado, 0, 30, {}, [])
        self.assertNotEqual(codigo, 0)
        texto = '\n'.join(lineas)
        self.assertIn('FAIL', texto)
        self.assertNotIn('Promoviendo', texto)

    def test_sin_url_sigue_promoviendo_con_warn(self) -> None:
        codigo, lineas = decidir_gate(None, 6, 30, {'2xx': 6}, [1408.0])
        self.assertEqual(codigo, 0)
        self.assertIn('WARN', lineas[0])

    def test_el_log_del_job_trae_los_mismos_errores(self) -> None:
        log = '\n'.join(
            [
                '{"i":0,"path":"/health","status":200}',
                '{"i":1,"path":"/health/signup-flow","error":"connect ETIMEDOUT"}',
                '{"resumen":{"llego_a_la_app":true,"cinco_xx":1,"errores_transporte":2,'
                '"respuestas_app":33,"total_plan":35}}',
            ]
        )
        base = {
            'tenia_url': True,
            'llego_a_la_app': False,
            'cinco_xx': 0,
            'errores_transporte': 1,
            'camino_directo': 'ingress',
            'job': 'no_corrido',
        }
        merged = aplicar_log_job(base, log)
        self.assertTrue(merged['llego_a_la_app'])
        self.assertEqual(merged['cinco_xx'], 1)
        self.assertEqual(merged['errores_transporte'], 2)
        self.assertEqual(merged['job'], 'ok')
        codigo, _lineas = decidir_resultado_sonda(merged)
        self.assertNotEqual(codigo, 0)

    def test_main_escribe_el_resultado_con_el_503(self) -> None:
        original = sonda._pedir

        def pedir_503(url: str, path: str, timeout: float = 10) -> tuple[int | None, str, str]:
            return 503, 'text/html; charset=UTF-8', HTML_503

        sonda._pedir = pedir_503
        self.addCleanup(lambda: setattr(sonda, '_pedir', original))
        fd, nombre = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        destino = Path(nombre)
        self.addCleanup(lambda: destino.unlink(missing_ok=True))
        codigo = sonda.main(
            [
                '--url',
                URL,
                '--tag',
                TAG,
                '--min-requests',
                '30',
                '--window-seconds',
                '60',
                '--margin-seconds',
                '0',
                '--started-at',
                '1',
                '--result-out',
                str(destino),
                '--image',
                'api:abc',
                '--job-name',
                'canary-probe-0123456789ab',
            ]
        )
        self.assertEqual(codigo, 0)
        doc = json.loads(destino.read_text(encoding='utf-8'))
        self.assertTrue(doc['tenia_url'])
        self.assertTrue(doc['llego_a_la_app'])
        self.assertEqual(doc['cinco_xx'], 35)
        self.assertEqual(doc['total_plan'], 35)
        self.assertEqual(doc['errores_transporte'], 0)
        self.assertNotEqual(decidir_resultado_sonda(doc)[0], 0)


class JobEstadoTest(unittest.TestCase):
    def test_completo_fallido_y_ausente(self) -> None:
        self.assertEqual(
            clasificar_job({'status': {'conditions': [{'type': 'Complete', 'status': 'True'}]}}),
            'completo',
        )
        self.assertEqual(
            clasificar_job({'status': {'conditions': [{'type': 'Failed', 'status': 'True'}]}}),
            'fallido',
        )
        self.assertEqual(clasificar_job({'status': {'failed': 1}}), 'fallido')
        self.assertEqual(clasificar_job({'metadata': {'name': 'canary-probe-0123456789ab'}}), 'pendiente')
        self.assertEqual(clasificar_job(None), 'ausente')
        self.assertEqual(clasificar_job({}), 'ausente')

    def test_cli_estado_job_lee_el_json(self) -> None:
        original = sys.stdin
        sys.stdin = io.StringIO(
            '{"status":{"conditions":[{"type":"Failed","status":"True"}]}}'
        )
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                codigo = sonda.main(['--estado-job'])
        finally:
            sys.stdin = original
        self.assertEqual(codigo, 0)
        self.assertEqual(buf.getvalue(), 'fallido')

    def test_el_script_del_job_rechaza_un_host_que_no_es_el_tag(self) -> None:
        if shutil.which('node') is None:
            self.skipTest('node no está en el PATH')
        doc = json.loads(
            manifiesto_job(
                job_name='canary-probe-0123456789ab',
                image='southamerica-west1-docker.pkg.dev/p/c/api@sha256:' + ('d' * 64),
                url=URL,
                tag=TAG,
                cantidad=1,
                deadline_epoch=1,
            )
        )
        script = doc['spec']['template']['spec']['containers'][0]['command'][2]
        env = os.environ.copy()
        env.update(
            {
                'CANARY_URL': 'https://api.boosterchile.com',
                'CANARY_TAG': TAG,
                'CANARY_COUNT': '35',
                'CANARY_DEADLINE_EPOCH': '1',
            }
        )
        proc = subprocess.run(
            ['node', '-e', script],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(proc.returncode, 1)
        resumen = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertFalse(resumen['resumen']['llego_a_la_app'])


if __name__ == '__main__':
    unittest.main()
