#!/usr/bin/env python3

import argparse
import heapq
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path


EARTH_RADIUS_METERS = 6_371_008.8
MAX_ENDPOINT_GAP_METERS = 250.0
MAX_JOIN_GAP_METERS = 250.0
MAX_SEGMENT_METERS = 1_000.0
RELATION_ID = "6894122"
RELATION_VERSION = "219"
RELATION_TIMESTAMP = "2026-07-07T04:04:17Z"
EXTENSION_START = (-105.2020258731, 39.701859339217)
EXTENSION_END = (-104.990514722445, 39.78026018504)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extend the configured I-70 reference geometry from CDOT MM 259 to MM 274."
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--reference",
        type=Path,
        default=Path("routes-service/src/main/resources/routes/i70.geojson"),
    )
    return parser.parse_args()


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


def read_reference(path: Path) -> list[tuple[float, float]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("type") != "LineString" or len(payload.get("coordinates", [])) < 2:
        raise ValueError(f"Expected LineString reference geometry in {path}")
    return [tuple(coordinate) for coordinate in payload["coordinates"]]


def read_relation(path: Path) -> tuple[list[list[str]], dict[str, tuple[float, float]]]:
    root = ET.parse(path).getroot()
    relation = next(
        (item for item in root.findall("relation") if item.attrib.get("id") == RELATION_ID),
        None,
    )
    if relation is None:
        raise ValueError(f"Relation {RELATION_ID} is missing from {path}")
    if relation.attrib.get("version") != RELATION_VERSION:
        raise ValueError(
            f"Relation {RELATION_ID} version changed: expected {RELATION_VERSION}, "
            f"found {relation.attrib.get('version')}"
        )
    if relation.attrib.get("timestamp") != RELATION_TIMESTAMP:
        raise ValueError(
            f"Relation {RELATION_ID} timestamp changed: expected {RELATION_TIMESTAMP}, "
            f"found {relation.attrib.get('timestamp')}"
        )

    node_map = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in root.findall("node")
    }
    way_map = {
        way.attrib["id"]: [node.attrib["ref"] for node in way.findall("nd")]
        for way in root.findall("way")
    }
    ways = [
        way_map[member.attrib["ref"]]
        for member in relation.findall("member")
        if member.attrib.get("type") == "way" and member.attrib.get("ref") in way_map
    ]
    if not ways:
        raise ValueError(f"Relation {RELATION_ID} has no usable way members")
    return ways, node_map


def nearest_node(
    node_ids: set[str],
    node_map: dict[str, tuple[float, float]],
    target: tuple[float, float],
) -> tuple[str, float]:
    node_id = min(node_ids, key=lambda candidate: haversine_meters(node_map[candidate], target))
    return node_id, haversine_meters(node_map[node_id], target)


def relation_path(
    ways: list[list[str]],
    node_map: dict[str, tuple[float, float]],
    start: tuple[float, float],
    end: tuple[float, float],
) -> list[tuple[float, float]]:
    relation_nodes = {node_id for way in ways for node_id in way if node_id in node_map}
    start_node, start_gap = nearest_node(relation_nodes, node_map, start)
    end_node, end_gap = nearest_node(relation_nodes, node_map, end)
    if max(start_gap, end_gap) > MAX_ENDPOINT_GAP_METERS:
        raise ValueError(
            f"Relation endpoint is too far from a CDOT anchor: {max(start_gap, end_gap):.1f} m"
        )

    graph: dict[str, list[tuple[str, float]]] = {}
    for way in ways:
        for first, second in zip(way, way[1:]):
            if first not in node_map or second not in node_map:
                continue
            distance = haversine_meters(node_map[first], node_map[second])
            graph.setdefault(first, []).append((second, distance))
            graph.setdefault(second, []).append((first, distance))

    distances = {start_node: 0.0}
    previous: dict[str, str] = {}
    queue = [(0.0, start_node)]
    while queue:
        distance, node_id = heapq.heappop(queue)
        if distance != distances.get(node_id):
            continue
        if node_id == end_node:
            break
        for neighbor, edge_distance in graph.get(node_id, []):
            candidate = distance + edge_distance
            if candidate < distances.get(neighbor, math.inf):
                distances[neighbor] = candidate
                previous[neighbor] = node_id
                heapq.heappush(queue, (candidate, neighbor))

    if end_node not in distances:
        raise ValueError("No continuous I-70 relation path connects MM 259 to MM 274")

    path = [end_node]
    while path[-1] != start_node:
        path.append(previous[path[-1]])
    path.reverse()
    return [node_map[node_id] for node_id in path]


def extend_reference(
    reference: list[tuple[float, float]],
    ways: list[list[str]],
    node_map: dict[str, tuple[float, float]],
) -> list[tuple[float, float]]:
    prefix_end = min(
        range(len(reference)),
        key=lambda index: haversine_meters(reference[index], EXTENSION_START),
    )
    prefix_gap = haversine_meters(reference[prefix_end], EXTENSION_START)
    if prefix_gap > MAX_ENDPOINT_GAP_METERS:
        raise ValueError(f"Configured I-70 geometry misses CDOT MM 259 by {prefix_gap:.1f} m")

    prefix = reference[: prefix_end + 1]
    extension = relation_path(ways, node_map, prefix[-1], EXTENSION_END)
    join_gap = haversine_meters(prefix[-1], extension[0])
    if join_gap > MAX_JOIN_GAP_METERS:
        raise ValueError(f"I-70 extension has a {join_gap:.1f} m gap at MM 259")

    combined = prefix + (extension[1:] if join_gap < 1.0 else extension)
    segment_lengths = [
        haversine_meters(start, end)
        for start, end in zip(combined, combined[1:])
    ]
    if max(segment_lengths) > MAX_SEGMENT_METERS:
        raise ValueError(f"I-70 extension contains a {max(segment_lengths):.1f} m geometry jump")
    return combined


def main() -> None:
    args = parse_args()
    reference = read_reference(args.reference)
    ways, node_map = read_relation(args.source)
    extended = extend_reference(reference, ways, node_map)
    payload = {
        "type": "LineString",
        "coordinates": [[longitude, latitude] for longitude, latitude in extended],
    }
    args.reference.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
