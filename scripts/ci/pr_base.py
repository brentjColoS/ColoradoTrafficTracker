"""Resolve the base of the exact pull-request merge checkout under validation."""

import os
import re
import subprocess


def pull_request_base():
    merge = os.environ["GITHUB_SHA"]
    head = os.environ["PR_HEAD_SHA"]
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (merge, head)):
        raise ValueError("PR merge and head must be full commit SHAs")
    if not re.fullmatch(r"refs/pull/[0-9]+/merge", os.environ["GITHUB_REF"]):
        raise ValueError("PR guards require the pull-request merge checkout")
    actual = subprocess.run(
        ["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True,
    ).stdout.strip()
    if actual != merge:
        raise ValueError("Checked-out revision does not match the workflow merge")
    parents = subprocess.run(
        ["git", "show", "-s", "--format=%P", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    if len(parents) != 2 or parents[1] != head:
        raise ValueError("PR merge must have its base and the expected PR head as parents")
    base = parents[0]
    subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], check=True)
    return base
