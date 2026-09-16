"""LittleAPI Python SDK.

Standard-library client for https://littleapi.online.
This source is not yet published to PyPI.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, Mapping, Optional
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

DEFAULT_BASE_URL = "https://littleapi.online/api/v1"


class LittleAPIError(RuntimeError):
    def __init__(self, message: str, *, status: int = 0, code: str = "request_failed", details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


def _params(values: Optional[Mapping[str, Any]]) -> str:
    pairs = []
    for key, value in (values or {}).items():
        if value is None or value == "":
            continue
        if isinstance(value, (list, tuple)):
            pairs.extend((key, str(item)) for item in value)
        elif isinstance(value, bool):
            pairs.append((key, "true" if value else "false"))
        else:
            pairs.append((key, str(value)))
    return urlencode(pairs, doseq=True)


class LittleAPI:
    def __init__(self, api_id: str, api_key: str = "", base_url: str = DEFAULT_BASE_URL, timeout: int = 30):
        if not api_id:
            raise ValueError("api_id is required")
        self.api_id = str(api_id)
        self.api_key = str(api_key or "")
        self.base_url = str(base_url or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout

    def url(self, path: str = "", params: Optional[Mapping[str, Any]] = None) -> str:
        suffix = str(path or "").lstrip("/")
        url = f"{self.base_url}/{quote(self.api_id, safe='')}"
        if suffix:
            url += "/" + suffix
        query = _params(params)
        return url + (("?" + query) if query else "")

    def request(self, path: str = "", *, method: str = "GET", params: Optional[Mapping[str, Any]] = None,
                body: Any = None, headers: Optional[Mapping[str, str]] = None, response_type: str = "json") -> Any:
        request_headers: Dict[str, str] = {
            "User-Agent": "LittleAPI-Python/1.0",
            "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
            **dict(headers or {}),
        }
        if self.api_key and "X-API-Key" not in request_headers:
            request_headers["X-API-Key"] = self.api_key
        payload = None
        if body is not None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        req = Request(self.url(path, params), data=payload, headers=request_headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout) as response:
                raw = response.read()
                if response_type == "bytes":
                    return raw
                text = raw.decode("utf-8", errors="replace")
                if response_type == "text":
                    return text
                return json.loads(text) if text else None
        except HTTPError as error:
            raw = error.read()
            text = raw.decode("utf-8", errors="replace")
            try:
                data = json.loads(text)
            except Exception:
                data = {}
            raise LittleAPIError(
                data.get("message") or data.get("error") or f"LittleAPI returned HTTP {error.code}",
                status=error.code,
                code=data.get("error", "request_failed"),
                details=data.get("details"),
            ) from error

    # Google Sheets reads
    def list(self, **options: Any) -> Any:
        return self.request(params=options)

    def search(self, filters: Optional[Mapping[str, Any]] = None, **options: Any) -> Any:
        return self.request("search", params={**options, **dict(filters or {})})

    def search_or(self, filters: Optional[Mapping[str, Any]] = None, **options: Any) -> Any:
        return self.request("search_or", params={**options, **dict(filters or {})})

    def columns(self, sheet: Optional[str] = None) -> Any:
        return self.request("keys", params={"sheet": sheet})

    def count(self, sheet: Optional[str] = None) -> Any:
        return self.request("count", params={"sheet": sheet})

    def cells(self, coordinates: Iterable[str] | str, sheet: Optional[str] = None) -> Any:
        value = ",".join(coordinates) if not isinstance(coordinates, str) else coordinates
        return self.request("cells/" + quote(value, safe=","), params={"sheet": sheet})

    def stats(self, column: str = "", sheet: Optional[str] = None) -> Any:
        return self.request("stats", params={"sheet": sheet, "column": column})

    def metadata(self) -> Any:
        return self.request("metadata")

    def openapi(self) -> Any:
        return self.request("openapi.json")

    def usage(self) -> Any:
        return self.request("usage")

    def query(self, query: str, *, sheet: Optional[str] = None, headers: int = 1,
              columns: str = "names", raw: bool = False, method: str = "auto") -> Any:
        use_post = method.upper() == "POST" or (method.lower() == "auto" and len(str(query)) > 1200)
        if use_post:
            return self.request("query", method="POST", body={"query": query, "sheet": sheet, "headers": headers, "columns": columns, "raw": raw})
        return self.request("query", params={"q": query, "sheet": sheet, "headers": headers, "columns": columns, "raw": raw})

    # Google Sheets writes
    def insert(self, rows: Any, sheet: Optional[str] = None) -> Any:
        return self.request(method="POST", params={"sheet": sheet}, body=rows)

    def update(self, where: Optional[Mapping[str, Any]], data: Mapping[str, Any], *, sheet: Optional[str] = None,
               casesensitive: bool = False, all_rows: bool = False) -> Any:
        body: Dict[str, Any] = {"data": dict(data), "casesensitive": casesensitive}
        body.update({"all": True} if all_rows else {"where": dict(where or {})})
        return self.request(method="PATCH", params={"sheet": sheet}, body=body)

    def update_range(self, range_a1: str, values: list, sheet: Optional[str] = None) -> Any:
        return self.request(method="PATCH", params={"sheet": sheet}, body={"range": range_a1, "values": values})

    def delete_rows(self, where: Optional[Mapping[str, Any]] = None, *, sheet: Optional[str] = None,
                    casesensitive: bool = False, all_rows: bool = False) -> Any:
        body: Dict[str, Any] = {"casesensitive": casesensitive}
        body.update({"all": True} if all_rows else {"where": dict(where or {})})
        return self.request(method="DELETE", params={"sheet": sheet}, body=body)

    def clear(self, range_a1: str, sheet: Optional[str] = None) -> Any:
        return self.request("clear", method="POST", body={"sheet": sheet, "range": range_a1})

    def format(self, range_a1: str, format_options: Mapping[str, Any], *, sheet: Optional[str] = None,
               grid_range: Optional[Mapping[str, Any]] = None) -> Any:
        body = {"sheet": sheet, **dict(format_options)}
        if grid_range is not None:
            body["gridRange"] = dict(grid_range)
        else:
            body["range"] = range_a1
        return self.request("format", method="PATCH", body=body)

    def batch(self, requests: list) -> Any:
        return self.request("batch", method="POST", body={"requests": requests})

    # Sheet tabs
    def sheets(self) -> Any:
        return self.request("sheets")

    def create_sheet(self, name: str) -> Any:
        return self.request("sheets", method="POST", body={"name": name})

    def rename_sheet(self, name: str, new_name: str) -> Any:
        return self.request("sheets/" + quote(name, safe=""), method="PATCH", body={"name": new_name})

    def delete_sheet(self, name: str) -> Any:
        return self.request("sheets/" + quote(name, safe=""), method="DELETE")

    def copy_sheet(self, sheet: str, destination_spreadsheet_id: str) -> Any:
        return self.request("sheets/copy", method="POST", body={"sheet": sheet, "destination_spreadsheet_id": destination_spreadsheet_id})

    # Exports
    def export_json(self, **options: Any) -> Any:
        return self.request("export.json", params=options)

    def export_csv(self, sheet: Optional[str] = None) -> str:
        return self.request("export.csv", params={"sheet": sheet}, response_type="text")

    def export_xlsx(self) -> bytes:
        return self.request("export.xlsx", response_type="bytes")

    # Google Drive
    def drive_file(self, file_id: str = "") -> Any:
        return self.request(quote(file_id, safe="") if file_id else "")

    def drive_children(self, folder_id: str, **options: Any) -> Any:
        return self.request("children/" + quote(folder_id, safe=""), params=options)

    def drive_search(self, *, name: Optional[str] = None, parent_id: Optional[str] = None,
                     page_size: Optional[int] = None, page_token: Optional[str] = None,
                     order_by: Optional[str] = None) -> Any:
        return self.request("search", params={"name": name, "parent_id": parent_id, "page_size": page_size, "page_token": page_token, "order_by": order_by})

    def drive_quota(self) -> Any:
        return self.request("quota")

    def drive_about(self) -> Any:
        return self.request("about")

    def drive_create(self, name: str, *, mime_type: str = "application/octet-stream", parent_id: str = "",
                     parents: Optional[list] = None, content_base64: Optional[str] = None) -> Any:
        path = quote(parent_id, safe="") if parent_id else ""
        body: Dict[str, Any] = {"name": name, "mimeType": mime_type}
        if parents is not None:
            body["parents"] = parents
        if content_base64:
            body["content_base64"] = content_base64
        return self.request(path, method="POST", body=body)

    def drive_rename(self, file_id: str, name: str) -> Any:
        return self.request(quote(file_id, safe=""), method="PATCH", body={"name": name})

    def drive_delete(self, file_id: str) -> Any:
        return self.request(quote(file_id, safe=""), method="DELETE")

    def drive_download(self, file_id: str) -> bytes:
        return self.request("download/" + quote(file_id, safe=""), response_type="bytes")

    def drive_export(self, file_id: str, mime_type: str) -> bytes:
        return self.request("export/" + quote(file_id, safe=""), params={"mime_type": mime_type}, response_type="bytes")
