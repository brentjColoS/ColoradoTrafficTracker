#!/usr/bin/env python3

import argparse
import json
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


EARTH_RADIUS_METERS = 6_371_008.8
METERS_PER_MILE = 1_609.344
BOUNDING_BOX_PADDING_DEGREES = 0.01
MAX_ENDPOINT_GAP_METERS = 250.0
MAX_LENGTH_DIFFERENCE_MILES = 0.25
MAX_REFERENCE_DISTANCE_METERS = 250.0


@dataclass(frozen=True)
class RelationSource:
    corridor: str
    direction: str
    relation_id: str
    relation_version: str
    source_timestamp: str
    source_file: str


@dataclass(frozen=True)
class CorridorSource:
    corridor: str
    monitored_miles: tuple[float, float]
    reference_file: str
    output_file: str
    relations: tuple[RelationSource, RelationSource]


CORRIDORS = (
    CorridorSource(
        corridor="I25",
        monitored_miles=(208.0, 271.0),
        reference_file="i25.geojson",
        output_file="i25.geojson",
        relations=(
            RelationSource("I25", "NORTHBOUND", "2333676", "266", "2026-04-30T20:54:01Z", "ctt-i25-north.osm"),
            RelationSource("I25", "SOUTHBOUND", "2333677", "261", "2026-04-30T20:54:01Z", "ctt-i25-south.osm"),
        ),
    ),
    CorridorSource(
        corridor="I70",
        monitored_miles=(206.0, 259.0),
        reference_file="i70.geojson",
        output_file="i70.geojson",
        relations=(
            RelationSource("I70", "EASTBOUND", "6894122", "219", "2026-07-07T04:04:17Z", "ctt-i70-east.osm"),
            RelationSource("I70", "WESTBOUND", "84533", "352", "2026-07-07T04:04:17Z", "ctt-i70-west.osm"),
        ),
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build monitored directional corridor geometry from pinned OSM relation snapshots."
    )
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument(
        "--reference-dir",
        type=Path,
        default=Path("routes-service/src/main/resources/routes"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("routes-service/src/main/resources/routes/directional/v1"),
    )
    return parser.parse_args()


def read_reference(path: Path) -> list[tuple[float, float]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("type") != "LineString" or len(payload.get("coordinates", [])) < 2:
        raise ValueError(f"Expected LineString reference geometry in {path}")
    return [tuple(coordinate) for coordinate in payload["coordinates"]]


def read_relation(
    path: Path,
    source: RelationSource,
) -> tuple[list[list[str]], list[str], dict[str, tuple[float, float]]]:
    root = ET.parse(path).getroot()
    relation = next(
        (item for item in root.findall("relation") if item.attrib.get("id") == source.relation_id),
        None,
    )
    if relation is None:
        raise ValueError(f"Relation {source.relation_id} is missing from {path}")
    if relation.attrib.get("version") != source.relation_version:
        raise ValueError(
            f"Relation {source.relation_id} version changed: "
            f"expected {source.relation_version}, found {relation.attrib.get('version')}"
        )
    if relation.attrib.get("timestamp") != source.source_timestamp:
        raise ValueError(
            f"Relation {source.relation_id} timestamp changed: "
            f"expected {source.source_timestamp}, found {relation.attrib.get('timestamp')}"
        )

    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in relation.findall("tag")}
    expected_direction = source.direction.removesuffix("BOUND").lower()
    if tags.get("direction") != expected_direction:
        raise ValueError(
            f"Relation {source.relation_id} direction changed: "
            f"expected {expected_direction}, found {tags.get('direction')}"
        )

    node_map = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in root.findall("node")
    }
    way_map = {
        way.attrib["id"]: [node.attrib["ref"] for node in way.findall("nd")]
        for way in root.findall("way")
    }
    relation_way_ids = [
        member.attrib["ref"]
        for member in relation.findall("member")
        if member.attrib.get("type") == "way" and member.attrib.get("ref") in way_map
    ]
    if not relation_way_ids:
        raise ValueError(f"Relation {source.relation_id} has no usable way members")

    ordered_ways = [way_map[way_id] for way_id in relation_way_ids]
    return ordered_ways, relation_way_ids, node_map


def monitored_way_run(
    reference: list[tuple[float, float]],
    ordered_ways: list[list[str]],
    node_map: dict[str, tuple[float, float]],
) -> list[list[str]]:
    west = min(point[0] for point in reference) - BOUNDING_BOX_PADDING_DEGREES
    east = max(point[0] for point in reference) + BOUNDING_BOX_PADDING_DEGREES
    south = min(point[1] for point in reference) - BOUNDING_BOX_PADDING_DEGREES
    north = max(point[1] for point in reference) + BOUNDING_BOX_PADDING_DEGREES

    selected_indices = []
    for index, way in enumerate(ordered_ways):
        if any(
            west <= node_map[node_id][0] <= east and south <= node_map[node_id][1] <= north
            for node_id in way
        ):
            selected_indices.append(index)

    runs: list[list[int]] = []
    for index in selected_indices:
        if not runs or index != runs[-1][-1] + 1:
            runs.append([index])
        else:
            runs[-1].append(index)
    if not runs:
        raise ValueError("No relation ways overlap the monitored reference extent")

    longest_run = max(runs, key=len)
    if len(longest_run) < 2:
        raise ValueError("The monitored relation extent does not form a useful run")
    return [ordered_ways[index] for index in longest_run]


def stitch_way_run(
    ways: list[list[str]],
    node_map: dict[str, tuple[float, float]],
) -> list[tuple[float, float]]:
    stitched_node_ids = list(ways[0])
    for way in ways[1:]:
        if stitched_node_ids[-1] != way[0]:
            raise ValueError(
                f"Directional relation is not continuous between nodes {stitched_node_ids[-1]} and {way[0]}"
            )
        stitched_node_ids.extend(way[1:])
    return [node_map[node_id] for node_id in stitched_node_ids]


def clip_to_reference_endpoints(
    coordinates: list[tuple[float, float]],
    reference: list[tuple[float, float]],
) -> tuple[list[tuple[float, float]], dict[str, float | str]]:
    first_index = min(
        range(len(coordinates)),
        key=lambda index: haversine_meters(coordinates[index], reference[0]),
    )
    last_index = min(
        range(len(coordinates)),
        key=lambda index: haversine_meters(coordinates[index], reference[-1]),
    )
    lower, upper = sorted((first_index, last_index))
    clipped = coordinates[lower : upper + 1]
    first_gap = haversine_meters(coordinates[first_index], reference[0])
    last_gap = haversine_meters(coordinates[last_index], reference[-1])
    if max(first_gap, last_gap) > MAX_ENDPOINT_GAP_METERS:
        raise ValueError(
            f"Directional endpoint is too far from the monitored reference: {max(first_gap, last_gap):.1f} m"
        )

    return clipped, {
        "referenceOrder": "same" if first_index < last_index else "reverse",
        "referenceStartGapMeters": round(first_gap, 1),
        "referenceEndGapMeters": round(last_gap, 1),
    }


def haversine_meters(start: tuple[float, float], end: tuple[float, float]) -> float:
    start_latitude = math.radians(start[1])
    end_latitude = math.radians(end[1])
    latitude_delta = end_latitude - start_latitude
    longitude_delta = math.radians(end[0] - start[0])
    value = (
        math.sin(latitude_delta / 2.0) ** 2
        + math.cos(start_latitude)
        * math.cos(end_latitude)
        * math.sin(longitude_delta / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_METERS * math.asin(math.sqrt(value))


def line_length_miles(coordinates: list[tuple[float, float]]) -> float:
    return sum(
        haversine_meters(start, end)
        for start, end in zip(coordinates, coordinates[1:])
    ) / METERS_PER_MILE


def point_to_segment_meters(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    reference_latitude = math.radians((point[1] + start[1] + end[1]) / 3.0)
    start_x = math.radians(start[0] - point[0]) * EARTH_RADIUS_METERS * math.cos(reference_latitude)
    start_y = math.radians(start[1] - point[1]) * EARTH_RADIUS_METERS
    end_x = math.radians(end[0] - point[0]) * EARTH_RADIUS_METERS * math.cos(reference_latitude)
    end_y = math.radians(end[1] - point[1]) * EARTH_RADIUS_METERS
    delta_x = end_x - start_x
    delta_y = end_y - start_y
    length_squared = delta_x * delta_x + delta_y * delta_y
    fraction = (
        0.0
        if length_squared == 0.0
        else max(0.0, min(1.0, -((start_x * delta_x) + (start_y * delta_y)) / length_squared))
    )
    return math.hypot(start_x + fraction * delta_x, start_y + fraction * delta_y)


def reference_distance_report(
    coordinates: list[tuple[float, float]],
    reference: list[tuple[float, float]],
) -> dict[str, float]:
    distances = sorted(
        min(
            point_to_segment_meters(point, start, end)
            for start, end in zip(reference, reference[1:])
        )
        for point in coordinates
    )
    maximum = distances[-1]
    if maximum > MAX_REFERENCE_DISTANCE_METERS:
        raise ValueError(
            f"Directional geometry strays {maximum:.1f} m from the monitored reference"
        )
    return {
        "medianReferenceDistanceMeters": round(distances[len(distances) // 2], 1),
        "p95ReferenceDistanceMeters": round(distances[int(0.95 * (len(distances) - 1))], 1),
        "maxReferenceDistanceMeters": round(maximum, 1),
    }


def build_corridor(
    corridor: CorridorSource,
    source_dir: Path,
    reference_dir: Path,
) -> tuple[dict, list[dict]]:
    reference = read_reference(reference_dir / corridor.reference_file)
    reference_length = line_length_miles(reference)
    features = []
    report = []

    for source in corridor.relations:
        source_path = source_dir / source.source_file
        ordered_ways, relation_way_ids, node_map = read_relation(source_path, source)
        run = monitored_way_run(reference, ordered_ways, node_map)
        stitched = stitch_way_run(run, node_map)
        clipped, endpoint_report = clip_to_reference_endpoints(stitched, reference)
        distance_report = reference_distance_report(clipped, reference)
        length_miles = line_length_miles(clipped)
        if abs(length_miles - reference_length) > MAX_LENGTH_DIFFERENCE_MILES:
            raise ValueError(
                f"{source.corridor} {source.direction} length differs from the reference by "
                f"{abs(length_miles - reference_length):.2f} miles"
            )

        properties = {
            "corridor": source.corridor,
            "direction": source.direction,
            "geometryVersion": 1,
            "source": "OpenStreetMap",
            "sourceRelationId": int(source.relation_id),
            "sourceRelationVersion": int(source.relation_version),
            "sourceTimestamp": source.source_timestamp,
            "monitoredMileStart": corridor.monitored_miles[0],
            "monitoredMileEnd": corridor.monitored_miles[1],
        }
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[longitude, latitude] for longitude, latitude in clipped],
                },
            }
        )
        report.append(
            {
                **properties,
                "relationWayCount": len(relation_way_ids),
                "monitoredWayCount": len(run),
                "coordinateCount": len(clipped),
                "lengthMiles": round(length_miles, 2),
                **endpoint_report,
                **distance_report,
            }
        )

    return {
        "type": "FeatureCollection",
        "properties": {
            "corridor": corridor.corridor,
            "geometryVersion": 1,
            "source": "OpenStreetMap",
            "attribution": "© OpenStreetMap contributors",
            "license": "https://www.openstreetmap.org/copyright",
        },
        "features": features,
    }, report


def write_json(path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    full_report = []
    for corridor in CORRIDORS:
        payload, report = build_corridor(corridor, args.source_dir, args.reference_dir)
        write_json(args.output_dir / corridor.output_file, payload)
        full_report.extend(report)
    write_json(args.output_dir / "qa-report.json", full_report)


if __name__ == "__main__":
    main()
