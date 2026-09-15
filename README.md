# LittleAPI

LittleAPI convierte libros de Google Sheets en datos y operaciones reutilizables desde una aplicación web estática. La primera versión funciona en GitHub Pages, autentica con Google y usa Supabase para guardar los proyectos de cada usuario.

## URLs reales

- Aplicación actual: https://fernand21.github.io/sheetpilot/
- Documentación: https://fernand21.github.io/sheetpilot/docs/
- Dominio de marca previsto: https://littleapi.online
- Repositorio: https://github.com/fernand21/sheetpilot
- Proyecto Supabase: https://dnwaapropjmoyqxquzvs.supabase.co
- Callback OAuth de Supabase: https://dnwaapropjmoyqxquzvs.supabase.co/auth/v1/callback

## Estado

La aplicación está en modo de pruebas de Google. Los usuarios deben estar incluidos en Google Cloud → Google Auth Platform → Audience → Test users. La verificación pública de marca se completará cuando el proyecto tenga un dominio propio verificado por DNS.

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

El archivo `config.js` contiene solamente la URL pública, la clave publishable y el client ID web de Google. Nunca agregues una clave `service_role` ni un client secret al repositorio.

## Scopes de Google

La primera versión solicita:

- https://www.googleapis.com/auth/spreadsheets
- https://www.googleapis.com/auth/drive

El segundo scope es amplio porque Drive necesita crear carpetas, subir, descargar, renombrar y eliminar archivos. En modo de pruebas funciona únicamente para las cuentas autorizadas. En producción Google puede solicitar verificación de marca y de acceso a datos.

## API pública

La Edge Function ya está desplegada en:

`https://dnwaapropjmoyqxquzvs.supabase.co/functions/v1/sheetpilot-api`

Al pulsar **Crear API** en un proyecto se genera una URL como:

`https://dnwaapropjmoyqxquzvs.supabase.co/functions/v1/sheetpilot-api/{API_ID}`

La primera versión pública ofrece `GET /{API_ID}`, `GET /search`, `GET /search_or`, `GET /keys`, `GET /name`, `GET /count` y `GET /cells/A1,B2`, con `limit`, `offset`, `sort_by`, `sort_order`, `cast_numbers`, `single_object` y `sheet`. La primera fila de la hoja se convierte en las propiedades de cada objeto JSON.

Para que una lectura funcione, la hoja debe estar publicada o compartida como “cualquiera con el enlace puede ver”. La pantalla de creación muestra la URL y genera una clave de administración; la clave se almacena únicamente como hash.

`POST`, `PATCH` y `DELETE` están reservados en la ruta y el panel del propietario ya permite CRUD usando OAuth de Google. Para habilitar escritura anónima de forma segura falta completar OAuth de servidor con refresh tokens cifrados. Las APIs públicas de Drive se añadirán cuando ese flujo de credenciales y permisos por carpeta esté listo.

## Publicar en GitHub Pages

1. En el repositorio abre Settings → Pages.
2. Selecciona Deploy from a branch.
3. Usa la rama main y la carpeta /(root).
4. Espera a que termine el despliegue.
5. Comprueba la aplicación y `/docs/`.

## Dominio propio

Cuando compres `littleapi.online`:

1. Configúralo como Custom domain en GitHub Pages.
2. Verifica la propiedad como Domain property en Search Console mediante DNS.
3. Usa el mismo dominio en la página principal, privacidad y términos de Google Cloud.
4. Añade el dominio como origen autorizado en el cliente OAuth.
5. Configura un proxy para que `/api/v1/{API_ID}` apunte a la Edge Function.
6. Solicita la verificación y publica la marca.

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
