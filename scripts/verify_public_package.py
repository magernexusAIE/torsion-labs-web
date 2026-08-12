#!/usr/bin/env python3
"""Fail-closed verifier for the Torsion public static package."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "governance" / "sealed-web-package.manifest.json"
EXPECTED_CSP = {
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
}
DENYLIST = re.compile(
    r"BEGIN AGE ENCRYPTED FILE|AGE-SECRET-KEY-1[0-9A-Z]{58}|"
    r"-----BEGIN (RSA|OPENSSH|EC|DSA)? ?PRIVATE KEY-----|"
    r"sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|"
    r"github_pat_[A-Za-z0-9_]{22,}|AIza[0-9A-Za-z_-]{35}|"
    r"xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,}\\.eyJ|"
    r"Bearer [A-Za-z0-9_.-]{25,}"
)
ALLOWED_AUXILIARY = {
    PurePosixPath("governance/sealed-web-package.manifest.json"),
    PurePosixPath("scripts/verify_public_package.py"),
    PurePosixPath(".github/workflows/verify-public-package.yml"),
}


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if value and name.lower() in {"href", "src", "poster"}:
                self.links.append(value)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def fail(message: str) -> None:
    raise ValueError(message)


def local_target(origin: PurePosixPath, reference: str) -> PurePosixPath | None:
    parsed = urlparse(reference)
    if parsed.scheme or parsed.netloc or reference.startswith(("#", "data:")):
        return None
    path = parsed.path
    if not path:
        return None
    candidate = PurePosixPath(path.lstrip("/")) if path.startswith("/") else origin.parent / path
    if str(candidate).endswith("/") or not candidate.suffix:
        candidate /= "index.html"
    return candidate


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    expected = {PurePosixPath(entry["archivo"]): entry["sha256"] for entry in manifest}
    if len(expected) != 63:
        fail(f"manifest count must be 63, got {len(expected)}")
    if any(path.is_absolute() or ".." in path.parts for path in expected):
        fail("manifest contains an unsafe route")

    actual = {
        path.relative_to(ROOT).as_posix() for path in ROOT.rglob("*")
        if path.is_file() and ".git" not in path.parts
    }
    allowed = {path.as_posix() for path in set(expected) | ALLOWED_AUXILIARY}
    unexpected = sorted(actual - allowed)
    missing = sorted(allowed - actual)
    if unexpected or missing:
        fail(f"allowlist mismatch; unexpected={unexpected}; missing={missing}")

    for relative, expected_hash in expected.items():
        path = ROOT / relative
        if sha256(path) != expected_hash:
            fail(f"sealed hash mismatch: {relative}")

    headers = (ROOT / "_headers").read_text(encoding="utf-8")
    if "Content-Security-Policy:" not in headers:
        fail("CSP header absent")
    csp = headers.split("Content-Security-Policy:", 1)[1].splitlines()[0]
    missing_csp = sorted(directive for directive in EXPECTED_CSP if directive not in csp)
    if missing_csp:
        fail(f"CSP directives missing: {missing_csp}")

    for relative in expected:
        path = ROOT / relative
        if path.suffix.lower() in {".html", ".js", ".css", ".md", ".txt", ".xml"}:
            match = DENYLIST.search(path.read_text(encoding="utf-8", errors="replace"))
            if match:
                fail(f"denylist match in {relative}: {match.group(0)[:16]}")

    for html_path in ROOT.rglob("*.html"):
        parser = LinkParser()
        parser.feed(html_path.read_text(encoding="utf-8"))
        origin = PurePosixPath(html_path.relative_to(ROOT).as_posix())
        for reference in parser.links:
            target = local_target(origin, reference)
            if target is not None and not (ROOT / target).is_file():
                fail(f"broken local route: {origin} -> {reference} ({target})")

    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap = ET.parse(ROOT / "sitemap.xml")
    for node in sitemap.findall("s:url/s:loc", namespace):
        parsed = urlparse(node.text or "")
        if parsed.scheme != "https" or parsed.netloc != "torsion-labs.com":
            fail(f"sitemap origin invalid: {node.text}")
        target = PurePosixPath(parsed.path.lstrip("/")) / "index.html"
        if not (ROOT / target).is_file():
            fail(f"sitemap route missing: {parsed.path}")

    print("VERIFY OK: 63 sealed files; allowlist, denylist, CSP and local routes valid.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError, ET.ParseError) as exc:
        print(f"VERIFY FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
