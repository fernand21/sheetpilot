# LittleAPI JavaScript SDK

Official source SDK for LittleAPI. This folder is served by the LittleAPI site, but it is **not yet published to npm**.

## Browser / ESM

```js
import { LittleAPI } from "https://littleapi.online/sdk/javascript/littleapi.js";

const api = new LittleAPI({
  apiId: "YOUR_API_ID",
  apiKey: "your apikey" // omit for public reads
});

const rows = await api.list({ sheet: "Sales", limit: 100 });
console.log(rows.data);
```

## Advanced query

```js
const result = await api.query(
  "SELECT Product, SUM(Total) GROUP BY Product ORDER BY SUM(Total) DESC",
  { sheet: "Sales" }
);
```

## Insert

```js
await api.insert({ Name: "Ana", Status: "ACTIVE", Total: 125.50 }, { sheet: "Sales" });

await api.insert([
  { Name: "Ana", Status: "ACTIVE" },
  { Name: "Luis", Status: "PENDING" }
], { sheet: "Sales" });
```

## Update / delete

```js
await api.update({ ID: "42" }, { Status: "DONE" }, { sheet: "Sales" });
await api.deleteRows({ Status: "CANCELLED" }, { sheet: "Sales" });
```

## Format

```js
await api.format("A1:F1", {
  bold: true,
  fontSize: 14,
  bgColor: "#087a70",
  textColor: "#ffffff"
}, { sheet: "Sales" });
```

## Tabs

```js
const tabs = await api.sheets();
await api.createSheet("Archive 2026");
await api.renameSheet("Archive 2026", "Closed 2026");
```

## Google Drive

Use a Drive API ID and an API key:

```js
const drive = new LittleAPI({ apiId: "YOUR_DRIVE_API_ID", apiKey: "your apikey" });
const files = await drive.driveChildren("FOLDER_ID", { pageSize: 100 });
const matches = await drive.driveSearch({ name: "invoice" });
```

See the complete product documentation at `https://littleapi.online/docs/`.
