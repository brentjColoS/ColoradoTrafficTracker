# Road Sign Display

The dashboard hero sign is implemented as a standalone `<road-sign-display>` web component in `api-service/src/main/resources/static/dashboard/road-sign-display.js`.

The dashboard owns placement only:

```html
<road-sign-display id="heroRoadSign" corridor="I25"></road-sign-display>
```

The component owns:
- The base sign SVG image.
- The masked reflective sheet layer.
- The masked chroma sheen layer.
- The masked swap cover used while changing corridors.
- Pointer-driven reflection variables.
- Corridor-specific image calibration.
- SVG preloading and transition timing.

Current corridor calibration:

| Corridor | Asset | X offset | X scale | Y scale |
| --- | --- | ---: | ---: | ---: |
| I-25 | `I-25.svg?v=sign-normalized-1` | `0%` | `1.34` | `1.34` |
| I-70 | `I-70.svg?v=sign-normalized-1` | `5.3%` | `1.47` | `1.34` |

The I-70 SVG has a normalized `980x480` viewport, but the browser render path still needs the component calibration above to visually align with I-25.

## Asset Optimization Notes

The sign SVGs are exported as `foreignObject` documents with embedded fonts and extensive inline style data. Generic SVGO passes were tested before merge cleanup, including default multipass optimization and a safer configuration with style minification disabled. Both variants reduced file size but caused the signs to render blank in the packaged dashboard.

Keep the current SVG sources intact unless replacement assets are visually re-authored or an optimizer configuration is proven against the running dashboard. For this component, a visually correct sign is more important than a partial size reduction that risks breaking the `foreignObject` render path.
