importScripts("shared.js");

const REDIRECT_RULE_BASE = 1000;
const ALLOW_RULE_BASE = 100000;
const ALLOW_TTL_MS = 60000;
const GRACE_TTL_MS = 2500;
const CONFIG_KEY = "config";
const ALLOW_RECORDS_KEY = "allowRecords";
const ALLOW_COUNTER_KEY = "allowCounter";
const TAB_GRACE_KEY = "tabGrace";
let redirectSyncPromise = Promise.resolve();

const {
  cloneDefaultConfig,
  sanitizeConfig,
  getActiveSites,
  findMatchingSite,
  exactUrlRegex,
  domainRegex
} = SlowdownAddition;

async function readConfig() {
  const result = await chrome.storage.sync.get(CONFIG_KEY);
  const config = sanitizeConfig(result[CONFIG_KEY]);
  if (!result[CONFIG_KEY]) {
    await chrome.storage.sync.set({ [CONFIG_KEY]: cloneDefaultConfig() });
  }
  return config;
}

async function syncRedirectRules() {
  const config = await readConfig();
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRedirectIds = oldRules
    .map((rule) => rule.id)
    .filter((id) => id >= REDIRECT_RULE_BASE && id < ALLOW_RULE_BASE);

  const redirectUrl = chrome.runtime.getURL("/delay.html#target=\\0");
  const addRules = getActiveSites(config).map((site, index) => ({
    id: REDIRECT_RULE_BASE + index,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: redirectUrl
      }
    },
    condition: {
      regexFilter: domainRegex(site.domain),
      resourceTypes: ["main_frame"]
    }
  }));

  if (oldRedirectIds.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldRedirectIds
    });
  }

  if (addRules.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules
    });
  }
}

function scheduleRedirectRuleSync() {
  redirectSyncPromise = redirectSyncPromise
    .then(() => syncRedirectRules())
    .catch((error) => {
      console.error(error);
    });
  return redirectSyncPromise;
}

async function getSessionValue(key, fallback) {
  const result = await chrome.storage.session.get(key);
  return result[key] === undefined ? fallback : result[key];
}

async function setSessionValue(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

async function nextAllowRuleId() {
  const current = await getSessionValue(ALLOW_COUNTER_KEY, ALLOW_RULE_BASE);
  const next = current + 1;
  await setSessionValue(ALLOW_COUNTER_KEY, next);
  return next;
}

async function getAllowRecords() {
  return getSessionValue(ALLOW_RECORDS_KEY, []);
}

async function setAllowRecords(records) {
  await setSessionValue(ALLOW_RECORDS_KEY, records);
}

async function removeAllowRules(ruleIds) {
  if (!ruleIds.length) {
    return;
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: ruleIds
  });

  const removeSet = new Set(ruleIds);
  const records = await getAllowRecords();
  await setAllowRecords(records.filter((record) => !removeSet.has(record.id)));
}

function withoutHash(urlValue) {
  try {
    const url = new URL(urlValue);
    url.hash = "";
    return url.href;
  } catch (_error) {
    return urlValue;
  }
}

function urlsMatchForAllow(recordUrl, navigationUrl) {
  return recordUrl === navigationUrl || withoutHash(recordUrl) === withoutHash(navigationUrl);
}

async function cleanupExpiredAllowRules() {
  const now = Date.now();
  const records = await getAllowRecords();
  const expiredIds = records
    .filter((record) => record.expiresAt <= now)
    .map((record) => record.id);
  await removeAllowRules(expiredIds);
}

async function rememberTabGrace(tabId, targetUrl) {
  const grace = await getSessionValue(TAB_GRACE_KEY, {});
  grace[String(tabId)] = {
    url: targetUrl,
    expiresAt: Date.now() + GRACE_TTL_MS
  };
  await setSessionValue(TAB_GRACE_KEY, grace);
}

async function hasTabGrace(tabId, targetUrl) {
  const grace = await getSessionValue(TAB_GRACE_KEY, {});
  const record = grace[String(tabId)];
  if (!record) {
    return false;
  }

  if (record.expiresAt <= Date.now()) {
    delete grace[String(tabId)];
    await setSessionValue(TAB_GRACE_KEY, grace);
    return false;
  }

  return record.url === targetUrl;
}

function buildAllowRule(id, targetUrl, tabId) {
  return {
    id,
    priority: 100,
    action: {
      type: "allow"
    },
    condition: {
      regexFilter: exactUrlRegex(targetUrl),
      resourceTypes: ["main_frame"],
      tabIds: [tabId]
    }
  };
}

async function addAllowRule(targetUrl, tabId) {
  await cleanupExpiredAllowRules();

  const allowUrls = [...new Set([targetUrl, withoutHash(targetUrl)])];
  const rules = [];
  for (const allowUrl of allowUrls) {
    rules.push(buildAllowRule(await nextAllowRuleId(), allowUrl, tabId));
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: rules
    });
  } catch (error) {
    const fallbackRules = JSON.parse(JSON.stringify(rules));
    for (const fallbackRule of fallbackRules) {
      delete fallbackRule.condition.tabIds;
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: fallbackRules
    });
  }

  const records = await getAllowRecords();
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    records.push({
      id: rule.id,
      tabId,
      url: allowUrls[index],
      targetUrl,
      expiresAt: Date.now() + ALLOW_TTL_MS
    });
  }
  await setAllowRecords(records);
  await rememberTabGrace(tabId, targetUrl);
  return rules.map((rule) => rule.id);
}

function delayUrlFor(targetUrl) {
  return chrome.runtime.getURL("/delay.html") + "#target=" + targetUrl;
}

async function continueToTarget(targetUrl, tabId) {
  const config = await readConfig();
  const site = findMatchingSite(config, targetUrl);
  if (!site) {
    await chrome.tabs.update(tabId, { url: targetUrl });
    return { ok: true };
  }

  await addAllowRule(targetUrl, tabId);
  await chrome.tabs.update(tabId, { url: targetUrl });
  return { ok: true };
}

async function delayNavigate(targetUrl, tabId) {
  const config = await readConfig();
  const site = findMatchingSite(config, targetUrl);
  if (!site) {
    return { ok: false, reason: "not_blacklisted" };
  }

  await chrome.tabs.update(tabId, { url: delayUrlFor(targetUrl) });
  return { ok: true };
}

async function handleCommitted(details) {
  if (details.frameId !== 0) {
    return;
  }

  const records = await getAllowRecords();
  const matchedIds = records
    .filter((record) => record.tabId === details.tabId && urlsMatchForAllow(record.targetUrl || record.url, details.url))
    .map((record) => record.id);
  await removeAllowRules(matchedIds);
}

async function handleHistoryChange(details) {
  if (details.frameId !== 0 || details.url.startsWith(chrome.runtime.getURL("/"))) {
    return;
  }

  if (await hasTabGrace(details.tabId, details.url)) {
    return;
  }

  const config = await readConfig();
  if (findMatchingSite(config, details.url)) {
    await chrome.tabs.update(details.tabId, { url: delayUrlFor(details.url) });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleRedirectRuleSync();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRedirectRuleSync();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[CONFIG_KEY]) {
    scheduleRedirectRuleSync();
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  handleCommitted(details).catch(console.error);
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  handleHistoryChange(details).catch(console.error);
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  handleHistoryChange(details).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  const tabId = message.tabId || (sender.tab && sender.tab.id);
  if (!tabId && tabId !== 0) {
    sendResponse({ ok: false, reason: "missing_tab" });
    return false;
  }

  if (message.type === "continueToTarget") {
    continueToTarget(message.targetUrl, tabId).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, reason: error.message });
    });
    return true;
  }

  if (message.type === "delayNavigate") {
    delayNavigate(message.targetUrl, tabId).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, reason: error.message });
    });
    return true;
  }

  return false;
});

scheduleRedirectRuleSync();
