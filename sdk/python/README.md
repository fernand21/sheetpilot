# LittleAPI Python SDK

Official source SDK for LittleAPI using only the Python standard library. This source is **not yet published to PyPI**.

```python
from littleapi import LittleAPI

api = LittleAPI("YOUR_API_ID", "your apikey")

rows = api.list(sheet="Sales", limit=100)
print(rows["data"])
```

## Advanced query

```python
result = api.query(
    "SELECT Product, SUM(Total) GROUP BY Product ORDER BY SUM(Total) DESC",
    sheet="Sales"
)
```

## Insert / update / delete

```python
api.insert({"Name": "Ana", "Status": "ACTIVE", "Total": 125.50}, sheet="Sales")
api.update({"ID": "42"}, {"Status": "DONE"}, sheet="Sales")
api.delete_rows({"Status": "CANCELLED"}, sheet="Sales")
```

## Format

```python
api.format("A1:F1", {
    "bold": True,
    "fontSize": 14,
    "bgColor": "#087a70",
    "textColor": "#ffffff"
}, sheet="Sales")
```

## Google Drive

```python
drive = LittleAPI("YOUR_DRIVE_API_ID", "your apikey")
files = drive.drive_children("FOLDER_ID", page_size=100)
matches = drive.drive_search(name="invoice")
```

Complete documentation: `https://littleapi.online/docs/`.
