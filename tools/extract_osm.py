#!/usr/bin/env python3
"""Build data/campus.json from OpenStreetMap extracts + USGS NED elevation.

Geometry, names, levels, materials, paths, trees, and lamps come from OSM.
Elevation comes from USGS NED 10m (OpenTopoData).
A few height/alias notes come from published JHU sources listed in SOURCES.
"""
from __future__ import annotations

import json
import math
import os
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "campus.json")
OSM_FILES = ["/tmp/jhu_map.json", "/tmp/jhu_west.json", "/tmp/jhu_north.json"]
ELEV_FILE = "/tmp/jhu_elev.json"

ORIGIN_LAT = 39.32900
ORIGIN_LON = -76.62050
M_LAT = 110947.2
M_LON = 111319.5 * math.cos(math.radians(ORIGIN_LAT))

LAT_MIN, LAT_MAX = 39.3246, 39.3352
LON_MIN, LON_MAX = -76.6262, -76.6160

LEVEL_OVERRIDES = {
    "Bloomberg Student Center": 4,  # Krieger Magazine, Nov 2025
    "Homewood Museum": 2,  # two-story Federal NHL villa
    # OSM tags this 1; JHU office listings include Mergenthaler 5xx.
    "Jenkins-Merganthaler Hall": 5,
    # JHU Engineering Magazine: three principal stories plus attic (OSM says 2).
    "Maryland Hall": 3,
}

ALIASES = {
    "Scott-Bates Commons": ["Charles Commons"],
    "The Charles": ["Charles Apartments"],
    "O'Connor Recreation Center": [
        "Ralph S. O'Connor Recreation Center",
        "Rec Center",
        "O'Connor",
    ],
    "Bloomberg Center": ["Bloomberg Center for Physics and Astronomy"],
    "White Athletic Center": ["Newton H. White, Jr. Athletic Center"],
    "Muller Building": ["Steven Muller Building", "STScI", "Space Telescope Science Institute"],
    "Milton S. Eisenhower Library": ["MSE Library", "MSEL", "Eisenhower Library", "the library"],
    "Jenkins-Merganthaler Hall": ["Jenkins Hall", "Mergenthaler Hall", "Jenkins-Mergenthaler Hall"],
    "Bloomberg Student Center": ["BSC", "Student Center", "Hopkins Student Center"],
    "Stavros Niarchos Foundation - Agora Institute": ["SNF Agora", "Agora Institute"],
    "Imagine Center for Integrative Learning": ["Imagine Center"],
    "AMR I": ["Alumni Memorial Residence I", "AMR 1"],
    "AMR II": ["Alumni Memorial Residence II", "AMR 2"],
    "AMR III Building A": ["AMR III", "Alumni Memorial Residence III"],
    "Gilman Hall": ["Gilman"],
    "Homewood Museum": ["Homewood House"],
    "Keyser Quad": ["Keyser Quadrangle", "Upper Quad"],
    "Wyman Quad": ["Wyman Quadrangle", "Lower Quad"],
    "Decker Quadrangle": ["Decker Quad"],
    "Johns Hopkins Beach": ["The Beach", "Hopkins Beach"],
    "Freshman Quad": ["AMR Quad"],
    "Olin Hall": ["Olin"],
    "Levering Hall": ["Levering"],
    "Shriver Hall": ["Shriver"],
}

NOTES = {
    "Gilman Hall": "Opened 1915. Georgian Revival after Homewood House. Clock tower rises 120 ft from the ground. Four floors; reads ~2.5 stories from Keyser because the lower floors sit into the slope. Faces Keyser Quad / Charles Street.",
    "Jenkins–Mergenthaler Hall": "Paired academic halls on the north side of Keyser Quad. OSM misspells Merganthaler; students say Jenkins or Mergenthaler.",
    "Maryland Hall": "Whiting School. First occupied academic building on Homewood (1914). Three principal stories plus attic.",
    "Milton S. Eisenhower Library": "Opened 1964. Reads as 1–2 stories from Keyser Quad; stacks continue underground. Connected to Brody.",
    "Brody Learning Commons": "Library addition connected to MSE below grade. Reading rooms, cafe, special collections.",
    "Homewood Museum": "Federal-style Homewood House (c. 1801). Palladian five-part plan, tetrastyle south portico, square cupola. Architectural model for the campus.",
    "Malone Hall": "Whiting School. Georgian brick on Decker Quad; glass facade toward the BMA woods.",
    "Mason Hall": "Visitor and admissions center on Decker Quadrangle (2008).",
    "Hackerman Hall": "Computational sciences, Decker Quadrangle (2008).",
    "Bloomberg Student Center": "Opened 2025 on the former Mattin Center / Whitehead Hall site. Four stories.",
    "Keyser Quad": "2.44-acre academic lawn. Bounded by Gilman, Ames, Krieger, Jenkins–Mergenthaler, Remsen, and MSE Library.",
    "Wyman Quad": "North–south academic quad south of Keyser, part of the original T-plan.",
    "Decker Quadrangle": "West entrance quad: Mason, Malone, Hackerman, Garland.",
    "Freshman Quad": "Residential lawn by the Alumni Memorial Residences.",
    "Homewood Field": "Lacrosse / football. Schelle Pavilion on the west stand.",
    "Whitehead Hall": "Demolished 2021 for the Bloomberg Student Center; not present.",
}

DISPLAY_FIX = {
    "Jenkins-Merganthaler Hall": "Jenkins–Mergenthaler Hall",
}

KEEP_BUILDING = {
    "university",
    "dormitory",
    "library",
    "apartments",
    "parking",
    "industrial",
    "church",
    "synagogue",
    "museum",
    "sports_centre",
    "office",
    "retail",
    "roof",
    "construction",
    "yes",
    "service",
    "guardhouse",
}

SKIP_BUILDING = {"house", "detached", "terrace", "hut", "shed", "garage", "carport", "bungalow"}


def project(lat, lon):
    x = (lon - ORIGIN_LON) * M_LON
    z = (ORIGIN_LAT - lat) * M_LAT
    return round(x, 2), round(z, 2)


def in_bbox(lat, lon):
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    ax, az = pts[0]
    bx, bz = pts[-1]
    dx, dz = bx - ax, bz - az
    den = dx * dx + dz * dz or 1.0
    maxd = -1
    idx = 0
    for i in range(1, len(pts) - 1):
        px, pz = pts[i]
        t = ((px - ax) * dx + (pz - az) * dz) / den
        t = 0 if t < 0 else 1 if t > 1 else t
        mx, mz = ax + t * dx, az + t * dz
        d = (px - mx) ** 2 + (pz - mz) ** 2
        if d > maxd:
            maxd = d
            idx = i
    if maxd > eps * eps:
        left = rdp(pts[: idx + 1], eps)
        right = rdp(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def close_ring(pts):
    if len(pts) < 3:
        return pts
    out = list(pts)
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def shoelace(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return a * 0.5


def ccw(pts):
    pts = close_ring(pts)
    if abs(shoelace(pts)) < 1e-6:
        return pts
    if shoelace(pts) < 0:
        pts = list(reversed(pts))
    return pts


def cw(pts):
    pts = close_ring(pts)
    if shoelace(pts) > 0:
        pts = list(reversed(pts))
    return pts


def centroid(pts):
    pts = close_ring(pts)
    a = shoelace(pts)
    if abs(a) < 1e-6:
        xs = [p[0] for p in pts[:-1]]
        zs = [p[1] for p in pts[:-1]]
        return sum(xs) / len(xs), sum(zs) / len(zs)
    cx = cz = 0.0
    for i in range(len(pts) - 1):
        cross = pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
        cx += (pts[i][0] + pts[i + 1][0]) * cross
        cz += (pts[i][1] + pts[i + 1][1]) * cross
    return cx / (6 * a), cz / (6 * a)


def drop_close(pts, min_d=0.6):
    if not pts:
        return pts
    out = [pts[0]]
    for p in pts[1:]:
        dx = p[0] - out[-1][0]
        dz = p[1] - out[-1][1]
        if dx * dx + dz * dz >= min_d * min_d:
            out.append(p)
    return out


def load_osm():
    seen = set()
    nodes, ways, rels = {}, {}, {}
    for path in OSM_FILES:
        with open(path) as f:
            data = json.load(f)
        for e in data["elements"]:
            k = (e["type"], e["id"])
            if k in seen:
                continue
            seen.add(k)
            if e["type"] == "node":
                nodes[e["id"]] = e
            elif e["type"] == "way":
                ways[e["id"]] = e
            elif e["type"] == "relation":
                rels[e["id"]] = e
    return nodes, ways, rels


def way_ll(way, nodes):
    pts = []
    for nid in way.get("nodes") or []:
        n = nodes.get(nid)
        if n and "lat" in n:
            pts.append((n["lat"], n["lon"]))
    return pts


def way_xz(way, nodes):
    return [project(lat, lon) for lat, lon in way_ll(way, nodes)]


def assemble_rings(members, ways, nodes, role):
    segs = []
    for m in members:
        if m.get("role") != role or m.get("type") != "way":
            continue
        w = ways.get(m["ref"])
        if not w:
            continue
        pts = way_xz(w, nodes)
        if len(pts) >= 2:
            segs.append(pts)
    rings = []
    unused = segs[:]
    while unused:
        ring = unused.pop(0)
        changed = True
        while changed:
            changed = False
            for i, seg in enumerate(unused):
                if ring[-1] == seg[0]:
                    ring += seg[1:]
                    unused.pop(i)
                    changed = True
                    break
                if ring[-1] == seg[-1]:
                    ring += list(reversed(seg[:-1]))
                    unused.pop(i)
                    changed = True
                    break
                if ring[0] == seg[-1]:
                    ring = seg + ring[1:]
                    unused.pop(i)
                    changed = True
                    break
                if ring[0] == seg[0]:
                    ring = list(reversed(seg)) + ring[1:]
                    unused.pop(i)
                    changed = True
                    break
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def keep_named_or_campus(tags, lat, lon):
    if not in_bbox(lat, lon):
        return False
    b = tags.get("building")
    name = tags.get("name")
    op = (tags.get("operator") or "") + (tags.get("operator:short") or "")
    if b in SKIP_BUILDING and not name:
        return False
    if name:
        return True
    if "Johns Hopkins" in op or "JHU" in op:
        return True
    if b in ("university", "dormitory", "library", "parking"):
        return True
    if tags.get("amenity") in ("university", "library", "parking"):
        return True
    if tags.get("landuse") == "construction":
        return True
    if b and lon <= -76.6186 and b in KEEP_BUILDING:
        return True
    return False


def special_for(name, tags):
    n = name or ""
    if n == "Gilman Hall":
        return "gilman"
    if tags.get("building") == "roof" or n == "The Breezeway":
        return "canopy"
    if n == "Homewood Museum":
        return "homewood"
    if n == "Malone Hall":
        return "malone"
    if n == "Milton S. Eisenhower Library":
        return "library"
    if n == "Bloomberg Student Center":
        return "studentcenter"
    if n == "Glass Pavilion" or tags.get("building:material") == "glass":
        return "glass"
    if n.startswith("Stavros") or "Agora" in n:
        return "modern"
    if n == "Bloomberg Center":
        return "physics"
    if tags.get("building") == "dormitory" or n.startswith("AMR") or n in (
        "Wolman Hall",
        "McCoy Hall",
        "Scott-Bates Commons",
        "The Charles",
        "The Study at Johns Hopkins",
    ):
        return "dorm"
    if tags.get("building") == "parking" or "Garage" in n:
        return "garage"
    if tags.get("landuse") == "construction" or tags.get("building") == "construction":
        return "construction"
    if tags.get("location") == "underground":
        return "underground"
    if tags.get("building") in ("church", "synagogue") or tags.get("amenity") == "place_of_worship":
        return "church"
    if n in ("Homewood Power Plant",) or tags.get("building") == "industrial":
        return "industrial"
    return "georgian"


def parse_levels(tags, name):
    if name in LEVEL_OVERRIDES:
        return LEVEL_OVERRIDES[name], "jhu-publication"
    raw = tags.get("building:levels")
    if raw:
        try:
            return float(raw), "osm:building:levels"
        except ValueError:
            pass
    h = tags.get("height")
    if h:
        try:
            meters = float(str(h).replace("m", "").strip())
            return meters / 3.6, "osm:height"
        except ValueError:
            pass
    return None, None


def main():
    nodes, ways, rels = load_osm()
    elev_raw = json.load(open(ELEV_FILE))
    elev_pts = []
    for r in elev_raw:
        loc = r.get("location") or {}
        if r.get("elevation") is None:
            continue
        x, z = project(loc["lat"], loc["lng"])
        elev_pts.append([x, z, round(r["elevation"], 2)])

    buildings = []
    seen_b = set()

    def add_building(oid, tags, outer, holes):
        if oid in seen_b or len(outer) < 4:
            return
        outer = ccw(drop_close(rdp(close_ring(outer), 0.7)))
        if len(outer) < 4:
            return
        holes_out = []
        for h in holes:
            hh = cw(drop_close(rdp(close_ring(h), 0.7)))
            if len(hh) >= 4:
                holes_out.append(hh[:-1] if hh[0] == hh[-1] else hh)
        ring = outer[:-1] if outer[0] == outer[-1] else outer
        cx, cz = centroid(outer)
        lat = ORIGIN_LAT - cz / M_LAT
        lon = ORIGIN_LON + cx / M_LON
        name = tags.get("name")
        if not keep_named_or_campus(tags, lat, lon):
            return
        if tags.get("location") == "underground":
            return
        levels, src = parse_levels(tags, name)
        roof_levels = tags.get("roof:levels")
        try:
            roof_levels = float(roof_levels) if roof_levels is not None else 0
        except ValueError:
            roof_levels = 0
        disp = DISPLAY_FIX.get(name, name)
        b = {
            "id": oid,
            "name": disp,
            "official": tags.get("official_name"),
            "kind": tags.get("building") or tags.get("amenity") or "yes",
            "levels": levels,
            "levelSrc": src,
            "roofLevels": roof_levels or None,
            "material": tags.get("building:material"),
            "colour": tags.get("building:colour"),
            "roofShape": tags.get("roof:shape"),
            "roofMaterial": tags.get("roof:material"),
            "roofColour": tags.get("roof:colour"),
            "poly": ring,
            "holes": holes_out,
            "cx": round(cx, 2),
            "cz": round(cz, 2),
            "special": special_for(name, tags),
            "aliases": ALIASES.get(name) or ALIASES.get(disp),
            "note": NOTES.get(name) or NOTES.get(disp),
            "addr": " ".join(
                p
                for p in (
                    tags.get("addr:housenumber"),
                    tags.get("addr:street"),
                )
                if p
            )
            or None,
        }
        buildings.append({k: v for k, v in b.items() if v not in (None, [], "")})
        seen_b.add(oid)

    for wid, w in ways.items():
        tags = w.get("tags") or {}
        if not tags.get("building"):
            if tags.get("landuse") == "construction" and tags.get("name"):
                tags = dict(tags)
                tags["building"] = "construction"
            else:
                continue
        pts = way_xz(w, nodes)
        if len(pts) >= 4:
            add_building(f"way/{wid}", tags, pts, [])

    for rid, r in rels.items():
        tags = r.get("tags") or {}
        if tags.get("building"):
            outers = assemble_rings(r.get("members") or [], ways, nodes, "outer")
            inners = assemble_rings(r.get("members") or [], ways, nodes, "inner")
            if outers:
                add_building(f"rel/{rid}", tags, outers[0], inners + outers[1:])

    bnames = {b.get("name") for b in buildings if b.get("name")}
    areas = []

    def add_area(tags, poly):
        if len(poly) < 4:
            return
        poly = ccw(drop_close(rdp(close_ring(poly), 1.2)))
        ring = poly[:-1] if poly[0] == poly[-1] else poly
        cx, cz = centroid(poly)
        lat = ORIGIN_LAT - cz / M_LAT
        lon = ORIGIN_LON + cx / M_LON
        if not in_bbox(lat, lon) and not tags.get("name"):
            return
        kind = None
        if tags.get("name") in (
            "Keyser Quad",
            "Wyman Quad",
            "Decker Quadrangle",
            "Freshman Quad",
            "Decker Garden",
            "Homewood Square",
            "Johns Hopkins Beach",
        ):
            kind = "quad"
        elif tags.get("leisure") == "pitch":
            kind = "pitch"
        elif tags.get("leisure") == "track":
            kind = "track"
        elif tags.get("leisure") == "bleachers":
            kind = "bleachers"
        elif tags.get("leisure") == "garden":
            kind = "garden"
        elif tags.get("natural") == "wood":
            kind = "wood"
        elif tags.get("natural") == "water" or tags.get("waterway"):
            kind = "water"
        elif tags.get("landuse") == "construction":
            nm = tags.get("name")
            if nm and nm in bnames and nm != "Johns Hopkins Data Science and AI Institute":
                return
            kind = "construction"
        elif tags.get("leisure") == "park" or tags.get("landuse") in ("grass", "forest") or tags.get("place") == "square":
            kind = "green"
        if not kind:
            return
        rec = {
            "name": tags.get("name") or tags.get("official_name"),
            "kind": kind,
            "sport": tags.get("sport"),
            "surface": tags.get("surface"),
            "poly": ring,
            "cx": round(cx, 2),
            "cz": round(cz, 2),
        }
        if rec["name"] in ALIASES:
            rec["aliases"] = ALIASES[rec["name"]]
        areas.append({k: v for k, v in rec.items() if v not in (None, "")})

    for w in ways.values():
        tags = w.get("tags") or {}
        add_area(tags, way_xz(w, nodes))
    for r in rels.values():
        tags = r.get("tags") or {}
        rings = assemble_rings(r.get("members") or [], ways, nodes, "outer")
        if rings:
            add_area(tags, rings[0])

    paths = []
    for w in ways.values():
        tags = w.get("tags") or {}
        hw = tags.get("highway")
        if hw not in (
            "footway",
            "path",
            "steps",
            "pedestrian",
            "service",
            "residential",
            "primary",
            "tertiary",
            "unclassified",
            "cycleway",
        ):
            continue
        ll = way_ll(w, nodes)
        if not ll or not any(in_bbox(a, b) for a, b in ll):
            continue
        pts = drop_close(rdp([project(a, b) for a, b in ll], 1.4 if hw != "steps" else 0.8), 0.8)
        if len(pts) < 2:
            continue
        kind = "foot"
        if hw == "steps":
            kind = "steps"
        elif hw in ("primary", "residential", "tertiary", "unclassified", "service"):
            kind = "road"
        rec = {
            "kind": kind,
            "highway": hw,
            "name": tags.get("name"),
            "surface": tags.get("surface"),
            "pts": pts,
        }
        paths.append({k: v for k, v in rec.items() if v not in (None, "")})

    trees, lamps, art, pois = [], [], [], []
    for n in nodes.values():
        tags = n.get("tags") or {}
        if "lat" not in n or not in_bbox(n["lat"], n["lon"]):
            continue
        x, z = project(n["lat"], n["lon"])
        if tags.get("natural") == "tree":
            trees.append([x, z])
        if tags.get("highway") == "street_lamp":
            lamps.append([x, z])
        if tags.get("tourism") == "artwork" and tags.get("name"):
            art.append({"name": tags["name"], "x": x, "z": z})
        amenity = tags.get("amenity")
        if amenity in ("cafe", "restaurant", "fast_food", "bar", "library", "atm") and tags.get("name"):
            pois.append({"name": tags["name"], "kind": amenity, "x": x, "z": z})

    for w in ways.values():
        tags = w.get("tags") or {}
        if tags.get("natural") == "tree_row":
            pts = way_xz(w, nodes)
            for i in range(0, len(pts), 2):
                trees.append([pts[i][0], pts[i][1]])

    street_pts = defaultdict(list)
    for p in paths:
        if p.get("name") and p.get("kind") == "road":
            street_pts[p["name"]].extend(p["pts"])
    streets = []
    for name, pts in street_pts.items():
        if len(pts) < 4:
            continue
        streets.append(
            {
                "name": name,
                "x": round(sum(pt[0] for pt in pts) / len(pts), 2),
                "z": round(sum(pt[1] for pt in pts) / len(pts), 2),
            }
        )

    keyser = next((a for a in areas if a.get("name") == "Keyser Quad"), None)
    gilman = next((b for b in buildings if b.get("name") == "Gilman Hall"), None)
    spawn = None
    if keyser and gilman:
        spawn = {
            "x": keyser["cx"],
            "z": keyser["cz"],
            "lookX": gilman["cx"],
            "lookZ": gilman["cz"],
            "from": "Keyser Quadrangle",
        }
    elif gilman:
        spawn = {
            "x": gilman["cx"] + 80,
            "z": gilman["cz"],
            "lookX": gilman["cx"],
            "lookZ": gilman["cz"],
            "from": "east-of-Gilman",
        }

    campus = {
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "bbox": {"latMin": LAT_MIN, "latMax": LAT_MAX, "lonMin": LON_MIN, "lonMax": LON_MAX},
        "spawn": spawn or {"x": 0, "z": 0, "lookX": -90, "lookZ": 0, "from": "origin"},
        "elev": {"points": elev_pts, "source": "USGS NED 10m via OpenTopoData"},
        "buildings": buildings,
        "areas": areas,
        "paths": paths,
        "trees": trees,
        "lamps": lamps,
        "art": art,
        "pois": pois,
        "streets": streets,
        "notes": NOTES,
        "sources": [
            "OpenStreetMap (building footprints, paths, trees, lamps, named quads) — OSM contributors",
            "USGS NED 10m elevation via OpenTopoData",
            "JHU Homewood campus maps / building directory (jhfre.jhu.edu, jhu.edu maps)",
            "TCLF: Keyser/Wyman T-plan; Gilman on west edge of Keyser Quad",
            "Johns Hopkins Magazine (Feb 2006): Gilman clock tower 120 ft from ground; four floors, ~2.5 stories from Keyser; Georgian after Homewood; portico",
            "SAH Archipedia / JHU Museums: Homewood House Federal Palladian five-part plan, tetrastyle south portico, square cupola",
            "JHU Engineering Magazine: Maryland Hall three principal stories plus attic (1914)",
            "Hub / Krieger Magazine: Malone Hall glass/Georgian split; Bloomberg Student Center four stories (2025); Whitehead Hall demolished 2021",
            "News-Letter: MSE Library low profile with underground stacks; Brody connection",
        ],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(campus, f, separators=(",", ":"))
    print("buildings", len(buildings), "named", sum(1 for b in buildings if b.get("name")))
    print("areas", len(areas), "paths", len(paths), "trees", len(trees), "lamps", len(lamps))
    print("art", len(art), "pois", len(pois), "elev", len(elev_pts), "streets", len(streets))
    print("spawn", spawn)
    print("json bytes", os.path.getsize(OUT))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
