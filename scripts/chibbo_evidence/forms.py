"""Read the sections of a pull-request body or a GitHub issue form."""

from __future__ import annotations

import re

_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_HEADING = re.compile(r"^(#{2,3})\s+(.+?)\s*#*\s*$")
_ASSET = re.compile(r"\bA-\d{2}\b")
_EMPTY = {"", "_no response_", "none", "n/a", "-"}


def sections(body: str | None) -> dict[str, str]:
    """Map each ``##``/``###`` heading to the text under it, comments removed.

    Issue forms render every field as ``### <label>`` followed by its value
    (``_No response_`` when an optional field is empty); the pull-request
    template uses ``## <section>``.  The first heading with a given title wins.
    """

    text = _COMMENT.sub("", (body or "").replace("\r\n", "\n"))
    result: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in text.split("\n"):
        match = _HEADING.match(line)
        if match:
            title = match.group(2).strip()
            current = None if title in result else result.setdefault(title, [])
            continue
        if current is not None:
            current.append(line)
    return {title: "\n".join(lines).strip() for title, lines in result.items()}


def filled(value: str | None) -> bool:
    return (value or "").strip().lower() not in _EMPTY


def value(fields: dict[str, str], title: str) -> str:
    text = fields.get(title, "")
    return text if filled(text) else ""


def asset_id(text: str | None) -> str:
    """The first ``A-NN`` asset ID in a field, or an empty string."""

    match = _ASSET.search(text or "")
    return match.group(0) if match else ""
