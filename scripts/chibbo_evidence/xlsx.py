"""Write a plain-text XLSX workbook with the standard library only.

Every cell is an inline string, so a reader sees exactly the text the
exporter wrote (no number or date coercion).  GRC reads the workbook with
openpyxl, which accepts inline strings.
"""

from __future__ import annotations

from io import BytesIO
import re
from xml.sax.saxutils import escape
import zipfile

_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def _column(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _cell(value: str) -> str:
    text = escape(_ILLEGAL.sub("", value))
    space = ' xml:space="preserve"' if text != text.strip() or "\n" in text else ""
    return f'<is><t{space}>{text}</t></is>'


def _sheet(rows: list[list[str]]) -> str:
    lines = []
    for r, row in enumerate(rows, start=1):
        cells = "".join(
            f'<c r="{_column(c)}{r}" t="inlineStr">{_cell(value)}</c>'
            for c, value in enumerate(row) if value != ""
        )
        lines.append(f'<row r="{r}">{cells}</row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<sheetData>{"".join(lines)}</sheetData></worksheet>')


def workbook(sheets: list[tuple[str, list[list[str]]]]) -> bytes:
    """Return XLSX bytes for ``[(tab name, rows)]``; the archive is byte-stable."""

    if not sheets or len({name for name, _ in sheets}) != len(sheets):
        raise ValueError("sheet names must be present and unique")
    for name, _ in sheets:
        if not name or len(name) > 31 or any(ch in name for ch in "[]:*?/\\"):
            raise ValueError(f"invalid sheet name: {name!r}")
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                      for i in range(1, len(sheets) + 1))
            + "</Types>"),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<workbook xmlns="{main}" xmlns:r="{rel}"><sheets>'
            + "".join(f'<sheet name="{escape(name, {chr(34): "&quot;"})}" sheetId="{i}" r:id="rId{i}"/>'
                      for i, (name, _) in enumerate(sheets, start=1))
            + "</sheets></workbook>"),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i}" Type="{rel}/worksheet" Target="worksheets/sheet{i}.xml"/>'
                      for i in range(1, len(sheets) + 1))
            + "</Relationships>"),
    }
    for i, (_, rows) in enumerate(sheets, start=1):
        files[f"xl/worksheets/sheet{i}.xml"] = _sheet(rows)
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, text in files.items():
            info = zipfile.ZipInfo(path, _FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, text.encode("utf-8"))
    return buffer.getvalue()
