"""Build the Melbourne TVs service-area dataset from Victorian Government boundaries.

The output intentionally distinguishes the broad Plan Melbourne service inventory from
the smaller set of launch pages.  Remote, restricted and very low-density localities
remain present for dispatch decisions but are not recommended as indexed landing pages.
"""

from __future__ import annotations

import csv
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import requests


OUTPUT_DIR = Path(__file__).resolve().parent
WFS_URL = "https://opendata.maps.vic.gov.au/geoserver/wfs"
LOCALITY_DATASET_URL = (
    "https://discover.data.vic.gov.au/dataset/"
    "vicmap-admin-locality-polygon-aligned-to-property"
)
PLANNING_REGIONS_URL = (
    "https://www.planning.vic.gov.au/guides-and-resources/"
    "Data-spatial-and-insights/discover-and-access-planning-open-data/"
    "victoria-in-future"
)

CBD = (144.9631, -37.8136)

REGION_LGAS = {
    "Inner Metropolitan": {"MELBOURNE", "PORT PHILLIP", "YARRA"},
    "Inner South East": {"BAYSIDE", "BOROONDARA", "GLEN EIRA", "STONNINGTON"},
    "Western": {
        "BRIMBANK",
        "HOBSONS BAY",
        "MARIBYRNONG",
        "MELTON",
        "MOONEE VALLEY",
        "WYNDHAM",
    },
    "Northern": {
        "BANYULE",
        "DAREBIN",
        "HUME",
        "MERRI-BEK",
        "MITCHELL",
        "NILLUMBIK",
        "WHITTLESEA",
    },
    "Eastern": {"KNOX", "MANNINGHAM", "MAROONDAH", "MONASH", "WHITEHORSE", "YARRA RANGES"},
    "Southern": {
        "CARDINIA",
        "CASEY",
        "FRANKSTON",
        "GREATER DANDENONG",
        "KINGSTON",
        "MORNINGTON PENINSULA",
    },
}

LGA_TO_REGION = {
    lga: region for region, lgas in REGION_LGAS.items() for lga in lgas
}

LGA_TO_ZONE = {
    "MELBOURNE": "Central & Inner",
    "PORT PHILLIP": "Central & Inner",
    "YARRA": "Central & Inner",
    "MERRI-BEK": "Inner North",
    "DAREBIN": "Inner North",
    "BANYULE": "Inner North",
    "BOROONDARA": "Inner East",
    "WHITEHORSE": "Inner East",
    "MANNINGHAM": "Inner East",
    "STONNINGTON": "Bayside & Inner South-East",
    "GLEN EIRA": "Bayside & Inner South-East",
    "BAYSIDE": "Bayside & Inner South-East",
    "KINGSTON": "Bayside & Inner South-East",
    "MONASH": "Bayside & Inner South-East",
    "HUME": "North & Airport",
    "WHITTLESEA": "North & Airport",
    "NILLUMBIK": "North & Airport",
    "MITCHELL": "North & Airport",
    "MARIBYRNONG": "West & North-West",
    "MOONEE VALLEY": "West & North-West",
    "BRIMBANK": "West & North-West",
    "HOBSONS BAY": "West & North-West",
    "WYNDHAM": "West & North-West",
    "MELTON": "West & North-West",
    "KNOX": "East & Dandenong Ranges",
    "MAROONDAH": "East & Dandenong Ranges",
    "YARRA RANGES": "East & Dandenong Ranges",
    "GREATER DANDENONG": "South-East Growth Corridor",
    "CASEY": "South-East Growth Corridor",
    "CARDINIA": "South-East Growth Corridor",
    "FRANKSTON": "Frankston & Mornington Peninsula",
    "MORNINGTON PENINSULA": "Frankston & Mornington Peninsula",
}

PROPERTY_CONTEXT = {
    "MELBOURNE": "apartments, converted warehouses and compact terraces, often with owners-corporation access rules",
    "PORT PHILLIP": "apartments, Victorian terraces and renovated bayside homes",
    "YARRA": "Victorian terraces, warehouse conversions and newer infill apartments",
    "MERRI-BEK": "period cottages, brick homes and a growing stock of townhouses and apartments",
    "DAREBIN": "Californian bungalows, post-war brick homes and townhouse infill",
    "BANYULE": "post-war brick homes, sloping blocks and newer family townhouses",
    "BOROONDARA": "period homes, double-brick houses and substantial renovations",
    "WHITEHORSE": "post-war brick veneer homes, units and newer townhouses",
    "MANNINGHAM": "larger family homes, sloping blocks and multi-level renovations",
    "STONNINGTON": "period homes, apartments and high-spec renovations",
    "GLEN EIRA": "brick units, period homes and medium-density infill",
    "BAYSIDE": "renovated detached homes, townhouses and bayside apartments",
    "KINGSTON": "post-war houses, units and newer townhouses near the bay and employment areas",
    "MONASH": "brick veneer family homes, units and modern townhouse development",
    "HUME": "new-estate family homes, established brick houses and airport-adjacent commercial property",
    "WHITTLESEA": "fast-growing estates alongside established post-war suburbs",
    "NILLUMBIK": "larger homes on treed or sloping blocks, with some semi-rural properties",
    "MITCHELL": "new growth-area homes and established township housing",
    "MARIBYRNONG": "period cottages, townhouses, apartments and warehouse conversions",
    "MOONEE VALLEY": "period family homes, brick units and apartment pockets",
    "BRIMBANK": "established brick homes, renovations and newer infill housing",
    "HOBSONS BAY": "period workers cottages, renovated bayside homes and townhouses",
    "WYNDHAM": "large new-estate housing areas mixed with established homes around Werribee",
    "MELTON": "rapidly expanding estates, newer plasterboard construction and established township homes",
    "KNOX": "post-war family homes, split-level houses and townhouse infill near the foothills",
    "MAROONDAH": "established family homes, units and properties on gently sloping, well-treed streets",
    "YARRA RANGES": "hills homes, weatherboard houses, acreage and established outer-eastern estates",
    "GREATER DANDENONG": "brick homes, units, newer townhouses and commercial premises",
    "CASEY": "major new-estate growth mixed with established family suburbs",
    "CARDINIA": "new growth-corridor estates, township homes and rural-edge properties",
    "FRANKSTON": "established coastal-suburban homes, units and ongoing renovation stock",
    "MORNINGTON PENINSULA": "coastal homes, holiday properties, acreage and established township housing",
}

ZONE_ACCESS = {
    "Central & Inner": "Confirm loading, visitor parking, lift dimensions and owners-corporation booking rules before dispatch.",
    "Inner North": "Allow for narrow residential streets and older masonry walls; ask for a parking photo when access is tight.",
    "Inner East": "Check wall construction and fireplace or cabinetry details; many jobs suit longer, finish-focused appointments.",
    "Bayside & Inner South-East": "Group jobs along the bay or major north-south corridors and confirm apartment access before arrival.",
    "North & Airport": "Cluster appointments by corridor; outer and semi-rural addresses need a travel window and driveway/access check.",
    "West & North-West": "Cluster by freeway corridor and avoid cross-city scheduling at peak times; new estates may need precise map pins.",
    "East & Dandenong Ranges": "Allow extra time for hills, winding roads, steep driveways and weather-sensitive access on outer jobs.",
    "South-East Growth Corridor": "Batch by Monash/Princes corridor; new estates can have incomplete mapping and active construction access.",
    "Frankston & Mornington Peninsula": "Run peninsula days by direction, confirm travel surcharge before booking, and check gated or holiday-property access.",
}

ZONE_LOCALITY_FRAME = {
    "Central & Inner": "an inner-Melbourne location with dense streets, mixed residential forms and strong tram or rail access",
    "Inner North": "part of Melbourne's established inner-north and north-east suburban belt",
    "Inner East": "within Melbourne's established, well-treed eastern residential belt",
    "Bayside & Inner South-East": "within the established south-eastern and bayside suburban belt",
    "North & Airport": "within Melbourne's northern corridor, where established suburbs transition to fast-growth and semi-rural areas",
    "West & North-West": "within Melbourne's western and north-western corridor, spanning established suburbs and major growth areas",
    "East & Dandenong Ranges": "within the outer-east and Dandenong Ranges catchment, where terrain and tree cover shape access",
    "South-East Growth Corridor": "within the Dandenong, Casey and Cardinia corridor, one of Melbourne's major suburban growth fronts",
    "Frankston & Mornington Peninsula": "within the Frankston and Mornington Peninsula catchment between Port Phillip and Western Port",
}

DISPLAY_OVERRIDES = {
    "Hmas Cerberus": "HMAS Cerberus",
    "Mccrae": "McCrae",
    "Mckinnon": "McKinnon",
    "Mcmahons Creek": "McMahons Creek",
    "Koo Wee Rup": "Koo Wee Rup",
    "Koo Wee Rup North": "Koo Wee Rup North",
}

# These are high-demand hubs that should not be demoted solely because they are
# farther from the CBD.  They are Tier 2, not a promise of same-day coverage.
GROWTH_AND_OUTER_HUBS = {
    "Aintree",
    "Beaconsfield",
    "Berwick",
    "Beveridge",
    "Botanic Ridge",
    "Caroline Springs",
    "Chirnside Park",
    "Clyde",
    "Clyde North",
    "Cobblebank",
    "Craigieburn",
    "Cranbourne",
    "Cranbourne East",
    "Cranbourne North",
    "Cranbourne West",
    "Deanside",
    "Doreen",
    "Epping",
    "Fraser Rise",
    "Greenvale",
    "Hampton Park",
    "Hoppers Crossing",
    "Lilydale",
    "Manor Lakes",
    "Melton",
    "Melton South",
    "Melton West",
    "Mernda",
    "Mickleham",
    "Narre Warren",
    "Narre Warren North",
    "Narre Warren South",
    "Officer",
    "Pakenham",
    "Point Cook",
    "Rockbank",
    "Roxburgh Park",
    "South Morang",
    "Sunbury",
    "Tarneit",
    "Thornhill Park",
    "Truganina",
    "Wallan",
    "Werribee",
    "Williams Landing",
    "Wollert",
    "Wyndham Vale",
}

TIER_1_HUBS = {
    "Abbotsford",
    "Balwyn",
    "Bayswater",
    "Bentleigh",
    "Berwick",
    "Boronia",
    "Box Hill",
    "Brighton",
    "Brunswick",
    "Burwood",
    "Camberwell",
    "Carlton",
    "Carnegie",
    "Caroline Springs",
    "Chadstone",
    "Cheltenham",
    "Clyde North",
    "Coburg",
    "Collingwood",
    "Craigieburn",
    "Cranbourne",
    "Croydon",
    "Dandenong",
    "Doncaster",
    "Docklands",
    "Endeavour Hills",
    "Epping",
    "Essendon",
    "Fitzroy",
    "Footscray",
    "Frankston",
    "Glen Waverley",
    "Hampton Park",
    "Hawthorn",
    "Hoppers Crossing",
    "Kew",
    "Keysborough",
    "Lilydale",
    "Maribyrnong",
    "Melbourne",
    "Melton",
    "Mernda",
    "Moonee Ponds",
    "Moorabbin",
    "Mornington",
    "Mount Waverley",
    "Narre Warren",
    "Newport",
    "Northcote",
    "Oakleigh",
    "Officer",
    "Pakenham",
    "Point Cook",
    "Port Melbourne",
    "Preston",
    "Richmond",
    "Ringwood",
    "Rosebud",
    "Rowville",
    "South Morang",
    "South Yarra",
    "Southbank",
    "Springvale",
    "St Kilda",
    "Sunbury",
    "Tarneit",
    "Truganina",
    "Wantirna",
    "Werribee",
    "Williams Landing",
    "Williamstown",
    "Wollert",
    "Wyndham Vale",
    "Yarraville",
}

REGIONAL_ANCHORS = {
    "MELBOURNE": ["Melbourne CBD", "Docklands", "Royal Park"],
    "PORT PHILLIP": ["Port Phillip Bay foreshore", "Albert Park", "St Kilda Road corridor"],
    "YARRA": ["Yarra River", "Merri Creek", "Brunswick Street and Smith Street corridors"],
    "MERRI-BEK": ["Sydney Road", "Upfield rail corridor", "Merri Creek"],
    "DAREBIN": ["High Street corridor", "Darebin Creek", "Preston and Reservoir activity centres"],
    "BANYULE": ["Yarra River", "Plenty River", "Heidelberg and Greensborough activity centres"],
    "BOROONDARA": ["Yarra River", "Gardiners Creek", "Camberwell Junction"],
    "WHITEHORSE": ["Box Hill", "Belgrave and Lilydale rail corridors", "Gardiners Creek"],
    "MANNINGHAM": ["Yarra River", "Eastern Freeway", "Doncaster and Templestowe activity centres"],
    "STONNINGTON": ["Chapel Street", "Glenferrie Road", "Gardiners Creek"],
    "GLEN EIRA": ["Caulfield", "Carnegie", "Elsternwick"],
    "BAYSIDE": ["Port Phillip Bay foreshore", "Nepean Highway", "Sandringham rail corridor"],
    "KINGSTON": ["Port Phillip Bay", "Nepean Highway and Frankston rail corridor", "Moorabbin and Dingley employment areas"],
    "MONASH": ["Monash Freeway", "Glen Waverley", "Clayton and Oakleigh activity centres"],
    "HUME": ["Hume Freeway", "Melbourne Airport", "Broadmeadows, Craigieburn and Sunbury"],
    "WHITTLESEA": ["Plenty Road", "Mernda rail corridor", "Epping, South Morang and Mernda"],
    "NILLUMBIK": ["Diamond Creek", "Eltham", "Yarra and Plenty river catchments"],
    "MITCHELL": ["Hume Freeway", "Wallan", "Beveridge growth corridor"],
    "MARIBYRNONG": ["Maribyrnong River", "Footscray", "Highpoint"],
    "MOONEE VALLEY": ["Moonee Ponds", "Essendon", "Maribyrnong River"],
    "BRIMBANK": ["Sunshine", "St Albans", "Western Ring Road and Calder corridors"],
    "HOBSONS BAY": ["Port Phillip Bay", "Williamstown and Altona", "West Gate Freeway"],
    "WYNDHAM": ["Princes Freeway", "Werribee River", "Point Cook and Werribee growth areas"],
    "MELTON": ["Western Freeway", "Melton and Cobblebank", "western growth corridor"],
    "KNOX": ["Dandenong Creek", "Burwood Highway", "Dandenong Ranges foothills"],
    "MAROONDAH": ["Ringwood", "Mullum Mullum Creek", "Lilydale and Belgrave rail corridors"],
    "YARRA RANGES": ["Yarra Valley", "Dandenong Ranges", "Warburton Highway corridor"],
    "GREATER DANDENONG": ["Dandenong CBD", "Princes Highway and Monash Freeway", "south-east employment precincts"],
    "CASEY": ["Princes Freeway", "Cranbourne", "Narre Warren and Berwick growth corridor"],
    "CARDINIA": ["Princes Freeway", "Pakenham and Officer", "Western Port rural townships"],
    "FRANKSTON": ["Frankston city centre", "Port Phillip Bay", "Peninsula Link"],
    "MORNINGTON PENINSULA": ["Port Phillip and Western Port", "Peninsula Freeway", "coastal townships"],
}

RESTRICTED_OR_NON_RESIDENTIAL = {
    "Calder Park",
    "Cocoroc",
    "Essendon Fields",
    "HMAS Cerberus",
    "Melbourne Airport",
    "Moorabbin Airport",
    "Point Wilson",
    "South Wharf",
}

REMOTE_LOCALITIES = {
    "Ada",
    "Big Pats Creek",
    "Cambarville",
    "Don Valley",
    "East Warburton",
    "Fernshaw",
    "Gilderoy",
    "Jericho",
    "Loch Valley",
    "Matlock",
    "McMahons Creek",
    "Powelltown",
    "Reefton",
    "Three Bridges",
    "Toorongo",
    "Woods Point",
}


def fetch_layer(layer: str, fields: str) -> list[dict]:
    response = requests.get(
        WFS_URL,
        params={
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": f"open-data-platform:{layer}",
            "propertyName": fields,
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
        },
        timeout=240,
    )
    response.raise_for_status()
    return response.json()["features"]


def exterior_rings(geometry: dict | None) -> list[list[list[float]]]:
    if not geometry:
        return []
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"][0]]
    if geometry["type"] == "MultiPolygon":
        return [polygon[0] for polygon in geometry["coordinates"]]
    return []


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    area = x_sum = y_sum = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        cross = x1 * y2 - x2 * y1
        area += cross
        x_sum += (x1 + x2) * cross
        y_sum += (y1 + y2) * cross
    if abs(area) < 1e-12:
        return tuple(ring[0])  # type: ignore[return-value]
    return x_sum / (3 * area), y_sum / (3 * area)


def geometry_centroid(geometry: dict) -> tuple[float, float]:
    rings = exterior_rings(geometry)
    if not rings:
        raise ValueError("Geometry has no polygon exterior")
    return ring_centroid(max(rings, key=len))


def bbox(ring: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [point[0] for point in ring]
    ys = [point[1] for point in ring]
    return min(xs), min(ys), max(xs), max(ys)


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    previous = len(ring) - 1
    for current, (x1, y1) in enumerate(ring):
        x2, y2 = ring[previous]
        if ((y1 > y) != (y2 > y)) and x < (x2 - x1) * (y - y1) / (y2 - y1 or 1e-300) + x1:
            inside = not inside
        previous = current
    return inside


def point_in_feature(point: tuple[float, float], feature: dict) -> bool:
    for ring in exterior_rings(feature["geometry"]):
        left, bottom, right, top = bbox(ring)
        if left <= point[0] <= right and bottom <= point[1] <= top and point_in_ring(point, ring):
            return True
    return False


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(value))


def display_name(official: str) -> str:
    name = official.title().replace(" (Greater Melbourne)", "")
    return DISPLAY_OVERRIDES.get(name, name)


def slugify(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def priority_for(name: str, lga: str, distance: float) -> int:
    if name in RESTRICTED_OR_NON_RESIDENTIAL or name in REMOTE_LOCALITIES:
        return 4
    if name in TIER_1_HUBS:
        return 1
    if name in GROWTH_AND_OUTER_HUBS:
        return 2
    if distance <= 32:
        return 2
    if distance <= 65:
        return 3
    return 4


def property_type(name: str, lga: str, priority: int) -> str:
    if name in RESTRICTED_OR_NON_RESIDENTIAL:
        return "restricted, institutional or mainly non-residential locality"
    if lga in {"YARRA RANGES", "NILLUMBIK"} and priority >= 3:
        return "hills, rural-residential or township properties"
    if lga in {"MORNINGTON PENINSULA"}:
        return "coastal, township or rural-residential properties"
    if lga in {"MELTON", "WYNDHAM", "HUME", "WHITTLESEA", "CASEY", "CARDINIA", "MITCHELL"}:
        return "growth-area, established suburban or township homes"
    return "established suburban and infill housing"


def main() -> None:
    locality_features = fetch_layer("locality_polygon", "locality_name,geom")
    lga_features = fetch_layer("lga_polygon", "lga_name,lga_official_name,geom")
    metro_lgas = set(LGA_TO_REGION)

    lga_geometries = []
    for feature in lga_features:
        lga = feature["properties"]["lga_name"]
        if lga in metro_lgas:
            lga_geometries.append(feature)

    records: list[dict] = []
    used_slugs: set[str] = set()
    for feature in locality_features:
        official_name = feature["properties"]["locality_name"]
        location = geometry_centroid(feature["geometry"])
        lga_feature = next((candidate for candidate in lga_geometries if point_in_feature(location, candidate)), None)
        if not lga_feature:
            continue
        lga = lga_feature["properties"]["lga_name"]
        name = display_name(official_name)

        # Only Beveridge and Wallan are inside the metropolitan Urban Growth
        # Boundary in Mitchell Shire; the rest of Mitchell is regional.
        if lga == "MITCHELL" and name not in {"Beveridge", "Wallan"}:
            continue

        slug = slugify(name)
        if slug in used_slugs:
            slug = f"{slug}-{slugify(lga)}"
        used_slugs.add(slug)

        distance = haversine_km(CBD, location)
        priority = priority_for(name, lga, distance)
        zone = LGA_TO_ZONE[lga]
        planning_region = LGA_TO_REGION[lga]
        page_status = {1: "launch", 2: "phase_2", 3: "coverage_only", 4: "quote_only"}[priority]
        index_recommendation = priority == 1 and name not in RESTRICTED_OR_NON_RESIDENTIAL

        records.append(
            {
                "name": name,
                "official_name": official_name,
                "slug": slug,
                "lga_key": lga,
                "lga": lga_feature["properties"]["lga_official_name"].title(),
                "planning_region": planning_region,
                "zone": zone,
                "priority": priority,
                "page_status": page_status,
                "index_recommendation": index_recommendation,
                "latitude": round(location[1], 5),
                "longitude": round(location[0], 5),
                "estimated_cbd_distance_km": round(distance, 1),
                "nearby_areas": [],
                "regional_anchors": REGIONAL_ANCHORS[lga],
                "property_profile": property_type(name, lga, priority),
                "local_context": "",
                "service_notes": ZONE_ACCESS[zone],
            }
        )

    # Nearby areas are the three closest official localities in the same
    # operational zone.  They are a dispatch aid, not a road-time estimate.
    for record in records:
        candidates = [other for other in records if other["zone"] == record["zone"] and other is not record]
        origin = (record["longitude"], record["latitude"])
        candidates.sort(key=lambda item: haversine_km(origin, (item["longitude"], item["latitude"])))
        record["nearby_areas"] = [candidate["name"] for candidate in candidates[:3]]
        nearby = ", ".join(record["nearby_areas"])
        source_lga = record["lga_key"]
        anchors = ", ".join(record["regional_anchors"])
        record["local_context"] = (
            f"{record['name']} is {ZONE_LOCALITY_FRAME[record['zone']]}, close to {nearby}. "
            f"The broader catchment is shaped by {anchors}. "
            f"The local job mix commonly includes {PROPERTY_CONTEXT[source_lga]}."
        )

    records.sort(key=lambda item: (item["priority"], item["zone"], item["name"]))

    metadata = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": (
            "Bounded localities assigned to the 31 Plan Melbourne metropolitan LGAs, plus "
            "Beveridge and Wallan in the metropolitan part of Mitchell Shire."
        ),
        "record_count": len(records),
        "source_urls": [LOCALITY_DATASET_URL, PLANNING_REGIONS_URL],
        "notes": [
            "Priority 1 is the recommended launch landing-page cohort.",
            "Priority 2 is a review-and-release page queue after installer capacity and conversion data are proven.",
            "Priority 3 and 4 remain in the dispatch/service inventory but should not automatically become indexed pages.",
            "Nearby areas are straight-line nearest localities within the same operational zone, not road-time promises.",
            "CBD distance is approximate straight-line distance and must not be shown as travel time.",
        ],
    }

    (OUTPUT_DIR / "melbourne-suburbs.json").write_text(
        json.dumps({"metadata": metadata, "suburbs": records}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    csv_fields = [
        "name",
        "official_name",
        "slug",
        "lga_key",
        "lga",
        "planning_region",
        "zone",
        "priority",
        "page_status",
        "index_recommendation",
        "latitude",
        "longitude",
        "estimated_cbd_distance_km",
        "nearby_areas",
        "regional_anchors",
        "property_profile",
        "local_context",
        "service_notes",
    ]
    with (OUTPUT_DIR / "melbourne-suburbs.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields)
        writer.writeheader()
        for record in records:
            row = dict(record)
            row["nearby_areas"] = " | ".join(record["nearby_areas"])
            row["regional_anchors"] = " | ".join(record["regional_anchors"])
            writer.writerow(row)

    summary = {
        "count": len(records),
        "by_priority": {
            str(priority): sum(1 for record in records if record["priority"] == priority)
            for priority in range(1, 5)
        },
        "by_zone": {
            zone: sum(1 for record in records if record["zone"] == zone)
            for zone in sorted(set(record["zone"] for record in records))
        },
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
