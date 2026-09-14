# SheetPilot

Primera versión de una aplicación web para convertir hojas de Google Sheets en APIs. Está hecha para publicarse gratis en GitHub Pages y usa Supabase Auth para el registro e inicio de sesión de usuarios.

## Qué incluye

- Página pública orientada al producto.
- Registro e inicio de sesión con correo y contraseña.
- Sesión persistente y panel privado del usuario.
- Esquema SQL con RLS: cada usuario solo puede acceder a sus propios proyectos.
- Base visual para el siguiente paso: conectar Google Sheets y crear una API.

## Conectar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **Authentication > URL Configuration**, agrega la URL de GitHub Pages cuando la tengas. Para probar localmente, agrega `http://localhost:5500`.
3. Copia `config.example.js` como `config.js`.
4. En **Project Settings > API**, copia el Project URL y la clave **Publishable** (o `anon` heredada) a `config.js`.
5. En **SQL Editor**, ejecuta el contenido de `supabase-schema.sql`.
6. En **Authentication > Providers > Email**, deja habilitado Email. Puedes dejar activa la confirmación de correo.

La clave publishable/anon es pública por diseño. Nunca agregues una clave `service_role` o secreta al repositorio.

## Publicar en GitHub Pages

1. Sube este proyecto a GitHub.
2. En el repositorio abre **Settings > Pages**.
3. Elige **Deploy from a branch**, selecciona `main` y carpeta `/(root)`.
4. Añade esa URL publicada también en las Redirect URLs de Supabase.

Antes de publicar, crea el archivo `config.js`. Está excluido de Git para que puedas configurarlo sin compartir valores innecesarios; puedes publicar una copia con la URL y clave publishable si prefieres que funcione directamente desde GitHub Pages.

## Próximo paso

Añadir la conexión OAuth con Google, guardar el ID de cada hoja en `projects` y desplegar una Edge Function de Supabase que entregue la API JSON.
