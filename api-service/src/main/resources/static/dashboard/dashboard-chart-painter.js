(() => {
  function create({
    sizeCanvas,
    chartEndTime,
    state,
    chartSeries,
    drawEmptyChart,
    chartHistoryEmptyMessage,
    chartColors,
    chartAxis,
    CORRIDOR_CONFIG,
    hasLiveChartEdge,
    chartHistory,
    historyWindowKey,
    zoneFinderActive,
    finiteNumber,
    formatMetricNumber,
    HISTORICAL_MODE,
    REPLAY_MODE,
    dateMillis,
    displayTimeFormatter,
    Path2D,
    types,
  }) {
    function drawCorridorChart(canvas, corridor, routeData, frame = null) {
      canvas.closest?.(".chart-lane")?.style.removeProperty("--chart-height");
      const dimensions = sizeCanvas(canvas);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      const endTime = frame?.end ?? chartEndTime(routeData);
      const hours = frame?.hours ?? state.selectedHours;
      const startTime = endTime - hours * 3_600_000;
      const detailedSamples = state.selectedHours <= 24 ? routeData?.history?.samples || [] : [];
      const samples = frame?.samples || chartSeries.buildCurrentSpeedSeries(routeData?.trend?.buckets || [], detailedSamples, hours, endTime);
      const trendSamples = frame?.trendSamples || chartSeries.buildSmoothedSpeedSeries(samples, state.selectedHours);
      const baselineSeries = frame?.baseline || chartSeries.buildBaselineSeries(
        routeData?.trend?.buckets || [],
        startTime,
        endTime,
        routeData?.baseline?.profiles || []
      );
      if (samples.length === 0 && baselineSeries.length === 0) {
        drawEmptyChart(context, dimensions, chartHistoryEmptyMessage("No retained speed data in this time window.", corridor));
        return;
      }

      const colors = chartColors();
      const padding = { top: 34, right: 5, bottom: 30, left: 34 };
      const plotWidth = dimensions.width - padding.left - padding.right;
      const plotHeight = dimensions.height - padding.top - padding.bottom;
      const timeSpan = Math.max(1, endTime - startTime);
      const domain = frame?.domain ?? chartSeries.calculateCorridorSpeedDomain(samples, baselineSeries);
      const toPoint = point => ({
        ...point,
        horizontalPosition: padding.left + ((point.timestamp - startTime) / timeSpan) * plotWidth,
        verticalPosition: speedToVertical(point.speed, padding.top, plotHeight, domain)
      });
      const currentPoints = samples.map(toPoint);
      const trendPoints = trendSamples.map(toPoint);
      const baselinePoints = baselineSeries.map(toPoint);
      const axisTicks = chartAxis.buildTimeAxisTicks(startTime, endTime, plotWidth, frame ? state.selectedHours : null);

      drawGrid(context, padding, plotWidth, plotHeight, colors, domain);
      drawNormalBand(context, baselinePoints, padding.top, plotHeight, colors, domain);
      drawTimeGuides(context, axisTicks, padding.left, padding.top, dimensions.height - padding.bottom, colors);
      drawSmoothLine(context, baselinePoints, colors.ink, 2, [6, 6]);
      drawSmoothLine(context, trendPoints, colors[CORRIDOR_CONFIG[corridor].currentColorVariable], 2.8, []);
      drawPointMarkers(context, baselinePoints, colors.ink, true, 0.78);
      drawPointMarkers(context, currentPoints, colors[CORRIDOR_CONFIG[corridor].currentColorVariable], false);
      drawXAxis(context, axisTicks, dimensions, padding, colors, !frame && hasLiveChartEdge(routeData));
      drawIncidentFlags(context, corridor, routeData?.incidentThreads || [], currentPoints, startTime, endTime, padding, colors);
      if (!frame) drawLiveEdge(context, routeData, dimensions, padding, colors);
    }

    function drawZoneChart(canvas, corridor, routeData, frame = null) {
      const endTime = frame?.end ?? chartEndTime(routeData);
      const hours = frame?.hours ?? state.selectedHours;
      const groups = frame?.groups || chartSeries.groupZoneSeries(
        routeData?.zones || [],
        hours,
        endTime,
        routeData?.zoneBaseline?.zones || []
      );
      const lane = canvas.closest?.(".chart-lane");
      const pendingHistory = !frame && chartHistory.endTime !== null && chartHistory.dataKey !== historyWindowKey();
      if (!pendingHistory) lane?.style.setProperty("--chart-height", `${Math.max(280, groups.length * 124 + 36)}px`);
      const dimensions = sizeCanvas(canvas);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      if (groups.length === 0) {
        drawEmptyChart(context, dimensions, chartHistoryEmptyMessage("No retained speed-zone observations in this time window.", corridor));
        return;
      }

      const colors = chartColors();
      const startTime = endTime - hours * 3_600_000;
      const padding = { top: 6, right: 5, bottom: 30, left: zoneFinderActive() ? 112 : 92 };
      const plotWidth = dimensions.width - padding.left - padding.right;
      const contentHeight = dimensions.height - padding.top - padding.bottom;
      const rowHeight = contentHeight / groups.length;
      const color = colors[CORRIDOR_CONFIG[corridor].currentColorVariable];
      const axisTicks = chartAxis.buildTimeAxisTicks(startTime, endTime, plotWidth, frame ? state.selectedHours : null);
      const incidentsByZone = chartSeries.assignIncidentsToZoneGroups(groups, routeData?.incidentThreads || []);

      drawTimeGuides(context, axisTicks, padding.left, padding.top, dimensions.height - padding.bottom, colors);
      groups.forEach((group, index) => {
        const rowTop = padding.top + index * rowHeight;
        const plotTop = rowTop + 8;
        const plotHeight = Math.max(42, rowHeight - 16);
        const baselineSeries = frame?.baselines?.get(group.key) || chartSeries.buildBaselineSeries([], startTime, endTime, group.baselineProfiles);
        const domain = frame?.domains?.get(group.key) ?? chartSeries.calculateZoneSpeedDomain(group, baselineSeries);
        const toPoint = sample => ({
          ...sample,
          horizontalPosition: padding.left + ((sample.timestamp - startTime) / Math.max(1, endTime - startTime)) * plotWidth,
          verticalPosition: speedToVertical(sample.speed, plotTop, plotHeight, domain)
        });
        const points = group.samples.map(toPoint);
        const trendPoints = (frame?.trends?.get(group.key) || chartSeries.buildSmoothedSpeedSeries(group.samples, state.selectedHours)).map(toPoint);
        const baselinePoints = baselineSeries.map(toPoint);
        drawZoneRowGrid(context, padding.left, plotWidth, plotTop, plotHeight, colors, domain);
        drawNormalBand(context, baselinePoints, plotTop, plotHeight, colors, domain);
        drawSpeedLimitGuide(context, group.postedSpeedMph, padding.left, plotWidth, plotTop, plotHeight, colors, domain);
        drawSmoothLine(context, baselinePoints, colors.ink, 1.6, [6, 6]);
        drawSmoothLine(context, trendPoints, color, 2.2, []);
        drawPointMarkers(context, baselinePoints, colors.ink, true, 0.62);
        drawPointMarkers(context, points, color, false);
        drawIncidentFlags(
          context,
          corridor,
          incidentsByZone.get(group.key) || [],
          points,
          startTime,
          endTime,
          padding,
          colors,
          { plotTop, plotBottom: plotTop + plotHeight, avoidSeries: [points, trendPoints, baselinePoints], maximum: 2 }
        );
        drawSpeedZoneDescriptor(context, group, baselineSeries, plotTop, plotHeight, colors, padding.left);
        if (index < groups.length - 1) {
          context.save();
          context.strokeStyle = colors.gridStrong;
          context.lineWidth = 1.25;
          context.setLineDash([]);
          context.beginPath();
          context.moveTo(0, rowTop + rowHeight);
          context.lineTo(dimensions.width, rowTop + rowHeight);
          context.stroke();
          context.restore();
        }
      });
      if (!frame) drawSelectedZoneOutline(context, groups, dimensions);
      drawXAxis(context, axisTicks, dimensions, padding, colors, !frame && hasLiveChartEdge(routeData));
      if (!frame) drawLiveEdge(context, routeData, dimensions, padding, colors);
    }

    function drawLiveEdge(context, routeData, dimensions, padding, colors) {
      if (!hasLiveChartEdge(routeData)) return;
      const x = dimensions.width - padding.right;
      const top = padding.top, bottom = dimensions.height - padding.bottom;
      context.save();
      context.strokeStyle = colors.forest;
      context.lineWidth = 1;
      context.setLineDash([3, 4]);
      context.globalAlpha = 0.5;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
      context.restore();
    }

    function referenceBandLimits(point) {
      const standardDeviation = finiteNumber(point?.standardDeviation);
      const radius = Number.isFinite(standardDeviation) ? standardDeviation * state.referenceSigma : 0;
      return {
        lower: point.speed - radius,
        upper: point.speed + radius
      };
    }

    function drawGrid(context, padding, plotWidth, plotHeight, colors, domain) {
      context.save();
      context.font = "10px IBM Plex Mono, monospace";
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillStyle = colors.muted;
      context.fillText("mph", padding.left - 8, padding.top - 12);
      for (let speed = Math.ceil(domain.min / domain.step) * domain.step; speed <= domain.max + 0.01; speed += domain.step) {
        const verticalPosition = speedToVertical(speed, padding.top, plotHeight, domain);
        const major = speed % 10 === 0;
        context.strokeStyle = major ? colors.gridStrong : colors.grid;
        context.lineWidth = major ? 1.1 : 1;
        context.setLineDash(major ? [] : [3, 3]);
        context.beginPath();
        context.moveTo(padding.left, verticalPosition);
        context.lineTo(padding.left + plotWidth, verticalPosition);
        context.stroke();
        context.fillStyle = colors.muted;
        context.fillText(String(speed), padding.left - 8, verticalPosition);
      }
      context.restore();
    }

    function drawZoneRowGrid(context, plotLeft, plotWidth, plotTop, plotHeight, colors, domain) {
      context.save();
      context.font = "8px IBM Plex Mono, monospace";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let speed = Math.ceil(domain.min / domain.step) * domain.step; speed <= domain.max + 0.01; speed += domain.step) {
        const verticalPosition = speedToVertical(speed, plotTop, plotHeight, domain);
        context.strokeStyle = speed % 10 === 0 ? colors.gridStrong : colors.grid;
        context.lineWidth = 1;
        context.setLineDash([2, 4]);
        context.beginPath();
        context.moveTo(plotLeft, verticalPosition);
        context.lineTo(plotLeft + plotWidth, verticalPosition);
        context.stroke();
        context.fillStyle = colors.muted;
        context.fillText(String(speed), plotLeft - 5, verticalPosition);
      }
      context.restore();
    }

    function drawSpeedLimitGuide(context, speedLimit, plotLeft, plotWidth, plotTop, plotHeight, colors, domain) {
      if (!Number.isFinite(speedLimit)) return;
      const verticalPosition = speedToVertical(speedLimit, plotTop, plotHeight, domain);
      context.save();
      context.globalAlpha = 0.72;
      context.strokeStyle = colors.muted;
      context.lineWidth = 1.2;
      context.setLineDash([9, 4]);
      context.beginPath();
      context.moveTo(plotLeft, verticalPosition);
      context.lineTo(plotLeft + plotWidth, verticalPosition);
      context.stroke();
      context.restore();
    }

    function speedZoneDescriptor(group, baselineSeries) {
      const marker = String(group?.marker || "").replace(/^MM\s*/i, "");
      return {
        mileMarkerRange: marker || "Unavailable",
        liveSpeed: `${formatMetricNumber(group?.latestSpeed, 0)} mph`,
        expectedSpeed: `${formatMetricNumber(baselineSeries?.at(-1)?.speed, 0)} mph`
      };
    }

    function drawSpeedZoneDescriptor(context, group, baselineSeries, plotTop, plotHeight, colors, plotLeft) {
      const descriptor = speedZoneDescriptor(group, baselineSeries);
      const hasPostedSpeed = Number.isFinite(group?.postedSpeedMph);
      const center = (plotLeft - 8) / 2 + (zoneFinderActive() ? 10 : 0);
      const descriptorTop = speedZoneDescriptorTop(plotTop, plotHeight);
      context.save();
      if (zoneFinderActive() && group.referenceLabel) {
        const selected = state.selectedZoneKey === (group.referenceKey || group.key);
        context.fillStyle = group.referenceColor || colors.ink;
        context.fillRect(2, plotTop + plotHeight / 2 - 12, 28, 24);
        context.strokeStyle = selected ? colors.ink : (group.referenceColor || "#559bde");
        context.lineWidth = selected ? 2 : 1;
        context.strokeRect(2, plotTop + plotHeight / 2 - 12, 28, 24);
        context.font = "700 10px IBM Plex Mono, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#10251a";
        context.fillText(group.referenceLabel, 16, plotTop + plotHeight / 2);
      }
      context.fillStyle = colors.ink;
      context.font = "600 9px Archivo, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("Mile Marker", center, descriptorTop + 5);
      context.font = "600 10px IBM Plex Mono, monospace";
      context.fillText(descriptor.mileMarkerRange, center, descriptorTop + 16);
      if (hasPostedSpeed) drawSpeedLimitSign(context, group.postedSpeedMph, center - 14.5, descriptorTop + 24);
      context.font = "600 9px Archivo, sans-serif";
      context.fillText(chartHistory.endTime !== null || HISTORICAL_MODE || REPLAY_MODE || state.selectedHours > 24 ? "Observed:" : "Live:", center, descriptorTop + 68);
      context.font = "600 10px IBM Plex Mono, monospace";
      context.fillText(descriptor.liveSpeed, center, descriptorTop + 79);
      context.fillStyle = colors.muted;
      context.font = "600 9px Archivo, sans-serif";
      context.fillText("Expected:", center, descriptorTop + 92);
      context.font = "600 10px IBM Plex Mono, monospace";
      context.fillText(descriptor.expectedSpeed, center, descriptorTop + 103);
      context.restore();
    }

    function speedZoneDescriptorTop(plotTop, plotHeight) {
      const descriptorHeight = 108;
      return plotTop + (plotHeight - descriptorHeight) / 2;
    }

    function drawSelectedZoneOutline(context, groups, dimensions) {
      if (!zoneFinderActive()) return;
      const index = groups.findIndex(group => (group.referenceKey || group.key) === state.selectedZoneKey);
      if (index < 0) return;
      const rowHeight = (dimensions.height - 36) / groups.length;
      context.save();
      context.strokeStyle = "#559bde";
      context.lineWidth = 2;
      context.setLineDash([]);
      context.strokeRect(1, 6 + index * rowHeight + 1, dimensions.width - 2, rowHeight - 2);
      context.restore();
    }

    function drawSpeedLimitSign(context, speedLimit, left, top) {
      const width = 29;
      const height = 36;
      context.save();
      context.fillStyle = "#fff";
      context.strokeStyle = "#111";
      context.lineWidth = 1.4;
      context.fillRect(left, top, width, height);
      context.strokeRect(left + 0.7, top + 0.7, width - 1.4, height - 1.4);
      context.fillStyle = "#111";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "700 5.5px Archivo, sans-serif";
      context.fillText("SPEED", left + width / 2, top + 6);
      context.fillText("LIMIT", left + width / 2, top + 11.5);
      context.font = "700 18px Archivo, sans-serif";
      context.fillText(formatMetricNumber(speedLimit, 0), left + width / 2, top + 24.5);
      context.restore();
    }

    function drawNormalBand(context, baselinePoints, plotTop, plotHeight, colors, domain) {
      for (const segment of chartSegments(baselinePoints)) drawBandSegment(context, segment, plotTop, plotHeight, colors, domain);
    }

    function chartSegments(points) {
      return chartSeries.splitSpeedSeries(points, point => Number.isFinite(point.verticalPosition));
    }

    function drawBandSegment(context, baselinePoints, plotTop, plotHeight, colors, domain) {
      if (baselinePoints.length < 2) return;
      context.save();
      context.fillStyle = colors.band;
      context.beginPath();
      baselinePoints.forEach((point, pointIndex) => {
        const verticalPosition = speedToVertical(referenceBandLimits(point).upper, plotTop, plotHeight, domain);
        if (pointIndex === 0) context.moveTo(point.horizontalPosition, verticalPosition);
        else context.lineTo(point.horizontalPosition, verticalPosition);
      });
      [...baselinePoints].reverse().forEach((point) => {
        context.lineTo(point.horizontalPosition, speedToVertical(referenceBandLimits(point).lower, plotTop, plotHeight, domain));
      });
      context.closePath();
      context.fill();
      context.restore();
    }

    function drawSmoothLine(context, points, color, lineWidth, dash) {
      for (const segment of chartSegments(points)) drawLineSegment(context, segment, color, lineWidth, dash);
    }

    function drawPointMarkers(context, points, color, hollow, scale = 1) {
      const radius = pointMarkerRadius(points.length) * scale;
      const panelColor = chartColors().panel;
      context.save();
      context.strokeStyle = color;
      context.lineWidth = Math.max(1.15, radius * 0.52);
      for (const point of points) {
        if (point.isBoundary || !Number.isFinite(point.horizontalPosition) || !Number.isFinite(point.verticalPosition)) continue;
        const isHollow = hollow || point.isCarryForward;
        context.beginPath();
        context.arc(point.horizontalPosition, point.verticalPosition, radius, 0, Math.PI * 2);
        context.fillStyle = isHollow ? panelColor : color;
        context.globalAlpha = isHollow ? 1 : 0.34;
        context.fill();
        context.globalAlpha = 1;
        context.stroke();
      }
      context.restore();
    }

    function pointMarkerRadius(pointCount) {
      if (pointCount > 400) return 2.1;
      if (pointCount > 160) return 2.5;
      return 3.2;
    }

    function drawLineSegment(context, points, color, lineWidth, dash) {
      if (points.length === 1) {
        context.save();
        context.fillStyle = color;
        context.beginPath();
        context.arc(points[0].horizontalPosition, points[0].verticalPosition, 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
      }
      context.save();
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.setLineDash(dash);
      context.beginPath();
      context.moveTo(points[0].horizontalPosition, points[0].verticalPosition);
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        const previous = points[pointIndex - 1];
        const current = points[pointIndex];
        const midpoint = (previous.horizontalPosition + current.horizontalPosition) / 2;
        context.quadraticCurveTo(previous.horizontalPosition, previous.verticalPosition, midpoint, (previous.verticalPosition + current.verticalPosition) / 2);
      }
      const lastPoint = points[points.length - 1];
      context.lineTo(lastPoint.horizontalPosition, lastPoint.verticalPosition);
      context.stroke();
      context.restore();
    }

    function drawTimeGuides(context, ticks, plotLeft, plotTop, axisY, colors) {
      context.save();
      context.strokeStyle = colors.muted;
      context.globalAlpha = state.selectedHours === 168 ? 0.42 : 0.18;
      context.lineWidth = 1;
      context.setLineDash([3, 5]);
      for (const tick of ticks.filter(tick => tick.guide)) {
        const x = plotLeft + tick.horizontalPosition;
        context.beginPath();
        context.moveTo(x, plotTop);
        context.lineTo(x, axisY);
        context.stroke();
      }
      context.restore();
    }

    function drawXAxis(context, ticks, dimensions, padding, colors, liveEdge = false) {
      const axisY = dimensions.height - padding.bottom;
      const plotLeft = padding.left;
      context.save();
      context.fillStyle = colors.ink;
      context.font = "10px IBM Plex Mono, monospace";
      context.textBaseline = "top";
      const liveLabelStart = liveEdge
        ? dimensions.width - padding.right - context.measureText("Live").width - 16
        : Infinity;
      for (const tick of ticks) {
        const horizontalPosition = plotLeft + tick.horizontalPosition;
        const tickLength = tick.level === "major" ? 9 : tick.level === "medium" ? 7 : 4;
        context.strokeStyle = colors.muted;
        context.globalAlpha = tick.level === "major" ? 0.95 : tick.level === "medium" ? 0.75 : 0.5;
        context.lineWidth = tick.level === "major" ? 1.5 : 1;
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(horizontalPosition, axisY);
        context.lineTo(horizontalPosition, axisY + tickLength);
        context.stroke();
        if (tick.label) {
          context.globalAlpha = 1;
          context.textAlign = horizontalPosition < padding.left + 35 ? "left"
            : horizontalPosition > dimensions.width - padding.right - 35 ? "right" : "center";
          if (liveEdge) {
            const width = context.measureText(tick.label).width;
            const right = horizontalPosition + (context.textAlign === "left" ? width : context.textAlign === "center" ? width / 2 : 0);
            if (right > liveLabelStart) continue;
          }
          context.fillText(tick.label, horizontalPosition, axisY + 11);
        }
      }
      context.restore();
    }

    function drawIncidentFlags(context, corridor, incidentThreads, currentPoints, startTime, endTime, padding, colors, options = {}) {
      const maximum = finiteNumber(options.maximum) || (state.selectedHours > 24 ? 5 : 4);
      const visibleIncidents = state.selectedHours > 24
        ? buildIncidentDayGroups(incidentThreads, startTime, endTime, maximum)
        : buildIncidentChartGroups(incidentThreads, startTime, endTime, padding.left,
          context.canvas.clientWidth - padding.right).slice(0, maximum);
      const occupiedLanes = [[], []];
      const occupiedLabels = [];
      const plotRight = context.canvas.clientWidth - padding.right;
      const flagTop = finiteNumber(options.top) || 12;
      const plotTop = finiteNumber(options.plotTop);
      const plotBottom = finiteNumber(options.plotBottom);
      const placeInsidePlot = Number.isFinite(plotTop) && Number.isFinite(plotBottom) && plotBottom > plotTop;
      for (const incidentGroup of visibleIncidents) {
        const incident = incidentGroup.incident;
        const timestamp = incidentGroup.timestamp;
        const nearest = currentPoints.reduce((best, point) =>
          !best || Math.abs(point.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? point : best, null);
        // Do not imply a speed measurement during a gap in collection.
        if (!nearest || Math.abs(nearest.timestamp - timestamp) > 60 * 60_000) continue;
        const x = padding.left + (timestamp - startTime) / (endTime - startTime) * (plotRight - padding.left);
        const combinedMarker = incidentGroup.combined || incidentGroup.count > 1;
        const color = combinedMarker ? colors["--rose"] : incidentColor(incident.type, colors);
        context.save();
        context.font = "600 9px Archivo, sans-serif";
        const rawLabel = incidentGroup.combined ? incidentGroup.label : ((incidentGroup.count > 1
          ? `${incidentGroup.count} incidents` : chartIncidentLabel(incident))
          + (dateMillis(incident.firstSeenAt) < startTime ? " · last seen" : ""));
        const label = fitIncidentChartLabel(context, rawLabel, plotRight - padding.left - 6);
        if (!label) { context.restore(); continue; }
        const width = context.measureText(label).width;
        const labelOffset = 14;
        const labelPadding = 3;
        const alignRight = x + labelOffset + width + labelPadding > plotRight;
        const textX = alignRight
          ? Math.min(plotRight - labelPadding, Math.max(padding.left + labelPadding + width, x - labelOffset))
          : Math.max(padding.left + labelPadding, Math.min(plotRight - labelPadding - width, x + labelOffset));
        const left = Math.min(x - 8, alignRight ? textX - width - labelPadding : textX - labelPadding);
        const right = Math.max(x + 8, alignRight ? textX + labelPadding : textX + width + labelPadding);
        const preferredSide = placeInsidePlot && nearest.verticalPosition < (plotTop + plotBottom) / 2 ? "below" : "above";
        let placement;
        if (placeInsidePlot) {
          const blockedRanges = trafficLineRanges(options.avoidSeries, left, right);
          for (let lane = 0; lane < 2; lane += 1) {
            const candidate = incidentFlagPlacement(
              nearest.verticalPosition,
              { top: plotTop, bottom: plotBottom },
              lane,
              preferredSide,
              blockedRanges
            );
            const candidateBounds = { left, right, top: candidate.y - 8, bottom: candidate.y + 8 };
            const overlaps = occupiedLabels.some(existing =>
              candidateBounds.right + 6 >= existing.left && candidateBounds.left <= existing.right + 6
              && candidateBounds.bottom + 3 >= existing.top && candidateBounds.top <= existing.bottom + 3);
            if (!overlaps) {
              occupiedLabels.push(candidateBounds);
              placement = candidate;
              break;
            }
          }
        } else {
          const lane = occupiedLanes.findIndex(ranges =>
            ranges.every(range => right + 6 < range.left || left > range.right + 6));
          if (lane >= 0) {
            occupiedLanes[lane].push({ left, right });
            placement = { y: flagTop + lane * 15, side: "above" };
          }
        }
        if (!placement) { context.restore(); continue; }
        const y = placement.y;
        context.strokeStyle = color;
        context.lineWidth = 1.2;
        context.setLineDash([4, 3]);
        context.beginPath();
        context.moveTo(x, y + (placement.side === "above" ? 9 : -9));
        context.lineTo(x, nearest.verticalPosition);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = colors.panel;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, nearest.verticalPosition, 4, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        drawIncidentLabelBackground(context, x, y, width, alignRight, color, colors.panel, padding.left, plotRight, textX);
        drawIncidentGlyph(context, x, y, combinedMarker ? "Cluster" : incident.type, color, incidentGroup.count);
        context.fillStyle = colors.ink;
        context.textBaseline = "middle";
        context.textAlign = alignRight ? "right" : "left";
        context.fillText(label, textX, y);
        context.restore();
      }
    }

    function fitIncidentChartLabel(context, label, maximumWidth) {
      if (context.measureText(label).width <= maximumWidth) return label;
      let text = String(label);
      while (text && context.measureText(`${text}…`).width > maximumWidth) text = text.slice(0, -1);
      return text ? `${text}…` : "";
    }

    function drawIncidentLabelBackground(context, x, y, width, alignRight, color, panelColor, plotLeft, plotRight, textAnchor) {
      const textX = textAnchor ?? x + (alignRight ? -14 : 14);
      const left = Math.max(plotLeft + 2, alignRight ? textX - width - 3 : textX - 3);
      const right = Math.min(plotRight - 2, alignRight ? textX + 3 : textX + width + 3);
      const top = y - 7;
      const height = 14;
      context.save();
      context.beginPath();
      context.roundRect(left, top, Math.max(1, right - left), height, 3);
      context.fillStyle = panelColor;
      context.globalAlpha = 0.9;
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 0.8;
      context.globalAlpha = 0.34;
      context.stroke();
      context.restore();
    }

    function incidentFlagPlacement(pointY, bounds, lane, preferredSide, blockedRanges = []) {
      const margin = 9;
      const minimumOffset = 18 + lane * 15;
      const minimumClearance = 16;
      const sides = [preferredSide, preferredSide === "below" ? "above" : "below"];
      const candidates = [];
      for (const side of sides) {
        const direction = side === "below" ? 1 : -1;
        const maximumOffset = side === "below"
          ? bounds.bottom - margin - pointY
          : pointY - bounds.top - margin;
        for (let offset = minimumOffset; offset <= maximumOffset; offset += 2) {
          const y = pointY + direction * offset;
          const clearance = verticalClearance(y, blockedRanges);
          const candidate = { y, side, clearance, offset, preferred: side === preferredSide };
          candidates.push(candidate);
          if (clearance >= minimumClearance) return { y, side };
        }
      }
      if (candidates.length > 0) {
        candidates.sort((left, right) => right.clearance - left.clearance
          || Number(right.preferred) - Number(left.preferred)
          || left.offset - right.offset);
        return { y: candidates[0].y, side: candidates[0].side };
      }
      const side = preferredSide === "below" ? "above" : "below";
      return {
        y: side === "below" ? bounds.bottom - margin : bounds.top + margin,
        side
      };
    }

    function verticalClearance(y, ranges) {
      if (!Array.isArray(ranges) || ranges.length === 0) return Number.POSITIVE_INFINITY;
      return Math.min(...ranges.map(range => y < range.min ? range.min - y : y > range.max ? y - range.max : 0));
    }

    function trafficLineRanges(seriesCollection, left, right) {
      const ranges = [];
      for (const series of Array.isArray(seriesCollection) ? seriesCollection : []) {
        for (const segment of chartSegments(Array.isArray(series) ? series : [])) {
          if (segment.length === 1) {
            const point = segment[0];
            if (point.horizontalPosition >= left && point.horizontalPosition <= right) {
              ranges.push({ min: point.verticalPosition, max: point.verticalPosition });
            }
            continue;
          }
          for (let index = 1; index < segment.length; index += 1) {
            const start = segment[index - 1];
            const end = segment[index];
            const segmentLeft = Math.min(start.horizontalPosition, end.horizontalPosition);
            const segmentRight = Math.max(start.horizontalPosition, end.horizontalPosition);
            if (segmentRight < left || segmentLeft > right) continue;
            const clippedLeft = Math.max(left, segmentLeft);
            const clippedRight = Math.min(right, segmentRight);
            const span = Math.max(1, end.horizontalPosition - start.horizontalPosition);
            const verticalAt = horizontalPosition => start.verticalPosition
              + (end.verticalPosition - start.verticalPosition) * (horizontalPosition - start.horizontalPosition) / span;
            const first = verticalAt(clippedLeft);
            const last = verticalAt(clippedRight);
            ranges.push({ min: Math.min(first, last), max: Math.max(first, last) });
          }
        }
      }
      return ranges;
    }

    function buildIncidentDayGroups(incidentThreads, startTime, endTime, maximum = 5) {
      const days = new Map();
      for (const incident of Array.isArray(incidentThreads) ? incidentThreads : []) {
        const timestamp = dateMillis(incident.firstSeenAt);
        if (!(timestamp >= startTime && timestamp <= endTime)) continue;
        const day = chartSeries.denverCalendarDay(timestamp);
        if (!day) continue;
        const existing = days.get(day) || { day, incidents: [], timestamps: [] };
        existing.incidents.push(incident);
        existing.timestamps.push(timestamp);
        days.set(day, existing);
      }

      return [...days.values()]
        .map(group => {
          group.timestamps.sort((left, right) => left - right);
          const timestamp = group.timestamps[Math.floor((group.timestamps.length - 1) / 2)];
          const count = group.incidents.length;
          return {
            incident: group.incidents[0],
            timestamp,
            count,
            combined: true,
            label: `${count} ${count === 1 ? "incident" : "incidents"} · ${formatIncidentDay(timestamp)}`
          };
        })
        .sort((left, right) => right.count - left.count || right.timestamp - left.timestamp)
        .slice(0, maximum)
        .sort((left, right) => left.timestamp - right.timestamp);
    }

    function formatIncidentDay(timestamp) {
      return displayTimeFormatter({ month: "short", day: "numeric" }).format(new Date(timestamp));
    }

    function buildIncidentChartGroups(incidentThreads, startTime, endTime, plotLeft, plotRight) {
      const candidates = (Array.isArray(incidentThreads) ? incidentThreads : [])
        .map(incident => {
          const timestamp = incidentChartTimestamp(incident, startTime, endTime);
          return {
            incident,
            timestamp,
            label: chartIncidentLabel(incident),
            x: plotLeft + (timestamp - startTime) / Math.max(1, endTime - startTime) * (plotRight - plotLeft)
          };
        })
        .filter(candidate => candidate.timestamp >= startTime && candidate.timestamp <= endTime)
        .sort((left, right) => left.timestamp - right.timestamp);
      const groups = [];
      for (const candidate of candidates) {
        const existing = groups.find(group => Math.abs(group.x - candidate.x) <= 8);
        if (existing) {
          existing.count += 1;
          continue;
        }
        groups.push({ ...candidate, count: 1 });
      }
      return groups;
    }

    function incidentChartTimestamp(incident, startTime, endTime) {
      const firstSeenAt = dateMillis(incident.firstSeenAt);
      if (firstSeenAt >= startTime && firstSeenAt <= endTime) return firstSeenAt;
      const lastSeenAt = dateMillis(incident.lastSeenAt);
      // A lifecycle that spans the whole visible range has no transition to mark.
      // Omitting it prevents long-running incidents from forming an artificial pile
      // at the replay cursor; the active count and incident table still show it.
      if (!incident.ongoing && lastSeenAt >= startTime && lastSeenAt <= endTime) return lastSeenAt;
      return 0;
    }

    const incidentGlyphPaths = new Map();

    function drawIncidentGlyph(context, horizontalPosition, verticalPosition, type, color, count = 1) {
      context.save();
      context.translate(horizontalPosition, verticalPosition);
      context.fillStyle = color;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      if (type === "Cluster") {
        context.beginPath();
        context.arc(0, 0, 8, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#fff";
        context.font = "bold 9px Archivo, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(count), 0, 0);
      } else {
        let path = incidentGlyphPaths.get(type);
        if (!path) {
          path = new Path2D(types.icon(type).path);
          incidentGlyphPaths.set(type, path);
        }
        context.scale(0.65, 0.65);
        context.translate(-12, -12);
        context.lineWidth = 2;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke(path);
      }
      context.restore();
    }

    function chartIncidentLabel(incident) {
      const markerMatch = String(incident.locationLabel || "").match(/(?:MP|MM)\s+[0-9.]+/i);
      const label = incident.displayType || types.icon(incident.type).label;
      return markerMatch ? `${label} · ${markerMatch[0].toUpperCase()}` : label;
    }

    function speedToVertical(speed, plotTop, plotHeight, domain = { min: 0, max: 100 }) {
      const normalized = (Math.max(domain.min, Math.min(domain.max, speed)) - domain.min) / Math.max(1, domain.max - domain.min);
      return plotTop + plotHeight - normalized * plotHeight;
    }

    function incidentColor(type, colors) {
      const tone = types.icon(type).tone;
      if (tone === "construction") return colors["--gold-data"];
      if (tone === "vehicle") return colors.forest;
      if (tone === "weather") return colors.weather || colors["--rose"];
      if (tone === "other") return colors.muted || colors["--rose"];
      return colors["--rose"];
    }

    return { drawCorridorChart, drawZoneChart, drawLiveEdge, referenceBandLimits, speedZoneDescriptor, drawSpeedZoneDescriptor, speedZoneDescriptorTop, drawSelectedZoneOutline, drawSpeedLimitSign, chartSegments, pointMarkerRadius, drawTimeGuides, drawXAxis, drawIncidentFlags, drawIncidentLabelBackground, incidentFlagPlacement, trafficLineRanges, buildIncidentDayGroups, buildIncidentChartGroups, incidentChartTimestamp, drawIncidentGlyph, chartIncidentLabel };
  }

  window.DashboardChartPainter = { create };
})();
