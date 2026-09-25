"""Collect freely-licensed training photos from Wikimedia Commons.

Only Commons is used, and only through its API, because everything there
carries an explicit free licence. Scraping image search results would give more
images faster and would not be ours to train on.

This is a starting set, not a finished one. Commons has a few dozen usable
photos per raw-meat class, which is enough to tell obviously different
categories apart and not enough for confident fine distinctions. Photos you
shoot yourself, in the kitchen the app will be used in, are worth more than
anything here -- drop them into the same folders and retrain.

    python scripts/collect_wikimedia.py --out data --per-class 60
"""

from __future__ import annotations

import argparse
import json
import logging
import time
import urllib.parse
import urllib.request
from pathlib import Path

logger = logging.getLogger("collect")

API = "https://commons.wikimedia.org/w/api.php"
UA = "FresoraTrainingCollector/1.0 (food freshness research; non-commercial)"

#: Search terms per class. Several per class because a single term returns a
#: narrow slice -- "raw chicken" alone skews heavily to whole birds.
QUERIES: dict[str, list[str]] = {
    "chicken": [
        "raw chicken meat",
        "raw chicken breast",
        "chicken drumstick raw",
        "poultry meat raw",
        "raw chicken thigh",
    ],
    "fish": [
        "raw fish fillet",
        "fresh fish market",
        "raw salmon fillet",
        "whole raw fish",
        "raw tuna fillet",
    ],
    "beef": [
        "raw beef steak",
        "raw beef meat",
        "raw minced beef",
        "beef cut raw",
        "raw red meat",
    ],
    "mutton": [
        "raw lamb meat",
        "raw mutton",
        "lamb chop raw",
        "raw goat meat",
    ],
    "prawn": [
        "raw prawns",
        "raw shrimp",
        "fresh shrimp seafood",
    ],
    # "other" is what lets the head defer to ImageNet instead of forcing every
    # photo into a meat class. Without it a banana becomes whichever meat it
    # resembles most, confidently.
    "other": [
        "fresh vegetables",
        "fruit basket",
        "tomatoes",
        "potatoes",
        "green leafy vegetables",
        "bread loaf",
        "milk bottle",
        "kitchen counter",
        "empty plate",
        "cheese",
    ],
}


def api_get(params: dict[str, str]) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=45) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def search_files(query: str, limit: int) -> list[str]:
    """File titles matching a query, images only."""
    try:
        data = api_get(
            {
                "action": "query",
                "list": "search",
                "srsearch": f"{query} filetype:bitmap",
                "srnamespace": "6",  # File:
                "srlimit": str(limit),
                "format": "json",
            }
        )
    except Exception as exc:  # network flakiness must not kill a long run
        logger.warning("  search failed for %r: %s", query, exc)
        return []
    return [hit["title"] for hit in data.get("query", {}).get("search", [])]


def thumb_urls(titles: list[str], width: int = 640) -> list[tuple[str, str]]:
    """(title, thumbnail url) for a batch of File: titles."""
    if not titles:
        return []
    try:
        data = api_get(
            {
                "action": "query",
                "titles": "|".join(titles[:50]),
                "prop": "imageinfo",
                "iiprop": "url|mime",
                "iiurlwidth": str(width),
                "format": "json",
            }
        )
    except Exception as exc:
        logger.warning("  imageinfo failed: %s", exc)
        return []

    out: list[tuple[str, str]] = []
    for page in data.get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        mime = info.get("mime", "")
        url = info.get("thumburl") or info.get("url")
        # SVG and TIFF appear in results and are not photographs.
        if url and mime in {"image/jpeg", "image/png"}:
            out.append((page.get("title", "?"), url))
    return out


def download(url: str, dest: Path) -> bool:
    try:
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            payload = response.read()
        # Anything tiny is an error page or an icon, not a usable photo.
        if len(payload) < 8000:
            return False
        dest.write_bytes(payload)
        return True
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("data"))
    parser.add_argument("--per-class", type=int, default=60)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    totals: dict[str, int] = {}

    for label, queries in QUERIES.items():
        folder = args.out / label
        folder.mkdir(parents=True, exist_ok=True)
        saved = len(list(folder.glob("*.jpg")))
        seen: set[str] = set()
        logger.info("%s (have %d)", label, saved)

        for query in queries:
            if saved >= args.per_class:
                break
            for title, url in thumb_urls(search_files(query, 40)):
                if saved >= args.per_class or title in seen:
                    continue
                seen.add(title)
                if download(url, folder / f"{saved:04d}.jpg"):
                    saved += 1
                time.sleep(0.15)  # be a considerate API client
            logger.info("  after %-28s %d", f"'{query}'", saved)

        totals[label] = saved

    logger.info("")
    logger.info("Collected: %s", totals)
    thin = [k for k, v in totals.items() if v < 30]
    if thin:
        logger.warning(
            "Thin classes (%s). Add your own photos before trusting a head "
            "trained on this.",
            ", ".join(thin),
        )


if __name__ == "__main__":
    main()
