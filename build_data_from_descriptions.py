#!/usr/bin/env python3
"""Genera data.json para el mapa de Plex.

- Vuelta 3: países por capítulo desde vuelta3_tabla.md (82 entradas, orden playlist).
  Si existe descriptions_v3/*.description para un vídeo, se usan descripción + Nominatim y sustituyen la fila de la tabla.

- Vuelta 1: países por capítulo desde vuelta1_tabla.md + fallback para capítulos solo en playlist.

- Vuelta 2: países por capítulo desde vuelta2_tabla.md (tabla NotebookLM / fuentes del usuario).
  Coordenadas: capital o punto representativo del último país indicado en cada fila.

  yt-dlp --skip-download --write-description -o "descriptions_v3/%(id)s" "URL_VUELTA_3"
  python3 build_data_from_descriptions.py

  Salida adicional: listado_videos_mapa.md y listado_videos_mapa.csv (mismo contenido).
  Los vídeos privados o no disponibles en el listado de la playlist no entran en data.json.
"""
from __future__ import annotations

import csv
import glob
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))

# temporada, carpeta descripciones (None = no usa archivos), URL playlist
VUELTAS: list[tuple[int, str | None, str]] = [
    (
        1,
        None,
        "https://www.youtube.com/playlist?list=PLOW4rFKkqOT-8rpDKod2iXmLjvh0CRPPQ",
    ),
    (
        2,
        None,
        "https://www.youtube.com/playlist?list=PLOW4rFKkqOT9KwJA6Q1RqwcZR92vgLpKK",
    ),
    (
        3,
        "descriptions_v3",
        "https://www.youtube.com/playlist?list=PLOW4rFKkqOT-T8rIypS7-CBZplv-5H5tA",
    ),
]

ID_OVERRIDES_V3: dict[str, str] = {
    "GUZYD2kd5Is": "España",
    "8zNQzb7ZYjM": "España",
    "HvO7yjrTIZE": "España",
}

BAD_SUBSTR = (
    "http",
    "instagram",
    "youtu.be",
    "youtube.com",
    "whatsapp",
    "patrocinar",
    "sorteo",
    "nocilla",
    "mcdonald",
    "loreal",
    "skincare",
    "pacoffee",
    "conviértete",
    "conviertete",
    "únete",
    "unete",
    "comunidad de youtube",
    "suscríbete",
    "agrégame",
    "tiktok",
    "twitter",
    "redes de",
    "bases legales",
    "policies/terms",
    "dreamwolf",
)

FLAG_AT_END = re.compile(r"[\U0001F1E6-\U0001F1FF]{2}\s*$")


def is_bad_line(ln: str) -> bool:
    low = ln.lower()
    if ln.startswith("@") or ln.startswith("-"):
        return True
    if any(b in low for b in BAD_SUBSTR):
        return True
    return False


def strip_flags_and_emoji(s: str) -> str:
    s = re.sub(r"[\U0001F1E6-\U0001F1FF]{2}", "", s)
    s = re.sub(r"[\U00002600-\U000027BF]", "", s)
    s = re.sub(r"[\U0001F300-\U0001FAFF]", "", s)
    return " ".join(s.split()).strip()


def country_line_from_description(desc: str) -> str | None:
    lines = [ln.strip() for ln in desc.splitlines() if ln.strip()]
    for ln in lines:
        if is_bad_line(ln):
            continue
        if FLAG_AT_END.search(ln):
            return ln
    for ln in lines:
        if is_bad_line(ln):
            continue
        if len(ln) > 90:
            continue
        if ln.endswith(".") or ln.endswith("!") or ln.endswith("?"):
            continue
        if re.search(r"[.!?]{2,}", ln):
            continue
        core = strip_flags_and_emoji(ln)
        if len(core) < 2:
            continue
        if not any(c.isalpha() for c in core):
            continue
        if len(core.split()) > 8:
            continue
        return ln
    return None


def fallback_from_body(desc: str) -> str | None:
    low = desc.lower()
    if "españa" in low or "espana" in low:
        return "España"
    if "colombia" in low:
        return "Colombia"
    return None


def geocode_nominatim(query: str, cache: dict) -> tuple[float, float] | None:
    q = query.strip()
    if not q:
        return None
    if q in cache:
        return cache[q]
    url = (
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
        + urllib.parse.quote(q)
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PlexVueltaMundoMap/1.0 (mapa educativo; contacto: local)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode())
        if not data:
            cache[q] = None
            return None
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        cache[q] = (lat, lon)
        time.sleep(1.05)
        return lat, lon
    except Exception:
        cache[q] = None
        return None


# Si Nominatim falla, usar estas coordenadas (centro / capital aprox.)
COORD_FALLBACK: dict[str, tuple[float, float]] = {
    "Hawaii": (19.8968, -155.5828),
    "Dubai": (25.2048, 55.2708),
    "Zanzibar": (-6.1659, 39.1921),
    "Tanzania": (-6.52471, 35.78784),
    "Hong Kong": (22.3193, 114.1694),
    "Puerto Rico": (18.2208, -66.5901),
    "República Dominicana": (18.4861, -69.9312),
    "Islas Azores": (37.7412, -25.6756),
    "Kuala Lumpur": (3.139, 101.6869),
    "Singapur": (1.3521, 103.8198),
    "México": (23.6345, -102.5528),
    "Japón": (35.6762, 139.6503),
    "Vietnam": (14.0583, 108.2772),
    "Tailandia": (13.7563, 100.5018),
    "Camboya": (12.5657, 104.991),
    "Pakistán": (33.6844, 73.0479),
    "Marruecos": (34.02185, -6.84089),
    "Brasil": (-14.235, -51.9253),
    "Chile": (-33.4489, -70.6693),
    "Colombia": (4.5709, -74.2973),
    "Italia": (41.9028, 12.4964),
    "Nueva York": (40.7128, -74.006),
    "Miami": (25.7617, -80.1918),
    "San Francisco": (37.7749, -122.4194),
    "Amsterdam": (52.3676, 4.9041),
    "Lisboa": (38.7223, -9.1393),
    "Murcia": (37.9922, -1.1307),
    "Toro": (41.524, -5.398),
    "Valverde de la Vera": (40.1231, -5.9174),
    "España": (40.4168, -3.7038),
    "Sin país en descripción": (40.4168, -3.7038),
}

FIXES = {
    "Hawaii": "Hawaii, United States",
    "Dubai": "Dubai, United Arab Emirates",
    "Zanzibar": "Zanzibar, Tanzania",
    "Tanzania": "Tanzania",
    "Hong Kong": "Hong Kong",
    "Puerto Rico": "Puerto Rico",
    "República Dominicana": "Dominican Republic",
    "Islas Azores": "Azores, Portugal",
    "Kuala Lumpur": "Kuala Lumpur, Malaysia",
    "Singapur": "Singapore",
    "México": "Mexico",
    "Japón": "Japan",
    "Vietnam": "Vietnam",
    "Tailandia": "Thailand",
    "Camboya": "Cambodia",
    "Pakistán": "Pakistan",
    "Marruecos": "Rabat, Morocco",
    "Brasil": "Brazil",
    "Chile": "Chile",
    "Colombia": "Colombia",
    "Italia": "Italy",
    "Nueva York": "New York City, United States",
    "Miami": "Miami, United States",
    "San Francisco": "San Francisco, United States",
    "Amsterdam": "Amsterdam, Netherlands",
    "Lisboa": "Lisbon, Portugal",
    "Murcia": "Murcia, Spain",
    "Toro": "Toro, Zamora, Spain",
    "Valverde de la Vera": "Valverde de la Vera, Spain",
    "España": "Spain",
    "Sin país en descripción": "Spain",
}


def _yt_flat_ids(url: str) -> list[str]:
    out = subprocess.check_output(
        ["yt-dlp", "--flat-playlist", "--print", "%(id)s", url],
        stderr=subprocess.DEVNULL,
        text=True,
    )
    return [x.strip() for x in out.splitlines() if x.strip()]


def _yt_flat_id_title(url: str) -> dict[str, str]:
    raw = subprocess.check_output(
        ["yt-dlp", "--flat-playlist", "--print", "%(id)s|%(title)s", url],
        stderr=subprocess.DEVNULL,
        text=True,
    )
    m: dict[str, str] = {}
    for line in raw.splitlines():
        if "|" not in line:
            continue
        vid, title = line.split("|", 1)
        m[vid.strip()] = title.strip()
    return m


def _yt_title_is_private(title: str) -> bool:
    low = (title or "").lower()
    if "private" in low:
        return True
    if "deleted video" in low or "video unavailable" in low:
        return True
    return False


def _md_cell(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def write_listado_videos_md(
    md_path: str,
    data: dict[str, list],
    playlist_by_temporada: dict[int, str],
) -> None:
    """Tabla Markdown: título YouTube, etiqueta del mapa, coords, vuelta."""
    lines = [
        "# Listado de vídeos del mapa",
        "",
        "Generado por `build_data_from_descriptions.py` junto con `data.json`.",
        "Los vídeos privados o no disponibles **no** se incluyen en el mapa.",
        "",
    ]
    for temp in (1, 2, 3):
        key = f"vuelta{temp}"
        items = data.get(key, [])
        pl_url = playlist_by_temporada.get(temp, "")
        id_title = _yt_flat_id_title(pl_url) if pl_url else {}
        lines.append(f"## Vuelta {temp} — {len(items)} vídeos")
        lines.append("")
        lines.append(
            "| N.º | Vuelta | Título (YouTube) | Punto / etiqueta | Lat | Lng | Enlace |"
        )
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for n, item in enumerate(items, start=1):
            url = str(item.get("url", ""))
            vid = url.split("v=", 1)[-1].split("&")[0] if "v=" in url else ""
            yt_title = (item.get("titulo") or "").strip() or id_title.get(vid, "—")
            lines.append(
                f"| {n} | {temp} | {_md_cell(yt_title)} | {_md_cell(str(item.get('pais', '')))} | "
                f"{item.get('lat')} | {item.get('lng')} | {url} |"
            )
        lines.append("")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def write_listado_videos_csv(
    csv_path: str,
    data: dict[str, list],
    playlist_by_temporada: dict[int, str],
) -> None:
    """CSV UTF-8 con las mismas columnas que el listado Markdown."""
    rows: list[list[str | float | int]] = []
    for temp in (1, 2, 3):
        key = f"vuelta{temp}"
        items = data.get(key, [])
        pl_url = playlist_by_temporada.get(temp, "")
        id_title = _yt_flat_id_title(pl_url) if pl_url else {}
        for n, item in enumerate(items, start=1):
            url = str(item.get("url", ""))
            vid = url.split("v=", 1)[-1].split("&")[0] if "v=" in url else ""
            yt_title = (item.get("titulo") or "").strip() or id_title.get(vid, "—")
            rows.append(
                [
                    n,
                    temp,
                    yt_title,
                    str(item.get("pais", "")),
                    item.get("lat", ""),
                    item.get("lng", ""),
                    url,
                    vid,
                ]
            )
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "indice_en_vuelta",
                "vuelta",
                "titulo_youtube",
                "punto_etiqueta",
                "lat",
                "lng",
                "enlace",
                "video_id",
            ]
        )
        w.writerows(rows)


V2_ORLANDO_MIAMI: tuple[float, float] = (
    (28.5383 + 25.7617) / 2,
    (-81.3792 + -80.1918) / 2,
)

# Claves = fragmentos exactos de la columna «Países» (último segmento tras dividir por comas)
V1_SEGMENT_COORDS: dict[str, tuple[float, float]] = {
    "Global": (40.4168, -3.7038),
    "España": (40.4168, -3.7038),
    "Turquía": (41.0082, 28.9784),
    "Jordania": (31.9454, 35.9284),
    "Ecuador": (-0.22985, -78.52495),
    "Ecuador (Galápagos)": (-0.9538, -90.9656),
    "Sudáfrica": (-33.9249, 18.4241),
    "Mauricio": (-20.3484, 57.5522),
    "Madagascar": (-18.8792, 47.5079),
    "Maldivas": (3.2028, 73.2207),
    "Nueva Zelanda": (-36.8485, 174.7633),
    "Corea del Sur": (37.5665, 126.9780),
    "Argentina": (-34.6037, -58.3816),
    "Japón": (35.6762, 139.6503),
    "Tailandia": (13.7563, 100.5018),
    "Marruecos": (34.02185, -6.84089),
    "Emiratos Árabes Unidos": (25.2048, 55.2708),
    "Emiratos Árabes Unidos (Dubái)": (25.2048, 55.2708),
    "Emiratos Árabes Unidos (Abu Dabi)": (24.4539, 54.3773),
    "México": (19.4326, -99.1332),
    "EE. UU. (Las Vegas)": (36.1699, -115.1398),
    "EE. UU. (Nueva York)": (40.7128, -74.006),
    "EE. UU. (Colorado)": (40.3775, -105.5217),
    "EE. UU. (California)": (33.2565, -115.4656),
    "EE. UU.": (39.8283, -98.5795),
    "Noruega": (69.6492, 18.9553),
    "Svalbard": (78.2232, 15.6267),
    "Rusia (Ártico)": (68.9585, 33.0822),
    "Polonia": (50.0344, 19.1784),
    "Islandia": (64.1466, -21.9426),
}

# Capítulos en playlist que no están en vuelta1_tabla.md (título ya sin sufijo « - Vuelta…»)
V1_EPISODE_FALLBACK: dict[str, str] = {
    "Llorando En El Avión": "México",
    "No sé si debimos entrar aquí": "México",
    "Perdí A Mis Amigos En Mexico": "México",
    "Llegamos A La Ciudad Del Pecado...": "EE. UU. (Las Vegas)",
    "Probando Las Famosas Cápsulas De Atrapar Dinero!": "EE. UU. (Las Vegas)",
    "Resacón En Las Vegas": "EE. UU. (Las Vegas)",
    "Venir Al Area 51 Fue Un Error": "EE. UU. (Las Vegas)",
    "Tuvimos Que Dormir En El Hotel Más Paranormal De Estados Unidos": "EE. UU. (Colorado)",
    "problemas con la poli xd": "EE. UU.",
    "MI PRIMERA VEZ EN LA NBA NO TUVO SENTIDO!": "EE. UU.",
    "Pedí Hamburguesas De MrBeast Y Las Trajo Un Robot!": "EE. UU.",
    "Entramos En La Ciudad Sin Ley Pero...": "EE. UU. (California)",
    "Lo Que Nadie Te Cuenta De La Ciudad Sin Ley": "EE. UU. (California)",
    "Llegamos Al Lugar Donde No Se Hace De Noche": "Noruega",
    "Uno De Los Lugares Más Salvajes Del Planeta": "Svalbard",
    "dios mio como es posible este suceso": "Svalbard",
    "POR FIN LO ENCONTRÉ EN LIBERTAD!": "Svalbard",
    'La Ciudad Devastada Por La "Droga Zombie"': "EE. UU. (Nueva York)",
    "anuel hizo llorar a mi amigo en nueva york 😡": "EE. UU. (Nueva York)",
    "PALMAZO": "EE. UU. (Nueva York)",
    "yo en mi momento menos esquizofrenico": "EE. UU. (Nueva York)",
    "Por Fin Pude Ver Lava En Este País!": "Islandia",
    "nos robaron de chill \U0001f919": "Islandia",
    "Llegamos Al Asentamiento Humano Más Al Norte Del Mundo!": "Svalbard",
    "Perdidos En Una Mina Abandonada Del Polo Norte": "Svalbard",
    "Encontramos Un Pueblo Ruso Perdido En El Ártico": "Rusia (Ártico)",
    "Llegamos A La Bóveda Del Fin Del Mundo!": "Svalbard",
    "El \u00daltimo Pa\u00eds!": "Noruega",
    "Así era la horrible vida en un campo de concentración nazi": "Polonia",
    "Dimos La Vuelta Al Mundo En 80 Días!": "España",
}

# Ultimo segmento de cada celda Paises en vuelta3_tabla.md
V3_SEGMENT_COORDS: dict[str, tuple[float, float]] = {
    "Argentina": (-34.6037, -58.3816),
    "Camboya": (12.5657, 104.991),
    "Chile": (-33.4489, -70.6693),
    "Colombia": (4.5709, -74.2973),
    "EE. UU.": (39.8283, -98.5795),
    "EE. UU. (Las Vegas)": (36.1699, -115.1398),
    "EE. UU. (Miami)": (25.7617, -80.1918),
    "Emiratos Árabes Unidos (Dubái)": (25.2048, 55.2708),
    "España": (40.4168, -3.7038),
    "Estados Unidos (Hawái)": (19.8968, -155.5828),
    "Estados Unidos (Los Ángeles, Hawái)": (21.3069, -157.8583),
    "Estados Unidos (San Francisco)": (37.7749, -122.4194),
    "Hong Kong": (22.3193, 114.1694),
    "Hong Kong (China)": (22.3193, 114.1694),
    "Islandia": (64.1466, -21.9426),
    "Italia": (41.9028, 12.4964),
    "Japón": (35.6762, 139.6503),
    "Malasia": (3.139, 101.6869),
    "Malasia (Kuala Lumpur)": (3.139, 101.6869),
    "Marruecos": (34.02185, -6.84089),
    "México": (19.4326, -99.1332),
    "Pakistán": (33.6844, 73.0479),
    "Puerto Rico (EE. UU.)": (18.2208, -66.5901),
    "Qatar (Doha)": (25.2854, 51.5310),
    "Qatar (escala)": (25.2854, 51.5310),
    "Singapur": (1.3521, 103.8198),
    "Tailandia": (13.7563, 100.5018),
    "Tailandia (Bangkok)": (13.7563, 100.5018),
    "Tailandia (escala)": (13.7563, 100.5018),
    "Tanzania": (-6.52471, 35.78784),
    "Tanzania (Isla de Pemba)": (-5.234, 39.7744),
    "Tanzania (Isla de Pemba, Zanzíbar)": (-6.1659, 39.1921),
    "Vietnam": (14.0583, 108.2772),
}

V2_SEGMENT_COORDS: dict[str, tuple[float, float]] = {
    "España": (41.524, -5.398),
    "Qatar": (25.2854, 51.5310),
    "Tanzania": (-6.52471, 35.78784),
    "Emiratos Árabes Unidos": (25.2048, 55.2708),
    "India": (28.6139, 77.2090),
    "Sri Lanka": (6.9271, 79.8612),
    "Tailandia": (13.7563, 100.5018),
    "China": (39.9042, 116.4074),
    "Indonesia": (-6.2088, 106.8456),
    "Australia": (-33.8688, 151.2093),
    "EE. UU. (Hawái)": (19.8968, -155.5828),
    "Puerto Rico (EE. UU.)": (18.2208, -66.5901),
    "Puerto Rico": (18.2208, -66.5901),
    "EE. UU. (Nueva York)": (40.7128, -74.006),
    "EE. UU. (Orlando)": (28.5383, -81.3792),
    "EE. UU. (Miami)": (25.7617, -80.1918),
    "Costa Rica": (9.9281, -84.0907),
    "Perú": (-12.0464, -77.0428),
    "Chile": (-33.4489, -70.6693),
    "Argentina": (-34.6037, -58.3816),
    "vuelo rumbo a Europa": (-34.6037, -58.3816),
    "Francia": (48.8566, 2.3522),
    "Finlandia": (60.1699, 24.9384),
    "Italia": (41.9028, 12.4964),
    "Ciudad del Vaticano": (41.9029, 12.4534),
    "Andorra": (42.5078, 1.5211),
    "Reino Unido": (51.5074, -0.1278),
}


def _v2_jitter_deg(vid: str) -> tuple[float, float]:
    b = hashlib.md5(vid.encode("utf-8")).digest()
    return ((b[0] / 255.0 - 0.5) * 0.1, (b[1] / 255.0 - 0.5) * 0.1)


def _v2_split_countries_cell(cell: str) -> list[str]:
    cell = cell.strip()
    if not cell:
        return []
    depth = 0
    parts: list[str] = []
    buf: list[str] = []
    for ch in cell:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())
    return [p for p in parts if p]


def _coords_from_countries_cell(
    cell: str,
    segment_coords: dict[str, tuple[float, float]],
    orlando_miami: bool = False,
) -> tuple[float, float]:
    if orlando_miami and "EE. UU. (Orlando, Miami)" in cell:
        return V2_ORLANDO_MIAMI
    parts = _v2_split_countries_cell(cell)
    if not parts:
        return (40.4168, -3.7038)
    last = parts[-1].strip()
    if last in segment_coords:
        return segment_coords[last]
    low = last.lower()
    for k, v in segment_coords.items():
        if k.lower() == low:
            return v
    return (40.4168, -3.7038)


def _v1_normalize_yt_title(title: str) -> str:
    t = title.strip()
    for suf in (
        " - Vuelta Al Mundo En 80 Días",
        " - Vuelta Al Mundo En 80 Dias",
    ):
        if t.endswith(suf):
            return t[: -len(suf)].strip()
    return t


def _v2_coords_from_countries_cell(cell: str) -> tuple[float, float]:
    return _coords_from_countries_cell(cell, V2_SEGMENT_COORDS, orlando_miami=True)


def _v1_coords_from_countries_cell(cell: str) -> tuple[float, float]:
    return _coords_from_countries_cell(cell, V1_SEGMENT_COORDS, orlando_miami=False)


def _v3_normalize_yt_title(title: str) -> str:
    t = title.strip()
    if t.endswith(" | La Vuelta Al Mundo 3"):
        return t[: -len(" | La Vuelta Al Mundo 3")].strip()
    t = re.sub(r"\s*\|\s*Around The World In 80 Days - Day \d+\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*-\s*Day \d+\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+\|\s*Around The World In 80 Days - Day \d+.*$", "", t, flags=re.I)
    return t.strip()


def _v3_coords_from_countries_cell(cell: str) -> tuple[float, float]:
    return _coords_from_countries_cell(cell, V3_SEGMENT_COORDS, orlando_miami=False)


def _v3_entry_from_description(
    desc: str,
    vid: str,
    cache: dict,
    id_overrides: dict[str, str],
) -> dict:
    raw = country_line_from_description(desc)
    if vid in id_overrides:
        pais_display = id_overrides[vid]
    elif raw:
        pais_display = strip_flags_and_emoji(raw) or raw
    else:
        fb = fallback_from_body(desc)
        pais_display = fb if fb else "Sin país en descripción"
    geo_query = FIXES.get(pais_display, pais_display)
    coords = geocode_nominatim(geo_query, cache)
    if coords is None and pais_display in COORD_FALLBACK:
        coords = COORD_FALLBACK[pais_display]
    if coords is None:
        coords = (40.4168, -3.7038)
    lat, lng = coords
    return {
        "pais": pais_display,
        "lat": round(lat, 5),
        "lng": round(lng, 5),
        "url": f"https://www.youtube.com/watch?v={vid}",
        "temporada": 3,
    }


def _v2_canonical_table_title(yt_title: str) -> str | None:
    low = yt_title.lower()
    if "trailer" in low:
        return "La Vuelta Al Mundo En 80 Días 2 - Trailer Oficial"
    m = re.search(r"Día\s*(\d+)", yt_title, re.I)
    if m:
        return f"La Vuelta Al Mundo En 80 Días II - Día {m.group(1)}"
    return None


def _v2_load_table(md_path: str) -> dict[str, str]:
    by_title: dict[str, str] = {}
    with open(md_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if (
                not line.startswith("|")
                or "---" in line
                or "Nombre del capítulo" in line
                or line.count("|") < 3
            ):
                continue
            cells = [c.strip() for c in line.split("|")[1:-1]]
            if len(cells) >= 2 and cells[0] and cells[1]:
                by_title[cells[0]] = cells[1]
    return by_title


def build_vuelta1(playlist_url: str) -> list[dict]:
    md_path = os.path.join(BASE, "vuelta1_tabla.md")
    table = _v2_load_table(md_path)
    order = _yt_flat_ids(playlist_url)
    titles = _yt_flat_id_title(playlist_url)
    out: list[dict] = []
    for vid in order:
        title = titles.get(vid, "")
        if _yt_title_is_private(title):
            continue
        low = title.lower()
        norm = _v1_normalize_yt_title(title)
        countries = table.get(norm, "") or V1_EPISODE_FALLBACK.get(norm, "")
        if not countries:
            pais_label = f"Sin fila en tabla · {title[:60]}"
            countries = "España"
        elif "trailer" in low:
            pais_label = f"Trailer · {countries}"
        else:
            pais_label = countries
        lat0, lng0 = _v1_coords_from_countries_cell(countries)
        jx, jy = _v2_jitter_deg(vid)
        out.append(
            {
                "titulo": title,
                "pais": pais_label,
                "lat": round(lat0 + jx, 5),
                "lng": round(lng0 + jy, 5),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "temporada": 1,
            }
        )
    return out


def build_vuelta2(playlist_url: str) -> list[dict]:
    md_path = os.path.join(BASE, "vuelta2_tabla.md")
    table = _v2_load_table(md_path)
    order = _yt_flat_ids(playlist_url)
    titles = _yt_flat_id_title(playlist_url)
    out: list[dict] = []
    for vid in order:
        title = titles.get(vid, "")
        if _yt_title_is_private(title):
            continue
        low = title.lower()
        key = _v2_canonical_table_title(title)
        countries = table.get(key, "") if key else ""
        if not countries:
            pais_label = f"Sin fila en tabla · {title[:60]}"
            countries = "España"
        elif "trailer" in low:
            pais_label = f"Trailer · {countries}"
        else:
            pais_label = countries
        lat0, lng0 = _v2_coords_from_countries_cell(countries)
        jx, jy = _v2_jitter_deg(vid)
        out.append(
            {
                "titulo": title,
                "pais": pais_label,
                "lat": round(lat0 + jx, 5),
                "lng": round(lng0 + jy, 5),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "temporada": 2,
            }
        )
    return out


def build_vuelta3(
    playlist_url: str,
    desc_dir: str | None,
    cache: dict,
    id_overrides: dict[str, str],
) -> list[dict]:
    md_path = os.path.join(BASE, "vuelta3_tabla.md")
    table = _v2_load_table(md_path)
    order = _yt_flat_ids(playlist_url)
    titles = _yt_flat_id_title(playlist_url)
    desc_by_vid: dict[str, str] = {}
    if desc_dir:
        pattern = os.path.join(BASE, desc_dir, "*.description")
        for path in sorted(glob.glob(pattern)):
            vid = os.path.basename(path).replace(".description", "")
            with open(path, encoding="utf-8") as f:
                desc_by_vid[vid] = f.read()

    out: list[dict] = []
    for vid in order:
        title_raw = titles.get(vid, "")
        title = (
            title_raw.replace("\u2019", "'")
            .replace("\u201c", '"')
            .replace("\u201d", '"')
        )
        if _yt_title_is_private(title_raw):
            continue
        if vid in desc_by_vid:
            e = _v3_entry_from_description(
                desc_by_vid[vid], vid, cache, id_overrides
            )
            e["titulo"] = title_raw
            out.append(e)
            continue
        key = _v3_normalize_yt_title(title)
        countries = table.get(key, "")
        if not countries:
            countries = "España"
            pais_label = f"Sin fila en tabla · {title_raw[:55]}"
        else:
            pais_label = countries
        lat0, lng0 = _v3_coords_from_countries_cell(countries)
        jx, jy = _v2_jitter_deg(vid)
        out.append(
            {
                "titulo": title_raw,
                "pais": pais_label,
                "lat": round(lat0 + jx, 5),
                "lng": round(lng0 + jy, 5),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "temporada": 3,
            }
        )
    return out


def main():
    os.chdir(BASE)
    cache: dict[str, tuple[float, float] | None] = {}

    vuelta1: list[dict] = []
    vuelta2: list[dict] = []
    vuelta3: list[dict] = []

    for temporada, desc_dir, playlist_url in VUELTAS:
        if temporada == 1:
            vuelta1 = build_vuelta1(playlist_url)
            print(f"vuelta 1: {len(vuelta1)} puntos (vuelta1_tabla.md + fallback)")
        elif temporada == 2:
            vuelta2 = build_vuelta2(playlist_url)
            print(f"vuelta 2: {len(vuelta2)} puntos (vuelta2_tabla.md)")
        elif temporada == 3:
            vuelta3 = build_vuelta3(
                playlist_url,
                desc_dir,
                cache,
                ID_OVERRIDES_V3,
            )
            nd = (
                len(glob.glob(os.path.join(BASE, desc_dir or "", "*.description")))
                if desc_dir
                else 0
            )
            print(
                f"vuelta 3: {len(vuelta3)} puntos (vuelta3_tabla.md; "
                f"descripciones que sustituyen: {nd})"
            )

    out_obj = {"vuelta1": vuelta1, "vuelta2": vuelta2, "vuelta3": vuelta3}
    with open(os.path.join(BASE, "data.json"), "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=2)
    print("Escrito data.json")

    playlist_by_t = {t: u for t, _, u in VUELTAS}
    write_listado_videos_md(
        os.path.join(BASE, "listado_videos_mapa.md"),
        out_obj,
        playlist_by_t,
    )
    print("Escrito listado_videos_mapa.md")
    write_listado_videos_csv(
        os.path.join(BASE, "listado_videos_mapa.csv"),
        out_obj,
        playlist_by_t,
    )
    print("Escrito listado_videos_mapa.csv")

    cache_path = os.path.join(BASE, "geocode_cache.json")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump({k: list(v) for k, v in cache.items() if v is not None}, f, indent=2)


if __name__ == "__main__":
    main()
