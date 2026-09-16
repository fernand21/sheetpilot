from pathlib import Path
import re

path = Path("docs/index.html")
source = path.read_text(encoding="utf-8")

replacement = '''    <section id="query">
      <p class="eyebrow">PUBLIC API · ADVANCED QUERY</p><h2 data-t="queryTitle">Advanced SELECT queries from the public API</h2>
      <p data-t="queryLead">Use <code>/query</code> to run Google Visualization queries through LittleAPI. Write your real sheet header names such as Name, Total or Date; LittleAPI translates them to Google column letters automatically.</p>
      <div class="callout"><strong data-t="queryWhere">The same query language now works from the dashboard and from the public REST API.</strong></div>

      <h3 data-t="queryGet">1. GET: easiest way to test a query</h3>
      <pre>curl --get "https://littleapi.online/api/v1/YOUR_API_ID/query" \\
  --data-urlencode "sheet=Sales" \\
  --data-urlencode "q=SELECT Name, Total WHERE Total &gt; 100 ORDER BY Total DESC LIMIT 20"</pre>
      <p data-t="queryPublic">If Public Read is enabled, GET /query does not need an API key. For a private API, add <code>-H "X-API-Key: your apikey"</code>.</p>

      <h3 data-t="queryExamples">2. Copy-ready query examples</h3>
      <div class="plain-example">SELECT * LIMIT 100

SELECT Name, Status WHERE Status = 'ACTIVE'

SELECT * WHERE Name CONTAINS 'ana'

SELECT Name, Total WHERE Total &gt; 100 ORDER BY Total DESC

SELECT Product, SUM(Total) GROUP BY Product

SELECT Issue, COUNT(Issue) GROUP BY Issue

SELECT Product, AVG(Total), MIN(Total), MAX(Total) GROUP BY Product

SELECT Name, Date WHERE Date &gt;= date '2026-01-01' ORDER BY Date

SELECT Region, SUM(Total) GROUP BY Region PIVOT Year

SELECT Product, SUM(Total) GROUP BY Product LABEL SUM(Total) 'Sales Total'

SELECT * ORDER BY Date DESC LIMIT 50 OFFSET 50</div>

      <h3 data-t="queryPost">3. POST: better for long queries</h3>
      <pre>curl -X POST "https://littleapi.online/api/v1/YOUR_API_ID/query" \\
  -H "Content-Type: application/json" \\
  -d '{"sheet":"Sales","query":"SELECT Product, SUM(Total) GROUP BY Product"}'</pre>
      <p data-t="queryPrivatePost">For a private API, also add <code>-H "X-API-Key: your apikey"</code>. POST /query is still read-only; it never writes to your sheet.</p>

      <h3 data-t="queryOptions">4. Query options</h3>
      <div class="table-wrap"><table class="example-table"><thead><tr><th>Option</th><th data-t="purpose">Purpose</th><th data-t="example">Example</th></tr></thead><tbody>
        <tr><td><code>sheet</code></td><td data-t="querySheetOpt">Choose a tab.</td><td><code>sheet=Archive</code></td></tr>
        <tr><td><code>q</code> / <code>query</code></td><td data-t="queryTextOpt">The SELECT query.</td><td><code>q=SELECT Name LIMIT 10</code></td></tr>
        <tr><td><code>headers</code></td><td data-t="queryHeadersOpt">Number of header rows, from 0 to 10.</td><td><code>headers=1</code></td></tr>
        <tr><td><code>columns=names</code></td><td data-t="queryNamesOpt">Default: use human header names.</td><td><code>SELECT Product, Total</code></td></tr>
        <tr><td><code>columns=letters</code></td><td data-t="queryLettersOpt">Advanced mode: write A, B, C directly.</td><td><code>SELECT A, SUM(H) GROUP BY A</code></td></tr>
        <tr><td><code>raw=true</code></td><td data-t="queryRawOpt">Return only the result array.</td><td><code>?raw=true</code></td></tr>
      </tbody></table></div>

      <h3 data-t="queryUrlExample">5. Full URL example</h3>
      <div class="plain-example">https://littleapi.online/api/v1/YOUR_API_ID/query?sheet=Sales&amp;q=SELECT%20Name%2C%20Total%20WHERE%20Total%20%3E%20100%20ORDER%20BY%20Total%20DESC%20LIMIT%2020</div>

      <h3 data-t="queryResponse">6. What the response tells you</h3>
      <pre>{
  "data": [ ... ],
  "total": 20,
  "columns": ["Name", "Total"],
  "meta": {
    "sheet": "Sales",
    "query": "SELECT Name, Total WHERE Total &gt; 100",
    "translated_query": "SELECT A, H WHERE H &gt; 100",
    "header_rows": 1
  }
}</pre>
      <p data-t="queryNote">translated_query is useful for learning or debugging: it shows the Google column-letter query generated from your human header names. Use columns=letters only when you intentionally want to write A/B/C references yourself.</p>
    </section>
'''

pattern = r'    <section id="query">.*?</section>\n\n    <section id="aggregations">'
match = re.search(pattern, source, flags=re.S)
if not match:
    raise SystemExit("query section not found")
source = source[:match.start()] + replacement + '\n    <section id="aggregations">' + source[match.end():]

replacements = {
    'queryTitle:"Advanced query examples"': 'queryTitle:"Advanced SELECT queries from the public API"',
    'queryLead:"The LittleAPI workspace includes a Google Visualization query editor. It automatically maps your header names to Google column letters before running the query."': 'queryLead:"Use /query to run Google Visualization queries through LittleAPI. Write your real sheet header names such as Name, Total or Date; LittleAPI translates them to Google column letters automatically."',
    'queryWhere:"You can use these directly in App → Project → Queries."': 'queryWhere:"The same query language now works from the dashboard and from the public REST API."',
    'queryNote:"For public REST URLs, use the filter examples above. The full SELECT query editor is currently a workspace tool."': 'queryNote:"translated_query is useful for learning or debugging: it shows the Google column-letter query generated from your human header names. Use columns=letters only when you intentionally want to write A/B/C references yourself."',
    'queryTitle:"Ejemplos de consultas avanzadas"': 'queryTitle:"Consultas SELECT avanzadas desde la API pública"',
    'queryLead:"El workspace de LittleAPI incluye un editor Google Visualization Query. Convierte automáticamente los nombres de tus encabezados a las letras que Google necesita."': 'queryLead:"Usa /query para ejecutar consultas Google Visualization mediante LittleAPI. Escribe los nombres reales de tus encabezados, como Nombre, Total o Fecha; LittleAPI los convierte automáticamente a las letras de columna de Google."',
    'queryWhere:"Puedes usar estos ejemplos directamente en Aplicación → Proyecto → Consultas."': 'queryWhere:"El mismo lenguaje de consulta ahora funciona desde el panel y desde la API REST pública."',
    'queryNote:"Para URLs REST públicas usa los filtros de la sección anterior. El editor SELECT completo actualmente es una herramienta del workspace."': 'queryNote:"translated_query sirve para aprender o depurar: muestra la consulta con letras de columna que LittleAPI generó a partir de tus encabezados. Usa columns=letters sólo cuando quieras escribir referencias A/B/C manualmente."'
}
for old, new in replacements.items():
    if old not in source:
        raise SystemExit("translation marker not found: " + old[:60])
    source = source.replace(old, new, 1)

en_marker = 'queryNote:"translated_query is useful for learning or debugging: it shows the Google column-letter query generated from your human header names. Use columns=letters only when you intentionally want to write A/B/C references yourself."'
en_extra = en_marker + ',queryGet:"1. GET: easiest way to test a query",queryPublic:"If Public Read is enabled, GET /query does not need an API key. For a private API, add X-API-Key: your apikey.",queryExamples:"2. Copy-ready query examples",queryPost:"3. POST: better for long queries",queryPrivatePost:"For a private API, also add X-API-Key: your apikey. POST /query is still read-only; it never writes to your sheet.",queryOptions:"4. Query options",example:"Example",querySheetOpt:"Choose a tab.",queryTextOpt:"The SELECT query.",queryHeadersOpt:"Number of header rows, from 0 to 10.",queryNamesOpt:"Default: use human header names.",queryLettersOpt:"Advanced mode: write A, B, C directly.",queryRawOpt:"Return only the result array.",queryUrlExample:"5. Full URL example",queryResponse:"6. What the response tells you"'
source = source.replace(en_marker, en_extra, 1)

es_marker = 'queryNote:"translated_query sirve para aprender o depurar: muestra la consulta con letras de columna que LittleAPI generó a partir de tus encabezados. Usa columns=letters sólo cuando quieras escribir referencias A/B/C manualmente."'
es_extra = es_marker + ',queryGet:"1. GET: la forma más fácil de probar una consulta",queryPublic:"Si Public Read está activado, GET /query no necesita clave API. En una API privada añade X-API-Key: your apikey.",queryExamples:"2. Ejemplos de consulta listos para copiar",queryPost:"3. POST: mejor para consultas largas",queryPrivatePost:"En una API privada añade también X-API-Key: your apikey. POST /query sigue siendo sólo lectura; nunca escribe en tu hoja.",queryOptions:"4. Opciones de la consulta",example:"Ejemplo",querySheetOpt:"Elige una pestaña.",queryTextOpt:"La consulta SELECT.",queryHeadersOpt:"Cantidad de filas de encabezado, de 0 a 10.",queryNamesOpt:"Predeterminado: usa nombres humanos de encabezado.",queryLettersOpt:"Modo avanzado: escribe A, B, C directamente.",queryRawOpt:"Devuelve únicamente el array de resultados.",queryUrlExample:"5. Ejemplo de URL completa",queryResponse:"6. Qué te muestra la respuesta"'
source = source.replace(es_marker, es_extra, 1)

path.write_text(source, encoding="utf-8")
