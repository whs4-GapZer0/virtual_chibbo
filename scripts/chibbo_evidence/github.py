"""Read-only GitHub REST calls the TVM exporter needs (repository-scoped token)."""

from __future__ import annotations

from io import BytesIO
import json
import re
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile

API = "https://api.github.com"
MAX_PAGES = 50
MAX_ARTIFACT_BYTES = 5_000_000
_NEXT = re.compile(r'<([^>]+)>;\s*rel="next"')


class GitHubError(RuntimeError):
    """A GitHub read failed; the export must not claim complete coverage."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003 - urllib signature
        return None


class GitHub:
    def __init__(self, token: str, repository: str, *, api: str = API):
        if not token or not re.fullmatch(r"[\w.-]+/[\w.-]+", repository or ""):
            raise GitHubError("GITHUB_TOKEN과 GITHUB_REPOSITORY가 필요합니다.")
        self.token, self.repository, self.api = token, repository, api.rstrip("/")
        self._opener = build_opener(_NoRedirect)
        self._pr_for_sha: dict[str, int | None] = {}

    # -- transport ---------------------------------------------------------
    def _open(self, url: str, *, authorized: bool = True, accept: str = "application/vnd.github+json") -> Any:
        headers = {"Accept": accept, "User-Agent": "chibbo-tvm-export", "X-GitHub-Api-Version": "2022-11-28"}
        if authorized:
            headers["Authorization"] = f"Bearer {self.token}"
        for attempt in range(4):
            try:
                return self._opener.open(Request(url, headers=headers), timeout=30)
            except HTTPError as error:
                if error.code in {301, 302, 303, 307, 308}:
                    return error
                retry = error.code >= 500 or (error.code in {403, 429} and error.headers.get("Retry-After"))
                if not retry or attempt == 3:
                    raise GitHubError(f"GitHub {error.code}: {url}") from error
                time.sleep(min(int(error.headers.get("Retry-After") or 2 ** attempt), 60))
            except (URLError, TimeoutError, OSError) as error:
                if attempt == 3:
                    raise GitHubError(f"GitHub 연결 실패: {url}") from error
                time.sleep(2 ** attempt)
        raise GitHubError(f"GitHub 요청 실패: {url}")

    def _json(self, path: str, query: dict[str, Any] | None = None) -> tuple[Any, str | None]:
        url = path if path.startswith("http") else f"{self.api}{path}"
        if query:
            url += ("&" if "?" in url else "?") + urlencode(query)
        response = self._open(url)
        try:
            payload = json.loads(response.read().decode("utf-8"))
        except ValueError as error:
            raise GitHubError(f"GitHub 응답 형식 오류: {url}") from error
        match = _NEXT.search(response.headers.get("Link") or "")
        return payload, match.group(1) if match else None

    def _pages(self, path: str, query: dict[str, Any] | None = None, *, key: str | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        url: str | None = path
        params = {**(query or {}), "per_page": 100}
        for _ in range(MAX_PAGES):
            payload, url = self._json(url, params)
            params = None  # the "next" link already carries the query
            page = payload.get(key) if key else payload
            if not isinstance(page, list):
                raise GitHubError(f"GitHub 목록 응답 형식 오류: {path}")
            items.extend(page)
            if not url:
                return items
        raise GitHubError(f"GitHub 목록이 {MAX_PAGES}쪽을 넘었습니다: {path}")

    # -- records -----------------------------------------------------------
    def merged_pulls(self) -> list[dict[str, Any]]:
        """Every merged pull request into main, each with its reviews."""

        pulls = [pull for pull in self._pages(f"/repos/{self.repository}/pulls",
                                               {"state": "closed", "base": "main", "sort": "created", "direction": "desc"})
                 if pull.get("merged_at")]
        for pull in pulls:
            pull["reviews"] = self._pages(f"/repos/{self.repository}/pulls/{pull['number']}/reviews")
        return pulls

    def workflow_runs(self, workflow_file: str, since: str) -> list[dict[str, Any]]:
        return self._pages(f"/repos/{self.repository}/actions/workflows/{workflow_file}/runs",
                           {"created": f">={since}"}, key="workflow_runs")

    def pull_for_commit(self, sha: str) -> int | None:
        """The pull request whose merge commit is exactly ``sha``."""

        if sha not in self._pr_for_sha:
            pulls = self._pages(f"/repos/{self.repository}/commits/{sha}/pulls")
            numbers = [pull["number"] for pull in pulls if pull.get("merged_at") and pull.get("merge_commit_sha") == sha]
            self._pr_for_sha[sha] = numbers[0] if len(numbers) == 1 else None
        return self._pr_for_sha[sha]

    def issues(self, label: str) -> list[dict[str, Any]]:
        """Issues (not pull requests) with ``label``, each with its label events."""

        issues = [issue for issue in self._pages(f"/repos/{self.repository}/issues", {"labels": label, "state": "all"})
                  if "pull_request" not in issue]
        for issue in issues:
            issue["label_events"] = [
                {"event": event["event"], "label": (event.get("label") or {}).get("name", ""),
                 "actor": ((event.get("actor") or {}).get("login") or ""), "created_at": event.get("created_at", "")}
                for event in self._pages(f"/repos/{self.repository}/issues/{issue['number']}/events")
                if event.get("event") in {"labeled", "unlabeled"}
            ]
        return issues

    def run_artifact_json(self, run_id: int, name: str) -> list[dict[str, Any]]:
        """JSON files inside the run's artifact ``name`` (empty when absent or expired)."""

        artifacts = self._pages(f"/repos/{self.repository}/actions/runs/{run_id}/artifacts", key="artifacts")
        found = []
        for artifact in artifacts:
            if artifact.get("name") != name or artifact.get("expired"):
                continue
            if int(artifact.get("size_in_bytes") or 0) > MAX_ARTIFACT_BYTES:
                raise GitHubError(f"산출물 {name}이(가) 너무 큽니다: run {run_id}")
            redirect = self._open(f"{self.api}/repos/{self.repository}/actions/artifacts/{artifact['id']}/zip")
            location = redirect.headers.get("Location") if hasattr(redirect, "headers") else None
            # The archive lives on a pre-signed URL; the token is never sent there.
            data = self._open(location, authorized=False, accept="*/*").read(MAX_ARTIFACT_BYTES + 1) if location else redirect.read()
            if len(data) > MAX_ARTIFACT_BYTES:
                raise GitHubError(f"산출물 {name}이(가) 너무 큽니다: run {run_id}")
            try:
                with zipfile.ZipFile(BytesIO(data)) as archive:
                    for entry in archive.infolist():
                        if entry.filename.endswith(".json") and entry.file_size <= MAX_ARTIFACT_BYTES:
                            found.append(json.loads(archive.read(entry).decode("utf-8")))
            except (zipfile.BadZipFile, ValueError) as error:
                raise GitHubError(f"산출물 {name}을(를) 읽지 못했습니다: run {run_id}") from error
        return found
