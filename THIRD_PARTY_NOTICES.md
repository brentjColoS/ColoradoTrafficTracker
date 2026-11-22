# Third-Party Notices

## Portfolio graphics and fonts

The README and wiki graphics reuse the website's project-owned mountain mark.
They embed the bundled Archivo and IBM Plex Mono fonts. Their SIL Open Font
License notices are retained in
[`operations/visitor-analytics/web/fonts/Archivo-OFL.txt`](operations/visitor-analytics/web/fonts/Archivo-OFL.txt)
and [`IBMPlexMono-OFL.txt`](operations/visitor-analytics/web/fonts/IBMPlexMono-OFL.txt).

`operations/portfolio/assets/corridor-base.webp` is a reviewed, cropped capture
of the About the Data basemap with its moving bubbles hidden. Its capture date,
geographic bounds and corridor geometry are recorded in `map-base.json` beside
it. Animated bubbles and the shared graphic framing are generated separately.

Map data: © OpenStreetMap contributors, SRTM, GEBCO, SONNY's LiDAR DTM, NASADEM,
ESA WorldCover; Maps © Tracestrack. Tracestrack provides its maps under
[CC BY 4.0](https://tracestrack.com/terms-of-service/). Keep attribution with
exported images. The displayed background is geographic context, not live
satellite imagery or a traffic measurement.

Traffic observations retain their source terms. The repository's software
license does not relicense TomTom or CDOT data.

## Technology logos

The technology-stack graphics embed original-color Java, Spring, PostgreSQL,
Flyway, JavaScript, JUnit, Playwright, Maven, GitHub Actions and Docker logos from
[Devicon](https://github.com/devicons/devicon/tree/32fe1d3b3f36ad11f90ab94f7db59738139c2bf6),
at revision `32fe1d3b3f36ad11f90ab94f7db59738139c2bf6`.

The HTML5 mark from the same Devicon revision identifies the HTML Canvas API.
Timescale, MapLibre, Spring Boot and Caddy marks come from
[Simple Icons](https://github.com/simple-icons/simple-icons/tree/549ca1d13f2a864889439f6242452c6b4f6514af)
at revision `549ca1d13f2a864889439f6242452c6b4f6514af`, under
[CC0-1.0](docs/assets/tool-logos/SIMPLE-ICONS-LICENSE.md). Their catalog brand
colors are applied to the monochrome source paths.

The PIT bird logo was created by Ling Yeung and comes from the
[PIT website source](https://github.com/hcoles/pitest-site/blob/614bec6fd16670852e94c8cc03a002f6bf05db09/images/pitest.svg).
The [PIT website](https://pitest.org/about/) identifies its author and carries
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The bird's
geometry is unchanged; its original viewport is normalized for proportional
scaling inside the badge. Its license is separate from the repository's MIT
software license.

Original SVGs, the upstream [Devicon MIT license](docs/assets/tool-logos/LICENSE) and
per-file [source records](docs/assets/tool-logos/sources.json) are retained under
`docs/assets/tool-logos/`. Generated technology SVGs also include the license in
their metadata. Logos retain their source geometry; the circular
backgrounds and surrounding layout are project artwork. Product names and
marks belong to their respective owners and identify the tools used by CTT.

## Lucide Icons

The dashboard includes adapted inline SVG paths from [Lucide](https://lucide.dev/):
Gauge, Clock 3, Triangle Alert, Map Pin, Heart Pulse, Database Plus, Database
Check, CCTV, Server Cog, Code XML, Monitor Check, Arrow Right,
Construction, Circle Minus, Car Front, Circle Question Mark, Moon, Sun, Mouse,
Arrow Up Down, and Arrow Left Right.

Incident icons use Triangle Alert, Construction, Circle Minus, Car Front, Sun,
Snowflake, Thermometer Snowflake, Stone, Cloud Fog, Wind, Waves Arrow Up,
Mountain Snow, Flame, Car, Paw Print, Wrench, Cloud, Octagon Alert, and Circle
Question Mark from the [official Lucide source at revision
c29c276f16590cf017126671535ad8c792be64d8](https://github.com/lucide-icons/lucide/tree/c29c276f16590cf017126671535ad8c792be64d8/icons).
Circles and rounded rectangles are converted to equivalent SVG paths so the
same geometry can render in HTML and canvas charts. No Lucide runtime or
external icon requests are required.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Some Lucide icons are derived from Feather and are provided under the MIT
License:

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
