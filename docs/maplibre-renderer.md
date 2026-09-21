# MapLibre renderer

The corridor map uses a reviewed, self-hosted MapLibre GL JS distribution. The
dashboard does not fetch renderer code from a CDN, so loading the renderer does
not introduce a runtime dependency on a package host.

## Pinned distribution

- Version: `6.10.0`
- License: BSD 3-Clause
- Local directory:
  `api-service/src/main/resources/static/vendor/maplibre-gl/6.10.0/`
- Upstream release: <https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.10.0>

| Local file | SHA-256 |
| --- | --- |
| `LICENSE.txt` | `ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2` |
| `maplibre-gl.css` | `8e2dbbab312dc57656fbb76e9fa5308c75c9d7c7ba5808a7d55bcdb64cc813fa` |
| `maplibre-gl.mjs` | `454e0bbb16c721cfbf952a92ff3e4362130346ed59a5bff56ae5d6fbebb651f7` |
| `maplibre-gl-shared.mjs` | `0996a0ff2ecb2807afc3f053992539ff7fe45c1678a02304b2b33120136f81f3` |
| `maplibre-gl-worker.mjs` | `7d5ebf88ec25a72cc48cc320d374f41d921e5105d2f1fc774d463a4b68164227` |

The module files came from the matching `unpkg.com/maplibre-gl@6.10.0/dist/`
paths. The license came from the tagged upstream repository. MapLibre 6 uses
ES modules, and the main module resolves the checked-in shared and worker
modules from this same directory.

## Updating the renderer

Treat an update as a dependency change rather than replacing these files in an
unrelated dashboard branch.

1. Read the target release notes and migration guide.
2. Download the CSS, main module, shared module, worker module, and license from
   the same tagged release.
3. Put the new release in its own versioned directory; do not overwrite the
   prior directory while a deployed page still references it.
4. Record and compare SHA-256 hashes, then update the dashboard import paths and
   this document in the same pull request.
5. Run the dashboard tests and verify map rendering, worker loading, and the
   no-WebGL fallback in a packaged application.

The application-owned directory makes rollback an import-path change and keeps
the exact reviewed assets available with the revision that uses them.
