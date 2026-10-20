"""Decision del gate canary-verify. Stdlib, sin red."""

from __future__ import annotations

import io
import os
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from canary_verify_decision import (
    conviene_leer_p95,
    decidir_canary,
    decidir_gate,
    espera_backoff_reversion,
    leer_resultado_sonda,
    main,
    percentil_95,
    resultado_reversion,
    revision_estable,
)

ROOT = Path(__file__).resolve().parents[2]
CLOUDBUILD = ROOT / 'cloudbuild.production.yaml'


def _claves_reales(texto: str, prefijo: str) -> list[str]:
    """Valores de claves en columna 0. Un comentario no cuenta."""
    valores: list[str] = []
    for linea in texto.splitlines():
        if linea.startswith('#') or not linea.startswith(prefijo):
            continue
        valores.append(linea.split('#', 1)[0].split(':', 1)[1].strip())
    return valores


def _campo_de_job(texto: str, job: str, campo: str) -> str:
    """Valor de un campo del job. Ignora comentarios y el job siguiente."""
    lineas = texto.splitlines()
    inicio = next(i for i, linea in enumerate(lineas) if linea.startswith(f'  {job}:'))
    for linea in lineas[inicio + 1:]:
        if linea.startswith('  ') and not linea.startswith('    ') and linea.rstrip().endswith(':'):
            break
        desnuda = linea.split('#', 1)[0]
        if desnuda.strip().startswith(f'{campo}:'):
            return desnuda.split(':', 1)[1].strip()
    raise AssertionError(f'{job}.{campo}')


class DecidirCanaryTest(unittest.TestCase):
    def test_muestra_chica_falla_sin_mirar_p95(self) -> None:
        codigo, lineas = decidir_canary(6, 30, {'2xx': 6}, [1408.0])
        self.assertEqual(codigo, 1)
        texto = '\n'.join(lineas)
        self.assertIn('FAIL', texto)
        self.assertIn('6 < 30', texto)
        self.assertNotIn('p95', texto)
        self.assertIn('REVERTIR_TAG', texto)
        self.assertNotIn('Promoviendo', texto)

    def test_cero_requests_con_piso_falla(self) -> None:
        codigo, lineas = decidir_canary(0, 30, {}, [])
        self.assertEqual(codigo, 1)
        self.assertIn('FAIL', lineas[0])
        self.assertIn('REVERTIR_TAG', lineas[-1])

    def test_justo_bajo_el_piso_falla(self) -> None:
        codigo, lineas = decidir_canary(29, 30, {'2xx': 29}, [900.0])
        self.assertEqual(codigo, 1)
        self.assertNotIn('p95', '\n'.join(lineas))

    def test_muestra_suficiente_aborta_por_error_rate(self) -> None:
        codigo, lineas = decidir_canary(100, 30, {'2xx': 99, '5xx': 1}, [100.0])
        self.assertEqual(codigo, 1)
        self.assertIn('error_rate', '\n'.join(lineas))

    def test_muestra_suficiente_aborta_por_p95(self) -> None:
        codigo, lineas = decidir_canary(35, 30, {'2xx': 35}, [1408.0])
        self.assertEqual(codigo, 1)
        self.assertIn('p95', '\n'.join(lineas))

    def test_muestra_suficiente_sana_promueve(self) -> None:
        codigo, lineas = decidir_canary(35, 30, {'2xx': 35}, [499.0])
        self.assertEqual(codigo, 0)
        self.assertIn('OK', lineas[-1])

    def test_piso_en_el_limite_evalua_slos(self) -> None:
        codigo, _lineas = decidir_canary(30, 30, {'2xx': 30}, [100.0])
        self.assertEqual(codigo, 0)

    def test_sin_latencias_con_muestra_solo_aplica_error_rate(self) -> None:
        codigo, lineas = decidir_canary(35, 30, {'2xx': 35}, [])
        self.assertEqual(codigo, 0)
        self.assertTrue(any('latencias' in linea for linea in lineas))

    def test_piso_cero_falla_sin_evaluar_p95(self) -> None:
        codigo, lineas = decidir_canary(6, 0, {'2xx': 6}, [1408.0])
        self.assertEqual(codigo, 1)
        texto = '\n'.join(lineas)
        self.assertIn('_CANARY_MIN_REQUESTS=0', texto)
        self.assertNotIn('p95', texto)
        self.assertIn('REVERTIR_TAG', texto)

    def test_piso_cero_sin_requests_falla(self) -> None:
        codigo, lineas = decidir_canary(0, 0, {}, [])
        self.assertEqual(codigo, 1)
        self.assertIn('_CANARY_MIN_REQUESTS=0', lineas[0])
        self.assertIn('REVERTIR_TAG', lineas[-1])

    def test_sonda_con_5xx_no_cae_en_el_warn_de_muestra_chica(self) -> None:
        resultado = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'cinco_xx': 1,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'no_necesario',
        }
        codigo, lineas = decidir_gate(resultado, 6, 30, {'2xx': 6}, [1408.0])
        self.assertNotEqual(codigo, 0)
        texto = '\n'.join(lineas)
        self.assertIn('5xx', texto)
        self.assertNotIn('Promoviendo', texto)
        self.assertNotIn('REVERTIR_TAG', texto)

    def test_resultado_ilegible_aborta_y_el_ausente_no(self) -> None:
        fd, nombre = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        self.addCleanup(lambda: os.remove(nombre) if os.path.exists(nombre) else None)
        ausente, codigo_ausente, _ = leer_resultado_sonda(nombre + '.no-existe')
        self.assertIsNone(ausente)
        self.assertEqual(codigo_ausente, 0)
        with open(nombre, 'w', encoding='utf-8') as fh:
            fh.write('{')
        _cargado, codigo, lineas = leer_resultado_sonda(nombre)
        self.assertEqual(codigo, 1)
        self.assertIn('NO promover', lineas[0])

    def test_yaml_mantiene_el_piso_y_delega_la_decision(self) -> None:
        texto = CLOUDBUILD.read_text(encoding='utf-8')
        self.assertIn("_CANARY_MIN_REQUESTS: '30'", texto)
        self.assertNotIn('FAIL muestra insuficiente', texto)
        self.assertIn('decidir_canary', texto)
        self.assertIn('decidir_gate', texto)
        self.assertIn('conviene_leer_p95', texto)
        verify = texto[texto.index('id: canary-verify'):texto.index('id: deploy-api')]
        self.assertIn('REVERTIR_TAG', verify)
        self.assertIn('resultado_reversion', verify)
        self.assertIn('timeout: 480s', verify)
        self.assertIn('El tope del build es 5400s', verify)
        self.assertNotIn('3600s', verify)
        self.assertIn('timeout -k 5 30 gcloud run services describe', verify)
        self.assertIn('timeout -k 5 30 gcloud auth print-access-token', verify)
        self.assertIn('timeout -k 5 30 gcloud run services update-traffic', verify)
        self.assertIn('--remove-tags=', verify)
        self.assertIn('ALERTA revertir el tag falló', verify)
        self.assertIn('for intento in 1 2 3', verify)
        self.assertIn('FAIL no se encontró revision con tag', verify)
        decision = verify[verify.index('no se encontró revision'):]
        self.assertIn('exit 1', decision)
        self.assertNotIn('exit 0', decision)
        self.assertNotIn('sin gate automático, decisión humana', texto)
        inicio = texto.index('from canary_verify_decision import decidir_canary')
        fin = texto.index('PYCHECK', inicio)
        bloque = texto[inicio:fin]
        self.assertNotIn('$', bloque)

    def test_presupuesto_cabe_holgado_bajo_5400(self) -> None:
        texto = CLOUDBUILD.read_text(encoding='utf-8')
        tope = _claves_reales(texto, 'timeout:')
        self.assertEqual(tope, ['5400s'])
        self.assertNotIn('timeout: 3600s', texto)
        bloque = texto.split('# Timeout global del build', 1)[1].split('timeout: 5400s', 1)[0]
        filas = {
            etiqueta: int(valor)
            for etiqueta, valor in re.findall(r'^#\s{2,}(\S.*?)\s{2,}(\d+) s', bloque, re.M)
        }
        suma = (
            filas['hasta route-canary']
            + filas['canary-sleep']
            + filas['canary-verify']
            + filas['deploy-api + gke +']
        )
        self.assertEqual(suma, filas['suma'])
        self.assertEqual(filas['canary-sleep'], 2100)
        self.assertEqual(filas['canary-verify'], 480)
        self.assertGreaterEqual(5400 - suma, 300)
        self.assertIn('margen 480 s', bloque)
        self.assertIn('c11b1702', bloque)
        self.assertIn('ventana 1800', bloque)
        self.assertIn('No se acorta', bloque)
        verify = texto[texto.index('id: canary-verify'):texto.index('id: deploy-api')]
        self.assertIn('30+180+30+192 = 432', verify)
        release = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        minutos = int(_campo_de_job(release, 'deploy-production', 'timeout-minutes'))
        self.assertEqual(minutos, 130)
        segundos = int(tope[0].removesuffix('s'))
        # 30 min de CI Success + el build + 10 min de smoke y setup.
        self.assertGreaterEqual(minutos * 60, 30 * 60 + segundos + 10 * 60)
        cuenta = release.split('timeout-minutes: 130', 1)[0]
        filas_job = {
            etiqueta: int(valor)
            for etiqueta, valor in re.findall(r'^[ ]*# {2,}(\S.*?) {2,}(\d+) min', cuenta, re.M)
        }
        self.assertEqual(
            filas_job['espera CI Success'] + filas_job['Cloud Build'] + filas_job['smoke y setup'],
            filas_job['suma'],
        )
        self.assertEqual(filas_job['suma'], minutos)
        self.assertEqual(filas_job['Cloud Build'] * 60, segundos)
        inicio = release.index('name: Trigger Cloud Build (production)')
        fin = release.index('name: Smoke test', inicio)
        comando = '\n'.join(linea.split('#', 1)[0] for linea in release[inicio:fin].splitlines())
        self.assertIn('gcloud builds submit', comando)
        self.assertNotIn('--async', comando)

    def test_cuatro_xx_no_cambia_la_decision(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'cinco_xx': 0,
            'cuatro_xx': 7,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
        }
        codigo, lineas = decidir_gate(llego, 35, 30, {'2xx': 35}, [100.0])
        self.assertEqual(codigo, 0)
        self.assertIn('OK', lineas[-1])
        sin_url = decidir_gate(None, 0, 30, {}, [])
        self.assertEqual(sin_url[0], 1)
        self.assertIn('sin URL', sin_url[1][0])
        self.assertIn('REVERTIR_TAG', sin_url[1][-1])

    def test_job_perdido_no_promueve(self) -> None:
        resultado = {
            'tenia_url': True,
            'llego_a_la_app': False,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ingress',
            'job': 'perdido',
        }
        codigo, lineas = decidir_gate(resultado, 0, 30, {}, [])
        self.assertNotEqual(codigo, 0)
        texto = '\n'.join(lineas)
        self.assertIn('NO promover', texto)
        self.assertIn('ttlSecondsAfterFinished', texto)
        self.assertNotIn('Promoviendo', texto)
        self.assertNotIn('REVERTIR_TAG', texto)

    def test_sin_url_falla_aunque_monitoring_alcance(self) -> None:
        codigo, lineas = decidir_gate(
            {'tenia_url': False, 'llego_a_la_app': False, 'respuestas_app': 0},
            40,
            30,
            {'2xx': 40},
            [100.0],
        )
        self.assertEqual(codigo, 1)
        texto = '\n'.join(lineas)
        self.assertIn('sin URL', texto)
        self.assertIn('REVERTIR_TAG', texto)
        self.assertNotIn('OK', texto)
        ausente, lineas_ausente = decidir_gate(None, 40, 30, {'2xx': 40}, [100.0])
        self.assertEqual(ausente, 1)
        self.assertIn('sin URL', lineas_ausente[0])

    def test_sonda_cubre_el_piso_y_evalua_p95(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'respuestas_app': 35,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
            'p95_ms': 1408.0,
        }
        # 0 < total < 30: el 1408 de Monitoring no decide. Manda el p95 de la sonda.
        malo, lineas_malo = decidir_gate(llego, 6, 30, {'2xx': 6}, [100.0])
        self.assertEqual(malo, 1)
        texto_malo = '\n'.join(lineas_malo)
        self.assertIn('respuestas_app=35', texto_malo)
        self.assertIn('p95', texto_malo)
        self.assertNotIn('REVERTIR_TAG', texto_malo)
        self.assertNotIn('Promoviendo', texto_malo)
        llego['p95_ms'] = 100.0
        sano, lineas_sano = decidir_gate(llego, 6, 30, {'2xx': 6}, [1408.0])
        self.assertEqual(sano, 0)
        self.assertIn('OK', lineas_sano[-1])
        self.assertIn('respuestas_app=35', lineas_sano[0])

    def test_sonda_bajo_el_piso_falla(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'respuestas_app': 10,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
        }
        codigo, lineas = decidir_gate(llego, 6, 30, {'2xx': 6}, [100.0])
        self.assertEqual(codigo, 1)
        texto = '\n'.join(lineas)
        self.assertIn('respuestas_app=10', texto)
        self.assertNotIn('p95', texto)
        self.assertIn('REVERTIR_TAG', texto)
        self.assertNotIn('Promoviendo', texto)

    def test_monitoring_en_cero_con_sonda_en_el_piso_evalua_p95(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'respuestas_app': 35,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
        }
        sano, lineas = decidir_gate(llego, 0, 30, {}, [499.0])
        self.assertEqual(sano, 0)
        self.assertIn('Monitoring=0', lineas[0])
        self.assertIn('OK', lineas[-1])
        malo, lineas_malo = decidir_gate(llego, 0, 30, {}, [500.0])
        self.assertEqual(malo, 1)
        self.assertIn('p95', '\n'.join(lineas_malo))
        self.assertNotIn('REVERTIR_TAG', '\n'.join(lineas_malo))

    def test_total_cero_sin_p95_no_promueve(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'respuestas_app': 35,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
        }
        codigo, lineas = decidir_gate(llego, 0, 30, {}, [])
        self.assertEqual(codigo, 1)
        texto = '\n'.join(lineas)
        self.assertIn('sin p95', texto)
        self.assertNotIn('Promoviendo', texto)
        self.assertNotIn('REVERTIR_TAG', texto)

    def test_total_cero_usa_latencias_de_la_sonda(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'respuestas_app': 35,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
            'latencias_ms': [100.0] * 33 + [800.0, 900.0],
        }
        codigo, lineas = decidir_gate(llego, 0, 30, {}, [])
        self.assertEqual(codigo, 1)
        self.assertIn('p95', '\n'.join(lineas))
        self.assertEqual(percentil_95([10.0, 20.0, 30.0, 400.0]), 400.0)

    def test_piso_cero_en_el_gate_falla_aunque_haya_muestra(self) -> None:
        llego = {
            'tenia_url': True,
            'llego_a_la_app': True,
            'respuestas_app': 35,
            'cinco_xx': 0,
            'errores_transporte': 0,
            'camino_directo': 'ok',
            'job': 'ok',
        }
        codigo, lineas = decidir_gate(llego, 35, 0, {'2xx': 35}, [100.0])
        self.assertEqual(codigo, 1)
        texto = '\n'.join(lineas)
        self.assertIn('_CANARY_MIN_REQUESTS=0', texto)
        self.assertNotIn('p95', texto)
        self.assertIn('REVERTIR_TAG', texto)

    def test_revision_estable_ignora_el_tag(self) -> None:
        trafico: list[object] = [
            {'revisionName': 'api-0002', 'percent': 1, 'tag': 'canary-signup-abc'},
            {'revisionName': 'api-0001', 'percent': 99},
            {'revisionName': 'api-0000', 'percent': 0},
            'basura',
        ]
        self.assertEqual(revision_estable(trafico, 'canary-signup-abc'), 'api-0001')
        self.assertEqual(
            revision_estable([{'revisionName': 'api-0001', 'percent': '99'}], 'canary'),
            'api-0001',
        )
        self.assertIsNone(
            revision_estable(
                [{'revisionName': 'api-0002', 'percent': 1, 'tag': 'canary-signup-abc'}],
                'canary-signup-abc',
            )
        )

    def test_latest_revision_sin_nombre_usa_la_ready(self) -> None:
        trafico: list[object] = [
            {'revisionName': 'api-0002', 'percent': 1, 'tag': 'canary-signup-abc'},
            {'latestRevision': True, 'percent': 99},
        ]
        self.assertEqual(
            revision_estable(trafico, 'canary-signup-abc', latest_ready='api-0001'),
            'api-0001',
        )
        self.assertIsNone(
            revision_estable(
                trafico,
                'canary-signup-abc',
                latest_ready='api-0002',
                latest_created='api-0002',
            )
        )

    def test_revertir_sin_estable_alerta_y_no_es_cero(self) -> None:
        doc = {
            'status': {
                'traffic': [
                    {'revisionName': 'api-0002', 'percent': 1, 'tag': 'canary-signup-abc'},
                ],
                'latestReadyRevisionName': 'api-0002',
            }
        }
        codigo, lineas = resultado_reversion(doc, 'canary-signup-abc')
        self.assertEqual(codigo, 1)
        self.assertIn('ALERTA', lineas[0])
        self.assertNotIn('api-0002', lineas[0])
        describe_roto, lineas_roto = resultado_reversion({'status': {}}, 'canary-signup-abc')
        self.assertEqual(describe_roto, 1)
        self.assertIn('ALERTA', lineas_roto[0])
        self.assertEqual(espera_backoff_reversion(1), 2)
        self.assertEqual(espera_backoff_reversion(2), 4)
        self.assertEqual(espera_backoff_reversion(3), 0)

    def test_conviene_leer_p95_con_piso_de_sonda(self) -> None:
        self.assertFalse(conviene_leer_p95(6, 30, True, 10))
        self.assertFalse(conviene_leer_p95(6, 30, True, 30))
        self.assertTrue(conviene_leer_p95(30, 30, False, 0))
        self.assertFalse(conviene_leer_p95(6, 0, True, 35))
        self.assertFalse(conviene_leer_p95(6, 30, False, 35))

    def test_dry_run_del_gate_con_cero_requests(self) -> None:
        fd, nombre = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        self.addCleanup(lambda: os.remove(nombre) if os.path.exists(nombre) else None)
        with open(nombre, 'w', encoding='utf-8') as fh:
            fh.write(
                '{"tenia_url":true,"llego_a_la_app":false,"cinco_xx":0,'
                '"errores_transporte":0,"camino_directo":"ingress","job":"fallo"}'
            )
        buf = io.StringIO()
        with redirect_stdout(buf):
            codigo = main(['--resultado', nombre, '--total', '0', '--min-requests', '30'])
        self.assertNotEqual(codigo, 0)
        self.assertIn('NO promover', buf.getvalue())
        self.assertNotIn('Promoviendo', buf.getvalue())


if __name__ == '__main__':
    unittest.main()
