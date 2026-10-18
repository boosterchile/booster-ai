"""Decision del gate canary-verify. Stdlib, sin red."""

from __future__ import annotations

import unittest
from pathlib import Path

from canary_verify_decision import decidir_canary

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

    def test_yaml_mantiene_el_piso_y_delega_la_decision(self) -> None:
        texto = CLOUDBUILD.read_text(encoding='utf-8')
        self.assertIn("_CANARY_MIN_REQUESTS: '30'", texto)
        self.assertNotIn('FAIL muestra insuficiente', texto)
        self.assertIn('decidir_canary', texto)
        inicio = texto.index('from canary_verify_decision import decidir_canary')
        fin = texto.index('PYCHECK', inicio)
        bloque = texto[inicio:fin]
        self.assertNotIn('$', bloque)


if __name__ == '__main__':
    unittest.main()
