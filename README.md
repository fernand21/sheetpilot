# LittleAPI

LittleAPI convierte un libro de Google Sheets o un recurso de Google Drive en una API REST con una URL propia. Los consumidores pueden consultar datos desde cualquier lugar sin iniciar sesión; las operaciones que cambian información se protegen con `X-API-Key`.

## Enlaces

- Aplicación: <https://littleapi.online/app.html>
- Documentación: <https://littleapi.online/docs/>
- Precios: <https://littleapi.online/pricing.html>
- API de ejemplo: <https://littleapi.online/api/v1/9t2tde_YJNMzmdV691O_>
- OpenAPI de ejemplo: <https://littleapi.online/api/v1/9t2tde_YJNMzmdV691O_/openapi.json>
- Código: <https://github.com/fernand21/sheetpilot>

## Cómo publicar una API

1. Entra en [LittleAPI](https://littleapi.online/) con Google.
2. Acepta los permisos de Google Sheets y Google Drive.
3. Crea un proyecto y selecciona un libro o recurso.
4. Pulsa **Crear API** y copia la URL y la clave de administración.
5. Comparte la hoja como **cualquiera con el enlace puede ver** si quieres habilitar lecturas públicas.

La URL resultante es:

```text
https://littleapi.online/api/v1/{API_ID}
```

La clave completa sólo aparece al propietario autenticado. Se usa en la cabecera `X-API-Key` y nunca debe publicarse en el navegador.

## Operaciones disponibles

### Lectura

- `GET /{API_ID}`: filas con `data`, `total`, `limit`, `offset` y `meta`.
- `GET /{API_ID}/search` y `/search_or`: filtros por columna, texto completo, comodines y comparadores.
- `GET /{API_ID}/keys`, `/name`, `/count`, `/cells/A1,B2`, `/metadata`.
- `GET /{API_ID}/stats`: conteo, suma, promedio, mínimo y máximo.
- `GET /{API_ID}/usage`: consumo mensual de la API (requiere `X-API-Key`).
- `GET /{API_ID}/export.csv`: descarga CSV, incluso sin clave si la lectura es pública.
- `GET /{API_ID}/openapi.json`: contrato OpenAPI listo para importar.

### Escritura

Todas las siguientes rutas funcionan desde cualquier lenguaje, sin login del consumidor, enviando `X-API-Key`:

- `POST /{API_ID}`: inserta una fila, una lista o `{ "rows": [...] }`.
- `PATCH /{API_ID}`: actualiza con `{ "where": {...}, "data": {...} }` o escribe un rango con `{ "range", "values" }`.
- `DELETE /{API_ID}`: elimina filas con `{ "where": {...} }`.
- `GET/POST /{API_ID}/sheets`: lista o crea pestañas.
- `PATCH/DELETE /{API_ID}/sheets/{NOMBRE}`: renombra o elimina pestañas.
- `POST /{API_ID}/sheets/copy`: copia una pestaña a otro libro.
- `POST /{API_ID}/format`: aplica formato a un rango.
- `POST /{API_ID}/clear`: limpia un rango.
- `POST /{API_ID}/batch`: ejecuta de 1 a 50 solicitudes de Google Sheets.
- `GET /{API_ID}/export.xlsx`: descarga el libro como Excel.

Las APIs de tipo Drive añaden listar carpetas, buscar por nombre, crear, subir contenido base64, descargar, renombrar, borrar, consultar cuota y consultar información de la cuenta.

Cada API empieza con 5.000 consultas mensuales. Al agotarlas, LittleAPI responde HTTP `429` con `error: "quota_exceeded"`, el uso actual y `reset_at`. El contador se reinicia cada mes UTC; consulta `/usage` para mostrarlo en tu panel.

## Ejemplos rápidos

```bash
API="https://littleapi.online/api/v1/TU_API_ID"
LITTLEAPI_KEY="sp_live_TU_CLAVE"

# Lectura pública
curl "$API?limit=20&sort=nombre&order=asc"

# Insertar
curl -X POST "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"nombre":"Ana","estado":"ACTIVO"}}'

# Actualizar por condición
curl -X PATCH "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"where":{"id":"42"},"data":{"estado":"CERRADO"}}'

# Eliminar por condición
curl -X DELETE "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" -d '{"where":{"id":"42"}}'
```

Consulta la [documentación completa](https://littleapi.online/docs/) para ejemplos en JavaScript, Python, PHP y Drive.

## Estructura del proyecto

- `index.html`, `app.js`, `styles.css`: aplicación web y panel de administración.
- `docs/index.html`: referencia pública de LittleAPI.
- `cloudflare-worker.js`: ruta de marca `/api/v1/*`.
- `supabase/functions/sheetpilot-api/index.ts`: motor REST de LittleAPI.
- `supabase-api-schema.sql`: registro de APIs, permisos y claves cifradas.
- `privacy.html`, `terms.html`: páginas legales.

## Seguridad

La API sólo expone públicamente lo que el propietario haya marcado como lectura pública. El propietario conserva la responsabilidad sobre sus hojas, permisos y datos. No subas claves de servidor, secretos de Google ni claves de cifrado al repositorio.
