"""
Inject Discovery + Sign in into the marketing pages' top nav and drawer.
Idempotent: skips pages where the link is already present.

Run from the repo root: python scripts/inject-nav-links.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MAIN_PAGES = [
    "index.html",
    "faq/index.html",
    "how-we-work/index.html",
    "sectors/index.html",
]
LEGAL_PAGES = [
    "privacy/index.html",
    "terms/index.html",
]


def add_discovery_link_in_main_nav(html: str) -> tuple[str, bool]:
    """Add <li><a href="/discovery">Discovery</a></li> between FAQ and Contact in the top nav."""
    if '<a href="/discovery">Discovery</a>' in html:
        return html, False
    pattern = re.compile(
        r'(\s*<li><a href="/faq">FAQ</a></li>)\n(\s*)(<li><a href="/#contact">Contact</a></li>)'
    )
    new_html, n = pattern.subn(
        r'\1\n\2<li><a href="/discovery">Discovery</a></li>\n\2\3',
        html,
        count=1,
    )
    return new_html, n > 0


def add_signin_button(html: str) -> tuple[str, bool]:
    """Insert a Sign in ghost button between the FLORIDA — LIMA pill and the Submit case → primary CTA."""
    if 'class="btn btn-ghost" data-event="nav_signin_click"' in html:
        return html, False
    # On index.html the Submit-case button uses href="#contact"; on subpages
    # (faq, how-we-work, sectors) it uses href="/#contact" (absolute anchor).
    pattern = re.compile(
        r'(<span class="pill"><span class="dot"></span>FLORIDA — LIMA</span>)\s*\n(\s*)(<a href="(?:/)?#contact" class="btn btn-primary" data-event="nav_cta_click">Submit case →</a>)'
    )
    new_html, n = pattern.subn(
        r'\1\n\2<a href="/discovery/login" class="btn btn-ghost" data-event="nav_signin_click">Sign in</a>\n\2\3',
        html,
        count=1,
    )
    return new_html, n > 0


def add_drawer_links(html: str) -> tuple[str, bool]:
    """Add Discovery + Sign in to the nav-drawer between FAQ and Contact."""
    # The drawer items are NOT inside the top nav. Find the drawer block.
    if html.count('<a href="/discovery">Discovery</a>') >= 2:
        return html, False
    pattern = re.compile(
        r'(<div class="nav-drawer"[^>]*>.*?)(\s*<li><a href="/faq">FAQ</a></li>)\n(\s*)(<li><a href="/#contact">Contact</a></li>)',
        re.DOTALL,
    )
    new_html, n = pattern.subn(
        r'\1\2\n\3<li><a href="/discovery">Discovery</a></li>\n\3<li><a href="/discovery/login">Sign in</a></li>\n\3\4',
        html,
        count=1,
    )
    return new_html, n > 0


def add_discovery_link_legal(html: str) -> tuple[str, bool]:
    """For privacy/terms pages: add Discovery between FAQ and Contact (may have different indentation)."""
    if '<a href="/discovery">Discovery</a>' in html:
        return html, False
    pattern = re.compile(
        r'(\s*<li><a href="/faq">FAQ</a></li>)\n(\s*)(<li><a href="/#contact">Contact</a></li>)'
    )
    new_html, n = pattern.subn(
        r'\1\n\2<li><a href="/discovery">Discovery</a></li>\n\2\3',
        html,
        count=0,  # replace ALL occurrences (both top nav + drawer)
    )
    return new_html, n > 0


def process(path: Path, transforms) -> dict:
    if not path.exists():
        return {"path": str(path), "skipped": "file not found"}
    html = path.read_text(encoding="utf-8")
    result = {"path": str(path.relative_to(ROOT))}
    changed = False
    for name, fn in transforms:
        html, did = fn(html)
        result[name] = "added" if did else "no-op"
        changed = changed or did
    if changed:
        path.write_text(html, encoding="utf-8")
    result["written"] = changed
    return result


def main():
    main_transforms = [
        ("nav_link", add_discovery_link_in_main_nav),
        ("signin_btn", add_signin_button),
        ("drawer", add_drawer_links),
    ]
    legal_transforms = [
        ("nav_link", add_discovery_link_legal),
    ]

    print("=== Main pages (with drawer) ===")
    for rel in MAIN_PAGES:
        r = process(ROOT / rel, main_transforms)
        print(f"  {r}")

    print("=== Legal pages ===")
    for rel in LEGAL_PAGES:
        r = process(ROOT / rel, legal_transforms)
        print(f"  {r}")


if __name__ == "__main__":
    main()
