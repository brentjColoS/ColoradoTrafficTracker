import json
from pathlib import Path
import subprocess
import unittest


FILTER = Path(__file__).with_name("docker-registry-cache.jq")
CACHE = "https://mirror.gcr.io"


class DockerRegistryCacheTest(unittest.TestCase):
    def configure(self, config):
        result = subprocess.run(
            ["jq", "-e", "-f", str(FILTER)], input=json.dumps(config),
            text=True, capture_output=True,
        )
        if result.returncode:
            raise ValueError(result.stderr)
        return json.loads(result.stdout)

    def test_empty_configuration_uses_public_cache(self):
        self.assertEqual(self.configure({}), {"registry-mirrors": [CACHE]})

    def test_existing_daemon_settings_survive(self):
        config = {"features": {"containerd-snapshotter": True}, "log-driver": "local"}
        result = self.configure(config)
        for key, value in config.items():
            self.assertEqual(result[key], value)

    def test_existing_mirrors_remain_ordered_fallbacks(self):
        mirrors = ["https://cache.example.invalid", "https://other.example.invalid"]
        self.assertEqual(self.configure({"registry-mirrors": mirrors})["registry-mirrors"],
                         [CACHE, *mirrors])

    def test_cache_moves_to_front_without_duplicates(self):
        config = {"registry-mirrors": ["https://other.example.invalid", CACHE, CACHE]}
        self.assertEqual(self.configure(config)["registry-mirrors"],
                         [CACHE, "https://other.example.invalid"])

    def test_repeated_configuration_is_idempotent(self):
        config = self.configure({"registry-mirrors": []})
        self.assertEqual(self.configure(config), config)

    def test_invalid_settings_fail_before_configuration_is_replaced(self):
        for config in [None, [], "invalid", {"registry-mirrors": None},
                       {"registry-mirrors": "https://example.invalid"},
                       {"registry-mirrors": [None]}, {"registry-mirrors": [""]}]:
            with self.subTest(config=config), self.assertRaises(ValueError):
                self.configure(config)

    def test_empty_or_malformed_json_cannot_be_installed(self):
        for raw in ["", "{invalid"]:
            with self.subTest(raw=raw):
                result = subprocess.run(["jq", "-e", "-f", str(FILTER)], input=raw,
                                        text=True, capture_output=True)
                self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
