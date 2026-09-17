# LittleAPI

LittleAPI convierte Google Sheets y Google Drive en una API REST con una URL propia. También puede convertir una pestaña de Google Sheets en un **widget embebible** listo para insertar en una web con un `<iframe>`.

Los consumidores pueden consultar datos públicos sin iniciar sesión. Las operaciones privadas y de escritura se protegen con `X-API-Key`, y las claves adicionales pueden tener permisos separados para lectura, búsqueda, creación, edición y eliminación.

## Enlaces

- Aplicación: <https://littleapi.online/app.html>
- Documentación completa: <https://littleapi.online/docs/>
- Guía de widgets: <https://littleapi.online/docs/widgets.html>
- Precios: <https://littleapi.online/pricing.html>
- API de ejemplo: <https://littleapi.online/api/v1/9t2tde_YJNMzmdV691O_>
- OpenAPI de ejemplo: <https://littleapi.online/api/v1/9t2tde_YJNMzmdV691O_/openapi.json>
- Código: <https://github.com/fernand21/sheetpilot>

## Qué puedes publicar

### 1. API REST

Cada API usa una URL estable:

```text
https://littleapi.online/api/v1/{API_ID}
```

Desde ella puedes leer, buscar, consultar, insertar, actualizar, eliminar, exportar y administrar datos según los permisos de la API y la clave utilizada.

### 2. Widget embebible

Desde **View endpoint → Widget embebible** puedes generar un iframe para mostrar datos en otra web sin construir una interfaz desde cero.

El generador permite:

- Elegir la pestaña del libro.
- Detectar los encabezados de la primera fila.
- Elegir qué columnas se muestran.
- Cambiar el orden visual de las columnas sin modificar Google Sheets.
- Elegir vista de tabla o tarjetas.
- Elegir tema automático, oscuro o claro.
- Elegir cuántas filas mostrar por página; el valor inicial es 25 y admite hasta 100.
- Mostrar `Página X de Y`.
- Saltar directamente a una página concreta escribiendo el número y pulsando Enter.
- Buscar en toda la pestaña, no sólo en la página visible.
- Mantener los resultados de búsqueda paginados.

Ejemplo:

```html
<iframe
  src="https://littleapi.online/embed.html?api=TU_API_ID&sheet=Cartera&col=D&col=B&col=C&page_size=25&lang=es&title=Cartera"
  title="Cartera"
  loading="lazy"
  style="width:100%;height:520px;border:0;border-radius:16px;overflow:hidden"
  referrerpolicy="strict-origin-when-cross-origin">
</iframe>
```

El widget requiere **Lectura pública**. LittleAPI **nunca inserta `X-API-Key` dentro del iframe**.

## Cómo publicar una API

1. Entra en [LittleAPI](https://littleapi.online/app.html) con Google.
2. Acepta los permisos de Google Sheets y Google Drive necesarios para las funciones que quieras usar.
3. Crea un proyecto y selecciona un libro o recurso.
4. Pulsa **Crear API** y copia la URL y la clave de administración.
5. Abre **View endpoint** para configurar permisos, claves adicionales y el widget embebible.
6. Activa **Lectura pública** únicamente si los datos deben ser visibles sin clave.

La clave completa se muestra al propietario cuando se crea o regenera. Se usa en la cabecera `X-API-Key` y no debe publicarse en código cliente accesible a terceros.

## Permisos y claves adicionales

LittleAPI separa las operaciones principales en permisos independientes:

- Leer.
- Buscar / consultar.
- Crear.
- Editar.
- Eliminar.

Puedes crear claves adicionales, por ejemplo una clave `Postman Read Only`, y habilitar sólo lectura y búsqueda. Una operación no autorizada debe responder `403 permission_denied`.

## Operaciones disponibles

### Lectura

- `GET /{API_ID}`: filas con metadatos, paginación y selección de columnas.
- `GET /{API_ID}/search` y `/search_or`: filtros por columna, texto completo, comodines y comparadores.
- `GET /{API_ID}/query`: consultas SELECT avanzadas usando nombres de encabezado o letras de columna.
- `GET /{API_ID}/keys`, `/name`, `/count`, `/cells/A1,B2`, `/metadata`.
- `GET /{API_ID}/stats`: conteo, suma, promedio, mínimo y máximo.
- `GET /{API_ID}/usage`: consumo mensual de la API, cuando corresponde.
- `GET /{API_ID}/export.csv`: descarga CSV.
- `GET /{API_ID}/openapi.json`: contrato OpenAPI listo para importar.

### Escritura

Las rutas de escritura requieren `X-API-Key` y el permiso correspondiente:

- `POST /{API_ID}`: inserta filas.
- `PATCH /{API_ID}`: actualiza filas o rangos.
- `DELETE /{API_ID}`: elimina filas.
- `GET/POST /{API_ID}/sheets`: lista o crea pestañas.
- `PATCH/DELETE /{API_ID}/sheets/{NOMBRE}`: renombra o elimina pestañas.
- `POST /{API_ID}/sheets/copy`: copia una pestaña a otro libro.
- `POST /{API_ID}/format`: aplica formato.
- `POST /{API_ID}/clear`: limpia un rango.
- `POST /{API_ID}/batch`: ejecuta operaciones batch de Google Sheets.
- `GET /{API_ID}/export.xlsx`: exporta el libro como Excel cuando el plan lo permite.

Las APIs de tipo Drive añaden operaciones para listar carpetas, buscar, crear, subir contenido base64, descargar, renombrar, borrar y consultar cuota.

## Paginación y hojas grandes

Para lecturas REST puedes usar `limit` y `offset`:

```text
https://littleapi.online/api/v1/TU_API_ID?limit=100&offset=0
https://littleapi.online/api/v1/TU_API_ID?limit=100&offset=100
```

El widget utiliza una estrategia más ligera: solicita sólo la página necesaria y usa `LIMIT + OFFSET`. Para búsquedas globales, recorre la hoja progresivamente por bloques en lugar de pedir toda la hoja en una sola ejecución.

Esto evita volver al problema de cargar una hoja grande completa sólo para mostrar una página pequeña.

## Ejemplos rápidos

```bash
API="https://littleapi.online/api/v1/TU_API_ID"
LITTLEAPI_KEY="sp_live_TU_CLAVE"

# Lectura pública
curl "$API?limit=20&sort_by=nombre&sort_order=asc"

# Consulta avanzada
curl --get "$API/query" \
  --data-urlencode "sheet=Ventas" \
  --data-urlencode "q=SELECT Nombre, Total WHERE Total > 100 ORDER BY Total DESC LIMIT 20"

# Insertar
curl -X POST "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana","estado":"ACTIVO"}'

# Actualizar por condición
curl -X PATCH "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"where":{"id":"42"},"data":{"estado":"CERRADO"}}'

# Eliminar por condición
curl -X DELETE "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"where":{"id":"42"}}'
```

## Planes

Los planes mantienen el mismo flujo de trabajo y cambian principalmente la capacidad y las operaciones avanzadas.

- **Free**: 2 APIs activas, 5.000 consultas por API/mes, lectura pública, documentación, OpenAPI y widget embebible.
- **Initial**: 10 APIs, 50.000 consultas por API/mes y operaciones CRUD protegidas.
- **Pro**: 50 APIs, 250.000 consultas por API/mes, Google Drive, administración de pestañas, batch, exportación Excel y capacidades avanzadas.
- **Business**: 200 APIs, 1.000.000 de consultas por API/mes, cuotas personalizadas y soporte prioritario.

Consulta la página de [precios](https://littleapi.online/pricing.html) para la comparación actual y las condiciones de renovación manual.

## Estructura del proyecto

- `index.html`, `app.js`, `styles.css`: sitio y panel principal.
- `app.html`: espacio de trabajo de LittleAPI.
- `widget-embed.js`: generador del widget dentro de View endpoint.
- `embed.html`: widget público embebible.
- `docs/index.html`: referencia REST.
- `docs/widgets.html`: guía del widget embebible.
- `cloudflare-worker.js`: ruta pública `/api/v1/*`.
- `supabase/functions/sheetpilot-api/`: motor REST de LittleAPI.
- `supabase-api-schema.sql`: registro de APIs, permisos y claves.
- `privacy.html`, `terms.html`: páginas legales.

## Seguridad

La API sólo expone públicamente lo que el propietario haya marcado como lectura pública. Mantén claves de administración, claves adicionales con permisos de escritura y secretos de Google fuera de páginas públicas, repositorios públicos y screenshots.
