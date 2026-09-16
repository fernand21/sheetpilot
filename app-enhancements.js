(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const language = () => localStorage.getItem("littleapi:language") || document.documentElement.lang || "es";
  const text = (es, en) => language().toLowerCase().startsWith("en") ? en : es;

  function refreshEnhancementLanguage() {
    const list = $("#api-usage-list");
    const count = list ? list.querySelectorAll(".api-usage-card").length : 0;
    const countNode = $(".usage-api-count");
    const hint = $(".usage-scroll-hint");
    if (countNode) countNode.textContent = text(`${count} API${count === 1 ? "" : "s"} en la lista`, `${count} API${count === 1 ? "" : "s"} in the list`);
    if (hint) hint.textContent = count > 3 ? text("Desplázate dentro del panel para ver las demás.", "Scroll inside this panel to see the rest.") : "";
    const title = $(".query-help-title");
    const intro = $(".query-help-intro");
    const full = $(".query-full-label");
    const where = $(".query-where-label");
    const before = $(".query-tip-before");
    const andWord = $(".query-tip-and");
    if (title) title.textContent = text("Ejemplos listos para usar", "Ready-to-use examples");
    if (intro) intro.textContent = text("Pulsa un ejemplo para copiarlo al campo de consulta. LittleAPI reconoce los nombres de tus columnas y los traduce automáticamente para Google.", "Click an example to place it in the query field. LittleAPI recognizes your column names and maps them automatically for Google.");
    if (full) full.textContent = text("Consultas completas", "Full queries");
    if (where) where.textContent = text("Sólo condición WHERE", "WHERE condition only");
    if (before) before.textContent = text("Puedes combinar", "You can combine");
    if (andWord) andWord.textContent = text("y", "and");
  }

  function enhanceUsageList() {
    const list = $("#api-usage-list");
    if (!list || list.dataset.enhanced === "true") return;
    list.dataset.enhanced = "true";
    const heading = list.closest(".usage-section")?.querySelector(".section-heading");
    const toolbar = document.createElement("div");
    toolbar.className = "usage-list-toolbar";
    toolbar.innerHTML = '<strong class="usage-api-count"></strong><span class="usage-scroll-hint"></span>';
    heading?.insertAdjacentElement("afterend", toolbar);
    new MutationObserver(refreshEnhancementLanguage).observe(list, { childList: true, subtree: true });
    refreshEnhancementLanguage();
  }

  const queryExamples = [
    "SELECT * LIMIT 100",
    "SELECT Name, Status WHERE Status = 'ACTIVE'",
    "SELECT * WHERE Name CONTAINS 'ana'",
    "SELECT Name, Total WHERE Total > 100 ORDER BY Total DESC",
    "SELECT Product, SUM(Total) GROUP BY Product",
    "SELECT Issue, COUNT(Issue) GROUP BY Issue",
    "SELECT Name, Date WHERE Date >= date '2026-01-01' ORDER BY Date",
    "SELECT * ORDER BY Date DESC LIMIT 50 OFFSET 50"
  ];
  const whereExamples = [
    "Status = 'ACTIVE'",
    "Quantity > 10",
    "Name CONTAINS 'ana'",
    "Status = 'ACTIVE' AND City = 'Quito'",
    "Status = 'ACTIVE' OR Status = 'PENDING'",
    "Date >= date '2026-01-01'"
  ];

  function enhanceQueryPanel() {
    const panel = document.querySelector('[data-panel="query"]');
    if (!panel || panel.dataset.enhanced === "true") return;
    panel.dataset.enhanced = "true";
    const help = document.createElement("div");
    help.className = "query-help";
    help.innerHTML = `
      <div class="query-help-head"><div><h3 class="query-help-title"></h3><p class="query-help-intro"></p></div></div>
      <div class="query-example-group"><span class="query-example-label query-full-label"></span><div class="query-example-list" data-query-examples></div></div>
      <div class="query-example-group"><span class="query-example-label query-where-label"></span><div class="query-example-list" data-where-examples></div></div>
      <p class="query-tip"><span class="query-tip-before"></span> <code>SELECT</code>, <code>WHERE</code>, <code>AND</code>, <code>OR</code>, <code>CONTAINS</code>, <code>ORDER BY</code>, <code>GROUP BY</code>, <code>SUM</code>, <code>COUNT</code>, <code>AVG</code>, <code>MIN</code>, <code>MAX</code>, <code>LIMIT</code> <span class="query-tip-and"></span> <code>OFFSET</code>.</p>`;
    panel.insertBefore(help, panel.firstChild);
    const queryList = help.querySelector("[data-query-examples]");
    queryExamples.forEach((query) => {
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
    refreshEnhancementLanguage();
  }

  function bindLanguageRefresh() {
    const select = $("#language-select");
    if (!select || select.dataset.enhancementBound === "true") return;
    select.dataset.enhancementBound = "true";
    select.addEventListener("change", () => setTimeout(refreshEnhancementLanguage, 0));
  }

  function apply() { enhanceUsageList(); enhanceQueryPanel(); bindLanguageRefresh(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
})();
