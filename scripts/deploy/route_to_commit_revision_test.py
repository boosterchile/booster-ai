"""Tests de route_to_commit_revision.sh con un gcloud falso en el PATH.

El gcloud falso responde desde variables de entorno y anota cada llamada en
un archivo, para comprobar qué se le pidió a Cloud Run y a Artifact Registry.

Cloud Run informa la imagen de una revisión resuelta a su digest
(`<repositorio>@sha256:…`), aunque el deploy la haya pedido por tag. Así la
informó `booster-ai-web-00419-4bt` en el release de `b9f40f3a`.
"""

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("route_to_commit_revision.sh")
SHA = "c6f113d8ae6e0000000000000000000000000000"
OTRO_SHA = "8d7121b28777015443093eac635d6bdc26ea17fe"
REGISTRY = "southamerica-west1-docker.pkg.dev/booster-ai-494222/containers"
IMAGE_REF = f"{REGISTRY}/web:{SHA}"
DIGEST = "sha256:" + "1" * 64
OTRO_DIGEST = "sha256:" + "2" * 64

FAKE_GCLOUD = """#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  *"artifacts docker images describe"*image_summary.digest*)
    if [ "${FAKE_AR_EXIT:-0}" != "0" ]; then
      echo "ERROR: imagen no encontrada" >&2
      exit "$FAKE_AR_EXIT"
    fi
    echo "$FAKE_DIGEST"
    ;;
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

    def run_script(
        self,
        *,
        created="booster-ai-web-00419-4bt",
        image=f"{REGISTRY}/web@{DIGEST}",
        served="booster-ai-web-00419-4bt",
        digest=DIGEST,
        ar_exit="0",
        traffic_exit="0",
        args=None,
    ):
        env = {
            **os.environ,
            "PATH": f"{self.tmp.name}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "FAKE_CREATED": created,
            "FAKE_IMAGE": image,
            "FAKE_SERVED": served,
            "FAKE_DIGEST": digest,
            "FAKE_AR_EXIT": ar_exit,
            "FAKE_TRAFFIC_EXIT": traffic_exit,
        }
        if args is None:
            args = ["booster-ai-web", "southamerica-west1", SHA, IMAGE_REF]
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def calls(self):
        return self.log.read_text()

    def assert_no_movio_trafico(self):
        self.assertNotIn("update-traffic", self.calls())

    def test_enruta_si_la_revision_informa_el_digest_del_commit(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            f"artifacts docker images describe {IMAGE_REF}", self.calls()
        )
        self.assertIn("--to-revisions=booster-ai-web-00419-4bt=100", self.calls())
        self.assertNotIn("--to-latest", self.calls())

    def test_enruta_si_la_revision_informa_el_tag_del_commit(self):
        result = self.run_script(image=IMAGE_REF)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--to-revisions=booster-ai-web-00419-4bt=100", self.calls())

    def test_falla_sin_mover_trafico_si_el_digest_es_de_otra_imagen(self):
        result = self.run_script(image=f"{REGISTRY}/web@{OTRO_DIGEST}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no la imagen del commit", result.stderr)
        self.assert_no_movio_trafico()

    def test_falla_sin_mover_trafico_si_el_tag_es_de_otro_commit(self):
        result = self.run_script(image=f"{REGISTRY}/web:{OTRO_SHA}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no la imagen del commit", result.stderr)
        self.assert_no_movio_trafico()

    def test_falla_sin_mover_trafico_si_el_digest_es_de_otro_repositorio(self):
        result = self.run_script(image=f"{REGISTRY}/api@{DIGEST}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no la imagen del commit", result.stderr)
        self.assert_no_movio_trafico()

    def test_falla_sin_mover_trafico_si_artifact_registry_no_da_digest(self):
        result = self.run_script(digest="")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sin digest", result.stderr)
        self.assert_no_movio_trafico()

    def test_falla_sin_mover_trafico_si_el_digest_no_es_sha256(self):
        result = self.run_script(digest="latest")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sin digest", result.stderr)
        self.assert_no_movio_trafico()

    def test_falla_sin_mover_trafico_si_artifact_registry_falla(self):
        result = self.run_script(ar_exit="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sin digest", result.stderr)
        self.assert_no_movio_trafico()

    def test_falla_si_el_servicio_termina_sirviendo_otra_revision(self):
        result = self.run_script(served="booster-ai-web-00418-m7c")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("debía servir booster-ai-web-00419-4bt", result.stderr)

    def test_falla_si_update_traffic_falla(self):
        result = self.run_script(traffic_exit="1")
        self.assertNotEqual(result.returncode, 0)

    def test_falla_si_no_hay_revision_creada(self):
        result = self.run_script(created="", image="", served="")
        self.assertNotEqual(result.returncode, 0)
        self.assert_no_movio_trafico()

    def test_exige_cuatro_argumentos(self):
        result = self.run_script(
            args=["booster-ai-web", "southamerica-west1", SHA]
        )
        self.assertEqual(result.returncode, 64)
        self.assertEqual(self.calls(), "")

    def test_exige_que_el_tag_de_la_imagen_sea_el_commit(self):
        result = self.run_script(
            args=[
                "booster-ai-web",
                "southamerica-west1",
                SHA,
                f"{REGISTRY}/web:{OTRO_SHA}",
            ]
        )
        self.assertEqual(result.returncode, 64)
        self.assertEqual(self.calls(), "")


if __name__ == "__main__":
    unittest.main()
