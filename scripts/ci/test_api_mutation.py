import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from api_mutation import aggregate, settings, verified_bytecode, write_manifest


POM = Path(__file__).resolve().parents[2] / "api-service/pom.xml"
WEB = "com.example.api_service.TrafficController"
SUPPORT = "com.example.api_service.NewSupportService"


class ApiMutationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "api-service").mkdir()
        shutil.copyfile(POM, self.root / "api-service/pom.xml")
        self.reports = self.root / "reports"
        for shard, name in [("web", WEB), ("support", SUPPORT)]:
            report = self.reports / shard
            report.mkdir(parents=True)
            (report / "shard.json").write_text(json.dumps({
                "shard": shard, "classes": {WEB: "web-bytecode", SUPPORT: "support-bytecode"},
            }))
            self.results(shard, name, ["KILLED"])

    def results(self, shard, name, statuses):
        document = ET.Element("mutations")
        for index, status in enumerate(statuses):
            mutation = ET.SubElement(document, "mutation", status=status,
                                     detected=str(status in {"KILLED", "TIMED_OUT"}).lower())
            for key, value in [("mutatedClass", name), ("mutatedMethod", "method"),
                               ("methodDescription", "()V"), ("mutator", "test.Mutator")]:
                ET.SubElement(mutation, key).text = value
            ET.SubElement(ET.SubElement(mutation, "indexes"), "index").text = str(index)
        ET.ElementTree(document).write(self.reports / shard / "mutations.xml")

    def run_gate(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return aggregate(self.root, self.reports)

    def test_combines_counts_instead_of_averaging_shard_percentages(self):
        self.results("web", WEB, ["KILLED"] * 8)
        self.results("support", SUPPORT, ["SURVIVED"] * 2)
        self.assertEqual(self.run_gate(), (10, 8))

    def test_rejects_combined_score_below_existing_threshold(self):
        self.results("support", SUPPORT, ["SURVIVED"] * 2)
        with self.assertRaisesRegex(ValueError, "below"):
            self.run_gate()

    def test_uses_pit_integer_rounding_at_threshold_boundary(self):
        self.results("web", WEB, ["KILLED"] * 119)
        self.results("support", SUPPORT, ["SURVIVED"] * 81)
        self.assertEqual(self.run_gate(), (200, 119))
        self.results("support", SUPPORT, ["SURVIVED"] * 82)
        with self.assertRaisesRegex(ValueError, "below"):
            self.run_gate()

    def test_rejects_missing_duplicate_and_mismatched_shards(self):
        path = self.reports / "support/shard.json"
        original = path.read_text()
        path.unlink()
        with self.assertRaisesRegex(ValueError, "Both"):
            self.run_gate()
        path.write_text(original)
        extra = self.reports / "extra"
        extra.mkdir()
        shutil.copyfile(path, extra / "shard.json")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.run_gate()
        shutil.rmtree(extra)
        data = json.loads(original)
        data["classes"][WEB] = "different-bytecode"
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "identical"):
            self.run_gate()

    def test_does_not_round_a_surviving_mutation_up_to_perfect_score(self):
        pom = self.root / "api-service/pom.xml"
        pom.write_text(pom.read_text().replace(
            "<mutationThreshold>60</mutationThreshold>",
            "<mutationThreshold>100</mutationThreshold>",
        ))
        self.results("web", WEB, ["KILLED"] * 199)
        self.results("support", SUPPORT, ["SURVIVED"])
        with self.assertRaisesRegex(ValueError, "below"):
            self.run_gate()

    def test_rejects_mutations_in_wrong_shard_and_duplicate_identities(self):
        self.results("support", WEB, ["KILLED"])
        with self.assertRaisesRegex(ValueError, "outside"):
            self.run_gate()
        self.results("support", SUPPORT, ["KILLED"])
        path = self.reports / "web/mutations.xml"
        document = ET.parse(path)
        document.getroot().append(document.getroot()[0])
        document.write(path)
        with self.assertRaisesRegex(ValueError, "Duplicate mutation"):
            self.run_gate()

    def test_rejects_empty_malformed_and_incomplete_reports(self):
        path = self.reports / "web/mutations.xml"
        path.write_text("<mutations />")
        with self.assertRaisesRegex(ValueError, "Missing mutation"):
            self.run_gate()
        path.write_text("<mutations")
        with self.assertRaises(ET.ParseError):
            self.run_gate()
        self.results("web", WEB, ["KILLED"])
        document = ET.parse(path)
        document.getroot()[0].remove(document.getroot()[0].find("indexes"))
        document.write(path)
        with self.assertRaisesRegex(ValueError, "identity"):
            self.run_gate()

    def test_rejects_unfinished_errors_and_inconsistent_detection_flags(self):
        for status in ["NOT_STARTED", "STARTED", "RUN_ERROR", "UNKNOWN"]:
            with self.subTest(status=status):
                self.results("web", WEB, [status])
                with self.assertRaisesRegex(ValueError, "erroneous"):
                    self.run_gate()
        self.results("web", WEB, ["KILLED"])
        path = self.reports / "web/mutations.xml"
        document = ET.parse(path)
        document.getroot()[0].set("detected", "false")
        document.write(path)
        with self.assertRaisesRegex(ValueError, "flag"):
            self.run_gate()

    def test_counts_timeouts_as_detected_as_pit_does(self):
        self.results("web", WEB, ["TIMED_OUT"])
        self.assertEqual(self.run_gate(), (2, 2))

    def test_partitions_new_classes_and_inner_classes_without_scope_gaps(self):
        compiled = self.root / "api-service/target/classes"
        for name in [WEB, WEB + "$Nested", SUPPORT, "com.example.api_service.ApiApplication"]:
            path = compiled / (name.replace(".", "/") + ".class")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
        write_manifest(self.root, "web", self.reports / "web")
        data = json.loads((self.reports / "web/shard.json").read_text())
        self.assertEqual(set(data["classes"]), {WEB, WEB + "$Nested", SUPPORT})
        pom = self.root / "api-service/pom.xml"
        pom.write_text(pom.read_text().replace(
            "<param>com.example.api_service.TrafficController*</param>",
            "<param>com.example.api_service.TrafficController</param>", 1,
        ))
        with self.assertRaisesRegex(ValueError, "exactly one"):
            write_manifest(self.root, "web", self.reports / "web")

    def test_shards_cannot_override_tests_operators_or_coverage(self):
        pom = self.root / "api-service/pom.xml"
        pom.write_text(pom.read_text().replace(
            "<mutationThreshold>0</mutationThreshold>",
            "<mutationThreshold>0</mutationThreshold><coverageThreshold>0</coverageThreshold>", 1,
        ))
        with self.assertRaisesRegex(ValueError, "inherit"):
            settings(pom)

    def compiled_fixture(self):
        target = self.root / "api-service/target"
        for directory in ["classes", "test-classes"]:
            path = target / directory
            path.mkdir(parents=True)
            (path / "Compiled.class").write_bytes(b"compiled")
        return target

    def test_verified_artifact_rejects_changed_missing_and_extra_files(self):
        target = self.compiled_fixture()
        verified_bytecode(self.root, write=True)
        verified_bytecode(self.root)
        compiled = target / "test-classes/Compiled.class"
        compiled.write_bytes(b"different compiled tests")
        with self.assertRaisesRegex(ValueError, "differs"):
            verified_bytecode(self.root)
        compiled.write_bytes(b"compiled")
        resource = target / "classes/application.yml"
        resource.write_text("changed configuration")
        with self.assertRaisesRegex(ValueError, "differs"):
            verified_bytecode(self.root)
        resource.unlink()
        compiled.unlink()
        with self.assertRaisesRegex(ValueError, "required"):
            verified_bytecode(self.root)

    def test_verified_artifact_requires_manifest_from_successful_build(self):
        self.compiled_fixture()
        with self.assertRaises(FileNotFoundError):
            verified_bytecode(self.root)

    def test_verified_artifact_rejects_another_revision(self):
        self.compiled_fixture()
        with patch.dict("os.environ", {"GITHUB_SHA": "first-revision"}):
            verified_bytecode(self.root, write=True)
        with patch.dict("os.environ", {"GITHUB_SHA": "another-revision"}):
            with self.assertRaisesRegex(ValueError, "revision"):
                verified_bytecode(self.root)


if __name__ == "__main__":
    unittest.main()
