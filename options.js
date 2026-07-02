(function () {
  const CONFIG_KEY = "config";
  const enabled = document.getElementById("enabled");
  const delaySeconds = document.getElementById("delaySeconds");
  const addSite = document.getElementById("addSite");
  const save = document.getElementById("save");
  const sites = document.getElementById("sites");
  const status = document.getElementById("status");

  let config = SlowdownAddition.cloneDefaultConfig();

  function createSiteRow(site) {
    const row = document.createElement("div");
    row.className = "site-row";

    const activeLabel = document.createElement("label");
    activeLabel.className = "check";
    const active = document.createElement("input");
    active.type = "checkbox";
    active.checked = site.enabled;
    active.dataset.field = "enabled";
    activeLabel.append(active);

    const domain = document.createElement("input");
    domain.type = "text";
    domain.placeholder = "example.com";
    domain.value = site.domain;
    domain.dataset.field = "domain";

    const note = document.createElement("textarea");
    note.rows = 2;
    note.placeholder = "Why do you want this site slowed down?";
    note.value = site.note;
    note.dataset.field = "note";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      row.remove();
      status.textContent = "Unsaved changes.";
    });

    row.append(activeLabel, domain, note, remove);
    return row;
  }

  function render() {
    enabled.checked = config.enabled;
    delaySeconds.value = String(config.delaySeconds);
    sites.replaceChildren(...config.sites.map(createSiteRow));
  }

  function readRows() {
    return [...sites.querySelectorAll(".site-row")].map((row) => ({
      enabled: row.querySelector('[data-field="enabled"]').checked,
      domain: row.querySelector('[data-field="domain"]').value,
      note: row.querySelector('[data-field="note"]').value
    }));
  }

  async function load() {
    const result = await chrome.storage.sync.get(CONFIG_KEY);
    config = SlowdownAddition.sanitizeConfig(result[CONFIG_KEY]);
    render();
  }

  async function saveConfig() {
    const nextConfig = SlowdownAddition.sanitizeConfig({
      enabled: enabled.checked,
      delaySeconds: delaySeconds.value,
      sites: readRows()
    });

    if (nextConfig.sites.length !== readRows().length) {
      status.textContent = "Some invalid or duplicate domains were removed.";
    } else {
      status.textContent = "Saved.";
    }

    config = nextConfig;
    await chrome.storage.sync.set({ [CONFIG_KEY]: config });
    render();
  }

  addSite.addEventListener("click", () => {
    sites.append(
      createSiteRow({
        domain: "",
        enabled: true,
        note: ""
      })
    );
    status.textContent = "Unsaved changes.";
  });

  save.addEventListener("click", () => {
    saveConfig().catch((error) => {
      status.textContent = error.message;
    });
  });

  sites.addEventListener("input", () => {
    status.textContent = "Unsaved changes.";
  });
  enabled.addEventListener("change", () => {
    status.textContent = "Unsaved changes.";
  });
  delaySeconds.addEventListener("input", () => {
    status.textContent = "Unsaved changes.";
  });

  load().catch((error) => {
    status.textContent = error.message;
  });
})();
