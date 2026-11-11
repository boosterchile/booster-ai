"""Tests de route_to_commit_revision.sh con un gcloud falso en el PATH.

El gcloud falso responde desde variables de entorno y anota cada llamada en
un archivo, para comprobar qué se le pidió a Cloud Run.
"""

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("route_to_commit_revision.sh")
SHA = "c6f113d8ae6e0000000000000000000000000000"

FAKE_GCLOUD = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  *"services describe"*latestCreatedRevisionName*) echo "$FAKE_CREATED" ;;
  *"revisions describe"*) echo "$FAKE_IMAGE" ;;
  *"update-traffic"*) exit "${FAKE_TRAFFIC_EXIT:-0}" ;;
  *"services describe"*status.traffic*) echo "$FAKE_SERVED" ;;
  *) echo "llamada inesperada: $*" >&2; exit 99 ;;
esac
"""


class RouteToCommitRevisionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        fake = Path(self.tmp.name) / "gcloud"
        fake.write_text(FAKE_GCLOUD)
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.log = Path(self.tmp.name) / "calls.log"
        self.log.write_text("")

    def run_script(self, *, created, image, served, traffic_exit="0", args=None):
        env = {
            **os.environ,
            "PATH": f"{self.tmp.name}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_CREATED": created,
            "FAKE_IMAGE": image,
            "FAKE_SERVED": served,
            "FAKE_TRAFFIC_EXIT": traffic_exit,
        }
        if args is None:
            args = ["booster-ai-web", "southamerica-west1", SHA]
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def calls(self):
        return self.log.read_text()

    def test_enruta_a_la_revision_del_commit(self):
        result = self.run_script(
            created="booster-ai-web-00418-m7c",
            image=f"registry/web:{SHA}",
            served="booster-ai-web-00418-m7c",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--to-revisions=booster-ai-web-00418-m7c=100", self.calls())
        self.assertNotIn("--to-latest", self.calls())

    def test_falla_sin_mover_trafico_si_la_revision_es_de_otro_commit(self):
        result = self.run_script(
            created="booster-ai-web-00417-jgp",
            image="registry/web:8d7121b28777015443093eac635d6bdc26ea17fe",
            served="booster-ai-web-00416-9tj",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no la imagen del commit", result.stderr)
        self.assertNotIn("update-traffic", self.calls())

    def test_falla_si_el_servicio_termina_sirviendo_otra_revision(self):
        result = self.run_script(
            created="booster-ai-web-00418-m7c",
            image=f"registry/web:{SHA}",
            served="booster-ai-web-00416-9tj",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("debía servir booster-ai-web-00418-m7c", result.stderr)

    def test_falla_si_update_traffic_falla(self):
        result = self.run_script(
            created="booster-ai-web-00418-m7c",
            image=f"registry/web:{SHA}",
            served="booster-ai-web-00418-m7c",
            traffic_exit="1",
        )
        self.assertNotEqual(result.returncode, 0)

    def test_falla_si_no_hay_revision_creada(self):
        result = self.run_script(created="", image="", served="")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("update-traffic", self.calls())

    def test_exige_tres_argumentos(self):
        result = self.run_script(
            created="x", image="x", served="x", args=["booster-ai-web"]
        )
        self.assertEqual(result.returncode, 64)


if __name__ == "__main__":
    unittest.main()
