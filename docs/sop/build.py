#!/usr/bin/env python3
"""Render each MatrixIQ SOP HTML source to an A4 PDF via WeasyPrint.

Usage:  venv/bin/python build.py [name ...]
With no arguments every *.html in this directory is rendered.
"""
import sys
import pathlib
from weasyprint import HTML

HERE = pathlib.Path(__file__).resolve().parent

TITLES = {
    "accounts": "MatrixIQ — Accounts Module SOP",
    "administration": "MatrixIQ — Administration Module SOP",
    "hr": "MatrixIQ — HR Module SOP",
    "marketing": "MatrixIQ — Marketing Module SOP",
    "operations": "MatrixIQ — Operations Module SOP",
    "partner-portal": "MatrixIQ — Partner Portal SOP",
}


def render(stem: str) -> pathlib.Path:
    src = HERE / f"{stem}.html"
    if not src.exists():
        raise SystemExit(f"missing source: {src}")
    out = HERE / f"{TITLES.get(stem, stem)}.pdf"
    doc = HTML(filename=str(src), base_url=str(HERE)).render()
    doc.write_pdf(str(out))
    print(f"{out.name}  —  {len(doc.pages)} pages")
    return out


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(p.stem for p in HERE.glob("*.html"))
    for n in names:
        render(n)
