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
