(function () {
  const CONFIG_KEY = "config";
  const countdown = document.getElementById("countdown");
  const note = document.getElementById("note");
  const target = document.getElementById("target");
  const siteLine = document.getElementById("siteLine");

  let targetUrl = "";
  let remaining = 15;
  let timerId = null;
  let continuing = false;

  function parseTargetUrl() {
    const prefix = "#target=";
    if (!location.hash.startsWith(prefix)) {
      return "";
    }
    return location.hash.slice(prefix.length);
  }

  async function getCurrentTabId() {
    const tab = await chrome.tabs.getCurrent();
    return tab && tab.id;
  }

  async function continueToTarget() {
    if (continuing || !targetUrl) {
      return;
    }

    continuing = true;

    const tabId = await getCurrentTabId();
    const response = await chrome.runtime.sendMessage({
      type: "continueToTarget",
      targetUrl,
      tabId
    });

    if (!response || !response.ok) {
      continuing = false;
      note.textContent = "Could not continue. Check the extension service worker console for details.";
    }
  }

  function startTimer(seconds) {
    remaining = seconds;
    countdown.textContent = String(remaining);
    timerId = window.setInterval(() => {
      remaining -= 1;
      countdown.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) {
        window.clearInterval(timerId);
        continueToTarget().catch(console.error);
      }
    }, 1000);
  }

  async function init() {
    targetUrl = parseTargetUrl();
    if (!targetUrl) {
      siteLine.textContent = "No target URL was provided.";
      return;
    }

    const result = await chrome.storage.sync.get(CONFIG_KEY);
    const config = SlowdownAddition.sanitizeConfig(result[CONFIG_KEY]);
    const site = SlowdownAddition.findMatchingSite(config, targetUrl);
    const url = new URL(targetUrl);

    siteLine.textContent = url.hostname;
    target.textContent = targetUrl;
    note.textContent = site && site.note ? site.note : "Take a short pause before continuing.";

    if (!site) {
      await continueToTarget();
      return;
    }

    startTimer(config.delaySeconds);
  }

  init().catch((error) => {
    note.textContent = error.message;
  });
})();
