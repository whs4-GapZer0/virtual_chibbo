from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from chibbo_evidence import registers

ROOT = Path(__file__).resolve().parents[3] / "governance"


class RegistersTest(unittest.TestCase):
    def copy(self) -> Path:
        directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, directory)
        shutil.copytree(ROOT, directory / "governance")
        return directory / "governance"

    def edit(self, path: Path, change) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        change(payload)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_rejects_a_vulnerability_level_without_its_reference(self) -> None:
        root = self.copy()
        self.edit(root / "assets.json", lambda p: p["assets"][0].update(vulnerability_level="high", vulnerability_ref=""))
        with self.assertRaisesRegex(registers.RegisterError, "A-01"):
            registers.load(root)

    def test_rejects_duplicate_cti_and_unknown_supplier_status(self) -> None:
        root = self.copy()
        item = {"cti_id": "CTI-1", "source_ref": "feed", "approved_by": "a", "valid_from": "2026-10-01T00:00:00+09:00",
                "expires_at": "2026-12-01T00:00:00+09:00", "indicator_ref": "ioc", "threat_level": "high"}
        self.edit(root / "tvm" / "cti.json", lambda p: p.update(items=[item, item]))
        with self.assertRaisesRegex(registers.RegisterError, "중복"):
            registers.load(root)
        root = self.copy()
        self.edit(root / "suppliers.json", lambda p: p["suppliers"][0].update(status="pending"))
        with self.assertRaisesRegex(registers.RegisterError, "approved"):
            registers.load(root)

    def test_deploy_workflows_must_name_a_registered_asset(self) -> None:
        root = self.copy()
        self.edit(root / "assets.json", lambda p: p["deploy_workflows"].update({".github/workflows/x.yml": "A-99"}))
        with self.assertRaisesRegex(registers.RegisterError, "deploy_workflows"):
            registers.load(root)

    def test_cli_reports_counts(self) -> None:
        self.assertEqual(registers.main([str(ROOT)]), 0)


if __name__ == "__main__":
    unittest.main()
