# Road Sign Display

The primary dashboard now uses two compact route-sign summaries so I-25 and I-70 remain visible together. Each summary pairs a corridor-specific exit range with an Interstate shield and the route name without introducing a dashboard-level direction selector.

Runtime shield assets:

| Corridor | Shield asset | Dashboard exit range |
| --- | --- | --- |
| I-25 Front Range | `interstate-25.svg` | 208–271 |
| I-70 Mountain Corridor | `interstate-70.svg` | 206–259 |

The signs sit inside the two corridor metric ribbons rather than occupying a separate hero section. This keeps the full speed, delay, incident, worst-segment, chart, system, and architecture views visible at desktop scale.

The earlier full-size sign remains available as a standalone `<road-sign-display>` web component in `api-service/src/main/resources/static/dashboard/road-sign-display.js`, but is not mounted by the primary dashboard.

The component owns:
- The base sign PNG image.
- The masked reflective sheet layer.
- The masked chroma sheen layer.
- The masked swap cover used while changing corridors.
- Pointer-driven reflection variables.
- Corridor-specific image selection.
- Image preloading and transition timing.

Legacy corridor assets:

| Corridor | Runtime asset | Source asset |
| --- | --- | --- |
| I-25 | `road-sign-i25.png?v=sign-raster-5` | `I-25.svg` |
| I-70 | `road-sign-i70.png?v=sign-raster-5` | `I-70.svg` |

The runtime PNGs use a shared transparent `2240x896` canvas and matching sign bounds, so corridor changes do not shift the component layout or visual size. They were rasterized from the original SVG exports to avoid cross-browser `foreignObject` sizing differences while keeping the same sign artwork, colors, lettering, and alpha mask for the reflective overlays.

The PNG alpha channel should stay transparent outside the rounded sign body. The current assets use a cleaned rounded-rectangle alpha mask to avoid opaque antialiasing from the one-time white render background appearing as squared-off corner artifacts.

The I-70 asset uses the I-25 sign body template with unscaled I-70-specific labels and shield artwork pasted into it. That keeps the template, body size, and typography scale aligned while allowing only the exit number, shield number, and directions to differ. The I-70 shield is shifted slightly within the raster asset so it visually aligns with the direction divider below it; keep a generous shield extraction mask so its right edge is not clipped.

## Asset Optimization Notes

The sign SVGs are exported as `foreignObject` documents with embedded fonts and extensive inline style data. Generic SVGO passes were tested before merge cleanup, including default multipass optimization and a safer configuration with style minification disabled. Both variants reduced file size but caused the signs to render blank in the packaged dashboard.

Keep the SVG sources intact as the authoritative artwork. Regenerate the PNGs from those sources when the sign design changes, then verify the running dashboard in Chromium and WebKit/Safari. For this component, a visually correct sign is more important than a partial size reduction that risks breaking the `foreignObject` render path.

## Dashboard Accessibility Notes

The primary dashboard does not rely on color alone. Current and baseline chart lines also differ by stroke pattern, incident types use distinct symbols and text labels, ongoing incidents include a written status pill, and system health is expressed in text. All controls expose visible keyboard focus, semantic labels, and pressed or selected states.
