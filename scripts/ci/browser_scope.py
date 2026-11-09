"""Omit browser execution only for recognized documentation-only PRs."""
import os
from pathlib import PurePosixPath
import subprocess

from pr_base import pull_request_base


def browser_required(paths):
    return any(not (path.startswith('docs/') or (
        '/' not in path and PurePosixPath(path).suffix == '.md')) for path in paths)


def required():
    if os.environ.get('GITHUB_EVENT_NAME') != 'pull_request':
        return True
    base = pull_request_base()
    result = subprocess.run(['git', 'diff', '--name-only', '--no-renames', '-z', base, 'HEAD'],
                            check=True, capture_output=True)
    return browser_required(path for path in result.stdout.decode('utf-8', errors='surrogateescape').split('\0') if path)


if __name__ == '__main__':
    value = required()
    print('required=' + str(value).lower())
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as output:
            output.write(f'\n## Browser scope\n\nBrowser and packaged API tests: {"required" if value else "omitted for documentation only"}.\n')
