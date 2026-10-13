# Road Sign Display

The dashboard hero sign is implemented as a standalone `<road-sign-display>` web component in `api-service/src/main/resources/static/dashboard/road-sign-display.js`.

The dashboard owns placement only:

```html
<road-sign-display id="heroRoadSign" corridor="I25"></road-sign-display>
```

The component owns:
- The base sign PNG image.
- The masked reflective sheet layer.
- The masked chroma sheen layer.
- The masked swap cover used while changing corridors.
- Pointer-driven reflection variables.
- Corridor-specific image selection.
- Image preloading and transition timing.

Current corridor assets:

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
