(function () {
  let config = {
    enabled: false,
    delaySeconds: 15,
    sites: []
  };

  async function loadConfig() {
    const result = await chrome.storage.sync.get("config");
    config = SlowdownAddition.sanitizeConfig(result.config);
  }

  function shouldHandleClick(event, anchor) {
    if (event.defaultPrevented || event.button !== 0) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }
    if (anchor.target && anchor.target.toLowerCase() !== "_self") {
      return false;
    }
    return true;
  }

  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor || !shouldHandleClick(event, anchor)) {
        return;
      }

      const targetUrl = anchor.href;
      if (!SlowdownAddition.findMatchingSite(config, targetUrl)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ type: "delayNavigate", targetUrl });
    },
    true
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.config) {
      config = SlowdownAddition.sanitizeConfig(changes.config.newValue);
    }
  });

  loadConfig().catch(console.error);
})();
