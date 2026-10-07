"""Validate complementary API PIT shards and enforce the full-module score."""

import argparse
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from fnmatch import fnmatchcase
import hashlib
import json
import os
from pathlib import Path
import xml.etree.ElementTree as ET


NAMESPACE = {"m": "http://maven.apache.org/POM/4.0.0"}
SHARDS = ("web", "support")
DETECTED = {"KILLED", "TIMED_OUT", "NON_VIABLE", "MEMORY_ERROR", "EQUIVALENT"}
COMPLETED = DETECTED | {"SURVIVED", "NO_COVERAGE"}


def configuration(pom, profile):
    element = pom.find(
        f"m:profiles/m:profile[m:id='{profile}']/m:build/m:plugins/"
        "m:plugin[m:artifactId='pitest-maven']/m:configuration", NAMESPACE,
    )
    if element is None:
        raise ValueError(f"Missing PIT profile: {profile}")
    return element


def patterns(config, tag):
    return [item.text for item in config.findall(f"m:{tag}/m:param", NAMESPACE)]


def matches(name, targets, excluded):
    return any(fnmatchcase(name, pattern) for pattern in targets) and not any(
        fnmatchcase(name, pattern) for pattern in excluded
    )


def settings(pom_path):
    pom = ET.parse(pom_path).getroot()
    base = configuration(pom, "mutation")
    targets, excluded = patterns(base, "targetClasses"), patterns(base, "excludedClasses")
    threshold = Decimal(base.findtext("m:mutationThreshold", namespaces=NAMESPACE))
    if not targets or not 0 < threshold <= 100:
        raise ValueError("Full API scope and mutation threshold must be configured")
    if base.findtext("m:thresholdPrecision", "0", NAMESPACE) != "0":
        raise ValueError("Update aggregation rounding when changing PIT threshold precision")
    shards = {}
    for shard in SHARDS:
        config = configuration(pom, f"mutation-api-{shard}")
        allowed = {"targetClasses", "excludedClasses", "mutationThreshold"}
        if any(item.tag.rsplit("}", 1)[-1] not in allowed for item in config):
            raise ValueError("Shards must inherit tests, operators and coverage settings")
        if config.findtext("m:mutationThreshold", namespaces=NAMESPACE) != "0":
            raise ValueError("Shard mutation thresholds must be delegated to aggregation")
        shards[shard] = (
            patterns(config, "targetClasses") or targets,
            patterns(config, "excludedClasses") or excluded,
        )
    return targets, excluded, shards, threshold


def owners(name, shards):
    return [shard for shard, scope in shards.items() if matches(name, *scope)]


def bytecode_files(root):
    target = root / "api-service/target"
    files = {}
    for directory in ("classes", "test-classes"):
        paths = sorted((target / directory).rglob("*"))
        if not any(path.is_file() and path.suffix == ".class" for path in paths):
            raise ValueError(f"Compiled API {directory} are required")
        for path in paths:
            if path.is_file():
                files[path.relative_to(target).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return files


def verified_bytecode(root, write=False):
    target = root / "api-service/target/verified-api.json"
    current = {"revision": os.environ.get("GITHUB_SHA"), "files": bytecode_files(root)}
    if write:
        target.write_text(json.dumps(current, indent=2) + "\n")
    elif json.loads(target.read_text()) != current:
        raise ValueError("API bytecode or revision differs from the successful Maven build")


def write_manifest(root, shard, report):
    targets, excluded, shards, _ = settings(root / "api-service/pom.xml")
    classes = {}
    compiled = root / "api-service/target/classes"
    for path in sorted(compiled.rglob("*.class")):
        name = ".".join(path.relative_to(compiled).with_suffix("").parts)
        if matches(name, targets, excluded):
            if len(owners(name, shards)) != 1:
                raise ValueError(f"API class must belong to exactly one shard: {name}")
            classes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if not classes or not (report / "mutations.xml").is_file():
        raise ValueError("Compiled API classes and PIT report are required")
    (report / "shard.json").write_text(
        json.dumps({"shard": shard, "classes": classes}, indent=2) + "\n"
    )


def aggregate(root, reports):
    targets, excluded, shards, threshold = settings(root / "api-service/pom.xml")
    manifests = {}
    for path in reports.rglob("shard.json"):
        manifest = json.loads(path.read_text())
        shard = manifest["shard"]
        if shard not in SHARDS or shard in manifests:
            raise ValueError(f"Unexpected or duplicate shard: {shard}")
        manifests[shard] = (manifest["classes"], path.parent)
    if set(manifests) != set(SHARDS):
        raise ValueError("Both API mutation shards are required")
    classes = manifests[SHARDS[0]][0]
    if not classes or any(manifest[0] != classes for manifest in manifests.values()):
        raise ValueError("Shards must contain identical compiled API class manifests")
    for name in classes:
        if not matches(name, targets, excluded) or len(owners(name, shards)) != 1:
            raise ValueError(f"Invalid API partition: {name}")
    identities, statuses = set(), Counter()
    for shard, (_, report) in manifests.items():
        document = ET.parse(report / "mutations.xml").getroot()
        if document.tag != "mutations" or not len(document):
            raise ValueError(f"Missing mutation results in {shard}")
        for mutation in document:
            name = mutation.findtext("mutatedClass")
            if name not in classes or owners(name, shards) != [shard]:
                raise ValueError(f"Mutation outside shard scope: {name}")
            fields = [mutation.findtext(tag) for tag in (
                "mutatedClass", "mutatedMethod", "methodDescription", "mutator",
            )]
            indexes = tuple(item.text for item in mutation.findall("indexes/index"))
            if not all(fields) or not indexes or not all(indexes):
                raise ValueError("Incomplete mutation identity")
            identity = (*fields, indexes)
            if identity in identities:
                raise ValueError(f"Duplicate mutation: {identity}")
            identities.add(identity)
            status = mutation.get("status")
            if status not in COMPLETED:
                raise ValueError(f"Incomplete or erroneous mutation result: {status}")
            if mutation.get("detected") != str(status in DETECTED).lower():
                raise ValueError("Mutation detection flag disagrees with its status")
            statuses[status] += 1
    total = sum(statuses.values())
    detected = sum(statuses[status] for status in DETECTED)
    score = (Decimal(100) * detected / total).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    if detected < total:
        score = min(score, Decimal(99))
    summary = f"API PIT: {detected}/{total} detected ({score}%); required {threshold}%."
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(summary + "\n")
    if score < threshold:
        raise ValueError("Combined API mutation score is below the existing threshold")
    return total, detected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    manifest = commands.add_parser("manifest")
    manifest.add_argument("shard", choices=SHARDS)
    manifest.add_argument("report", type=Path)
    combined = commands.add_parser("aggregate")
    combined.add_argument("reports", type=Path)
    commands.add_parser("record-bytecode")
    commands.add_parser("verify-bytecode")
    args = parser.parse_args()
    if args.command == "manifest":
        write_manifest(Path.cwd(), args.shard, args.report)
    elif args.command == "aggregate":
        aggregate(Path.cwd(), args.reports)
    else:
        verified_bytecode(Path.cwd(), write=args.command == "record-bytecode")
