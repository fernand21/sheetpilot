(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const language = () => localStorage.getItem("littleapi:language") || document.documentElement.lang || "es";
  const text = (es, en) => language().toLowerCase().startsWith("en") ? en : es;

  function enhanceUsageList() {
    const list = $("#api-usage-list");
    if (!list || list.dataset.enhanced === "true") return;
    list.dataset.enhanced = "true";
    const heading = list.closest(".usage-section")?.querySelector(".section-heading");
    const toolbar = document.createElement("div");
    toolbar.className = "usage-list-toolbar";
    toolbar.innerHTML = '<strong class="usage-api-count"></strong><span class="usage-scroll-hint"></span>';
    heading?.insertAdjacentElement("afterend", toolbar);
    const update = () => {
      const count = list.querySelectorAll(".api-usage-card").length;
      const countNode = toolbar.querySelector(".usage-api-count");
      const hint = toolbar.querySelector(".usage-scroll-hint");
      if (countNode) countNode.textContent = text(`${count} API${count === 1 ? "" : "s"} en la lista`, `${count} API${count === 1 ? "" : "s"} in the list`);
      if (hint) hint.textContent = count > 3 ? text("Desplázate dentro del panel para ver las demás.", "Scroll inside this panel to see the rest.") : "";
    };
    new MutationObserver(update).observe(list, { childList: true, subtree: true });
    update();
  }

  const queryExamples = [
    ["all", "SELECT * LIMIT 100", "SELECT * LIMIT 100"],
    ["filter", "SELECT Nombre, Estado WHERE Estado = 'ACTIVO'", "SELECT Nombre, Estado WHERE Estado = 'ACTIVO'"],
    ["contains", "SELECT * WHERE Nombre CONTAINS 'ana'", "SELECT * WHERE Nombre CONTAINS 'ana'"],
    ["number", "SELECT Nombre, Total WHERE Total > 100 ORDER BY Total DESC", "SELECT Nombre, Total WHERE Total > 100 ORDER BY Total DESC"],
    ["group", "SELECT Producto, SUM(Total) GROUP BY Producto", "SELECT Producto, SUM(Total) GROUP BY Producto"],
    ["count", "SELECT Novedades, COUNT(Novedades) GROUP BY Novedades", "SELECT Novedades, COUNT(Novedades) GROUP BY Novedades"],
    ["date", "SELECT Nombre, Fecha WHERE Fecha >= date '2026-01-01' ORDER BY Fecha", "SELECT Nombre, Fecha WHERE Fecha >= date '2026-01-01' ORDER BY Fecha"],
    ["page", "SELECT * ORDER BY Fecha DESC LIMIT 50 OFFSET 50", "SELECT * ORDER BY Fecha DESC LIMIT 50 OFFSET 50"]
  ];
  const whereExamples = [
    "Estado = 'ACTIVO'",
    "Cantidad > 10",
    "Nombre CONTAINS 'ana'",
    "Estado = 'ACTIVO' AND Ciudad = 'Quito'",
    "Estado = 'ACTIVO' OR Estado = 'PENDIENTE'",
    "Fecha >= date '2026-01-01'"
  ];

  function enhanceQueryPanel() {
    const panel = document.querySelector('[data-panel="query"]');
    if (!panel || panel.dataset.enhanced === "true") return;
    panel.dataset.enhanced = "true";
    const help = document.createElement("div");
    help.className = "query-help";
    help.innerHTML = `
      <div class="query-help-head"><div><h3>${text("Ejemplos listos para usar", "Ready-to-use examples")}</h3><p>${text("Pulsa un ejemplo para copiarlo al campo de consulta. LittleAPI reconoce los nombres de tus columnas y los traduce automáticamente para Google.", "Click an example to place it in the query field. LittleAPI recognizes your column names and maps them automatically for Google.")}</p></div></div>
      <div class="query-example-group"><span class="query-example-label">${text("Consultas completas", "Full queries")}</span><div class="query-example-list" data-query-examples></div></div>
      <div class="query-example-group"><span class="query-example-label">${text("Sólo condición WHERE", "WHERE condition only")}</span><div class="query-example-list" data-where-examples></div></div>
      <p class="query-tip">${text("Puedes combinar", "You can combine")} <code>SELECT</code>, <code>WHERE</code>, <code>AND</code>, <code>OR</code>, <code>CONTAINS</code>, <code>ORDER BY</code>, <code>GROUP BY</code>, <code>SUM</code>, <code>COUNT</code>, <code>AVG</code>, <code>MIN</code>, <code>MAX</code>, <code>LIMIT</code> ${text("y", "and")} <code>OFFSET</code>.</p>`;
    panel.insertBefore(help, panel.firstChild);
    const queryList = help.querySelector("[data-query-examples]");
    queryExamples.forEach(([, query]) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "query-example"; button.textContent = query;
      button.onclick = () => { const field = $("#custom-query"); if (field) { field.value = query; field.focus(); } };
      queryList.appendChild(button);
    });
    const whereList = help.querySelector("[data-where-examples]");
    whereExamples.forEach((query) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "query-example"; button.textContent = query;
      button.onclick = () => { const field = $("#advanced-where"); if (field) { field.value = query; field.focus(); } };
      whereList.appendChild(button);
    });
  }

  function apply() { enhanceUsageList(); enhanceQueryPanel(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
})();
