# LittleAPI

LittleAPI convierte libros de Google Sheets en datos y operaciones reutilizables desde una aplicación web estática. La primera versión funciona en GitHub Pages, autentica con Google y usa Supabase para guardar los proyectos de cada usuario.

## URLs reales

- Aplicación actual: https://fernand21.github.io/sheetpilot/
- Documentación: https://fernand21.github.io/sheetpilot/docs/
- Dominio de marca activo: https://littleapi.online
- Repositorio: https://github.com/fernand21/sheetpilot
- Proyecto Supabase: https://dnwaapropjmoyqxquzvs.supabase.co
- Callback OAuth de Supabase: https://dnwaapropjmoyqxquzvs.supabase.co/auth/v1/callback

## Estado

La aplicación está en modo de pruebas de Google. Los usuarios deben estar incluidos en Google Cloud → Google Auth Platform → Audience → Test users. El dominio propio está conectado por GitHub Pages; la verificación pública de marca sigue dependiendo de completar el proceso de OAuth y de publicar la pantalla de consentimiento.

## Qué incluye la versión web

- Inicio de sesión únicamente con Google.
- Selección de libros de Sheets del Drive del usuario.
- Panel privado con proyectos y RLS por usuario.
- Lectura de rangos y búsqueda por columna.
- Actualización de celdas y rangos con valores USER_ENTERED.
- Inserción y eliminación de filas.
- Vaciar rangos.
- Crear, renombrar y eliminar pestañas.
- Copiar pestañas a otro libro conectado.
- Formatear rangos y encabezados, cambiar colores y ajustar columnas.
- Consultas Google Visualization y filtros avanzados.
- Suma, conteo y COUNTIF por columna.
- Descarga CSV y Excel.
- Listado, búsqueda, creación de carpetas, subida, descarga, renombrado y eliminación de archivos de Drive.
- Consulta de cuota de almacenamiento de Drive.
- Páginas públicas de privacidad, términos y documentación.

Las funciones están inspiradas en los métodos públicos de `Gsheetsplus` de `F:\bibliotecas cf\Gsheetsplus`.

## Inicio rápido

1. Abre https://fernand21.github.io/sheetpilot/.
2. Entra con la cuenta de Google incluida como usuario de prueba.
3. Acepta los permisos de Google Sheets y Google Drive.
4. Pulsa Nuevo proyecto y elige un libro.
5. Abre el proyecto y usa sus pestañas de Datos, Editar, Pestañas, Formato, Consultas y Estadísticas.

## Configuración de Supabase

1. Abre el SQL Editor del proyecto `dnwaapropjmoyqxquzvs`.
2. Ejecuta el contenido de `supabase-schema.sql` y después `supabase-api-schema.sql`.
3. En Authentication → URL Configuration agrega:
   - https://fernand21.github.io/sheetpilot/
4. En Authentication → Providers → Google confirma que el proveedor esté activo.
5. En la configuración de Google Cloud usa como callback:
   - https://dnwaapropjmoyqxquzvs.supabase.co/auth/v1/callback
6. En Google Cloud → APIs y servicios → Credenciales → cliente OAuth web, registra como **Orígenes autorizados de JavaScript** exactamente:
   - https://littleapi.online
   - https://www.littleapi.online
   - https://fernand21.github.io

No agregues /sheetpilot/ ni / al campo de origen. Google compara sólo el origen (protocolo, dominio y puerto), por eso un dominio sin registrar produce Error 400: origin_mismatch.

El archivo `config.js` contiene solamente la URL pública, la clave publishable y el client ID web de Google. Nunca agregues una clave `service_role` ni un client secret al repositorio.

## Scopes de Google

La primera versión solicita:

- https://www.googleapis.com/auth/spreadsheets
- https://www.googleapis.com/auth/drive
- https://www.googleapis.com/auth/drive.file

LittleAPI usa estos alcances para cubrir todas las operaciones de `Gsheetsplus`: Sheets para editar libros y Drive para listar, buscar, crear, subir, descargar, renombrar y eliminar archivos del Drive del propio usuario. En modo de pruebas sólo acceden las cuentas autorizadas. Para publicar la aplicación a usuarios generales, Google puede solicitar verificación de los alcances sensibles y restringidos.

## API pública

La Edge Function ya está desplegada en:

`https://dnwaapropjmoyqxquzvs.supabase.co/functions/v1/sheetpilot-api`

Al pulsar **Crear API** en un proyecto se genera una URL como:

`https://dnwaapropjmoyqxquzvs.supabase.co/functions/v1/sheetpilot-api/{API_ID}`

La API pública ofrece `GET /{API_ID}`, `GET /search`, `GET /search_or`, `GET /keys`, `GET /name`, `GET /count`, `GET /cells/A1,B2`, `GET /metadata`, `GET /openapi.json` y `GET /stats`. La primera fila de la hoja se convierte en las propiedades de cada objeto JSON y las respuestas de filas usan `{data,total,limit,offset,meta}`. Usa `legacy=true` si necesitas la matriz de objetos de la primera versión.

Al crear una API, LittleAPI intenta compartir automáticamente la hoja como “cualquiera con el enlace puede ver” (rol lector). Si Google no permite ese cambio, puedes compartirla manualmente desde Drive. La pantalla de creación muestra la URL y genera una clave de administración; la clave se muestra al propietario autenticado y se guarda cifrada, mientras que el hash se usa para validarla.

`POST`, `PATCH` y `DELETE` funcionan desde cualquier aplicación sin login, siempre que envíes `X-API-Key`. El servidor usa el refresh token cifrado del propietario para llamar a Google. También están disponibles `POST/PATCH/DELETE /{API_ID}/sheets`, `POST /format`, `POST /clear`, `POST /batch` y operaciones de Drive en APIs registradas como `resource_type=drive`.

### CRUD desde cualquier lenguaje

```bash
# Insertar una o varias filas
curl -X POST "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"data":{"nombre":"Ana","estado":"ACTIVO"}}'

# Actualizar filas que cumplan la condición
curl -X PATCH "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"where":{"id":"42"},"data":{"estado":"CERRADO"}}'

# Eliminar filas que cumplan la condición
curl -X DELETE "$API" -H "X-API-Key: $LITTLEAPI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"where":{"id":"42"}}'
```

La API acepta filtros exactos (`?estado=ACTIVO`), `contains[campo]=texto`, texto completo (`?search=texto`), orden (`sort`/`order`), paginación (`limit`/`offset`), conversión numérica (`cast_numbers`) y agregados (`group_by`, `count`, `sum`, `avg`). La caché de lectura se controla con `cache_ttl` entre 0 y 3600 segundos.

### Secretos necesarios para escrituras

En Supabase → Edge Functions → Secrets configura, sin subirlos a GitHub:

- `GOOGLE_CLIENT_ID`: client ID web del proyecto de Google Cloud.
- `GOOGLE_CLIENT_SECRET`: client secret del mismo cliente OAuth.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: secreto aleatorio largo para cifrar refresh tokens.

Después cierra sesión y vuelve a entrar con Google aceptando Sheets y Drive. El navegador envía el `provider_refresh_token` al endpoint interno `/auth/google/connect`; nunca se muestra ni se guarda en el cliente. Sin esos tres secretos el API mantiene las lecturas, pero responde con un error claro para las escrituras.

## Publicar en GitHub Pages

1. En el repositorio abre Settings → Pages.
2. Selecciona Deploy from a branch.
3. Usa la rama main y la carpeta /(root).
4. Espera a que termine el despliegue.
5. Comprueba la aplicación y `/docs/`.

## Dominio propio

Configuración actual de `littleapi.online`:

1. Configúralo como Custom domain en GitHub Pages.
2. Verifica la propiedad como Domain property en Search Console mediante DNS.
3. Usa el mismo dominio en la página principal, privacidad y términos de Google Cloud.
4. Añade `https://littleapi.online` y `https://www.littleapi.online` como orígenes autorizados en el cliente OAuth.
5. Configura un proxy (Cloudflare Worker, por ejemplo) para que `/api/v1/{API_ID}` apunte a la Edge Function; GitHub Pages por sí solo no ejecuta rutas dinámicas.
6. Solicita la verificación y publica la marca cuando la pantalla de consentimiento esté completa.

### Proxy de Cloudflare para la URL de marca

El archivo `cloudflare-worker.js` contiene un Worker sin secretos que conserva la web en GitHub Pages y sólo reenvía las rutas `/api/v1/*` a Supabase. Para activarlo:

1. Añade `littleapi.online` en Cloudflare y cambia en Namecheap los nameservers por los dos que Cloudflare indique. No se migra el alojamiento: conserva los cuatro registros A de GitHub Pages y el CNAME `www`.
2. En Cloudflare → Workers & Pages crea un Worker llamado `littleapi-api-proxy`, abre **Edit code**, pega el contenido de `cloudflare-worker.js` y pulsa **Deploy**.
3. En el Worker abre **Settings → Triggers → Routes → Add route** y registra `littleapi.online/api/v1/*`, seleccionando `littleapi-api-proxy`.
4. Espera la propagación DNS y prueba `https://littleapi.online/api/v1/{API_ID}`. Las peticiones que no empiezan por `/api/v1/` continúan llegando a GitHub Pages.

Mientras el Worker no esté activo, usa la URL de Supabase indicada arriba. Cuando la ruta de Cloudflare responda correctamente se puede cambiar `apiBase` en `config.js` a `https://littleapi.online/api/v1`.

## Estructura

- `index.html`: aplicación y panel de usuario.
- `app.js`: autenticación, Google Sheets, Google Drive y operaciones.
- `styles.css`: interfaz.
- `config.js`: configuración pública del proyecto.
- `supabase-schema.sql`: tabla projects, grants y políticas RLS.
- `supabase-api-schema.sql`: registro privado de APIs, catálogo público mínimo, grants y políticas RLS.
- `supabase/functions/sheetpilot-api/index.ts`: Edge Function REST.
- `privacy.html`: política de privacidad.
- `terms.html`: términos de uso.
- `docs/index.html`: documentación pública.

## Licencia y responsabilidad

LittleAPI es un proyecto independiente. El usuario conserva la responsabilidad sobre sus hojas, permisos y datos. Los nombres Google Sheets, Google Drive y Supabase pertenecen a sus respectivos propietarios.
