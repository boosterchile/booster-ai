"""Decision del gate canary-verify. Stdlib, sin red."""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from canary_verify_decision import decidir_canary, decidir_gate, leer_resultado_sonda, main

ROOT = Path(__file__).resolve().parents[2]
CLOUDBUILD = ROOT / 'cloudbuild.production.yaml'


class DecidirCanaryTest(unittest.TestCase):
    def test_muestra_chica_promueve_sin_mirar_p95(self) -> None:
        codigo, lineas = decidir_canary(6, 30, {'2xx': 6}, [1408.0])
        self.assertEqual(codigo, 0)
        texto = '\n'.join(lineas)
        self.assertIn('WARN', texto)
        self.assertNotIn('FAIL', texto)
        self.assertIn('6 < 30', texto)

    def test_cero_requests_con_piso_promueve(self) -> None:
        codigo, lineas = decidir_canary(0, 30, {}, [])
        self.assertEqual(codigo, 0)
        self.assertIn('WARN', lineas[0])

    def test_justo_bajo_el_piso_promueve(self) -> None:
        codigo, _lineas = decidir_canary(29, 30, {'2xx': 29}, [900.0])
        self.assertEqual(codigo, 0)

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

    def test_piso_cero_sigue_evaluando_p95(self) -> None:
        codigo, lineas = decidir_canary(6, 0, {'2xx': 6}, [1408.0])
        self.assertEqual(codigo, 1)
        self.assertIn('p95', '\n'.join(lineas))

    def test_piso_cero_sin_requests_promueve(self) -> None:
        codigo, lineas = decidir_canary(0, 0, {}, [])
        self.assertEqual(codigo, 0)
        self.assertIn('min_requests=0', lineas[0])

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
        self.assertNotIn('Promoviendo', '\n'.join(lineas))

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
        inicio = texto.index('from canary_verify_decision import decidir_canary')
        fin = texto.index('PYCHECK', inicio)
        bloque = texto[inicio:fin]
        self.assertNotIn('$', bloque)

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
        self.assertEqual(sin_url[0], 0)
        self.assertIn('WARN', sin_url[1][0])

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
