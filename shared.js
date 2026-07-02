(function (global) {
  const DEFAULT_CONFIG = {
    enabled: true,
    delaySeconds: 15,
    sites: [
      {
        domain: "youtube.com",
        enabled: true,
        note: "You chose to slow this down. Decide what you came here to do before continuing."
      },
      {
        domain: "reddit.com",
        enabled: true,
        note: "Reddit can expand to fill any gap. Continue only if this is intentional."
      }
    ]
  };

  function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  function normalizeDomain(value) {
    const input = String(value || "").trim().toLowerCase();
    if (!input) {
      return "";
    }

    let hostname = input;
    try {
      hostname = new URL(input.includes("://") ? input : `https://${input}`).hostname;
    } catch (_error) {
      hostname = input.split("/")[0].split("?")[0].split("#")[0];
    }

    hostname = hostname.replace(/\.$/, "");
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }

    return hostname;
  }

  function isValidDomain(domain) {
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain);
  }

  function normalizeDelaySeconds(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_CONFIG.delaySeconds;
    }
    return Math.min(300, Math.max(1, parsed));
  }

  function sanitizeSite(site) {
    const domain = normalizeDomain(site && site.domain);
    return {
      domain,
      enabled: site && site.enabled !== false,
      note: String((site && site.note) || "").trim()
    };
  }

  function sanitizeConfig(value) {
    const defaults = cloneDefaultConfig();
    const source = value && typeof value === "object" ? value : {};
    const seen = new Set();
    const sites = [];

    const hasExplicitSites = Array.isArray(source.sites);
    const rawSites = hasExplicitSites ? source.sites : defaults.sites;
    for (const rawSite of rawSites) {
      const site = sanitizeSite(rawSite);
      if (!site.domain || !isValidDomain(site.domain) || seen.has(site.domain)) {
        continue;
      }
      seen.add(site.domain);
      sites.push(site);
    }

    return {
      enabled: source.enabled !== false,
      delaySeconds: normalizeDelaySeconds(source.delaySeconds),
      sites: hasExplicitSites ? sites : defaults.sites
    };
  }

  function getActiveSites(config) {
    if (!config || config.enabled === false) {
      return [];
    }
    return config.sites.filter((site) => site.enabled && isValidDomain(site.domain));
  }

  function hostnameMatchesDomain(hostname, domain) {
    const cleanHost = normalizeDomain(hostname);
    const cleanDomain = normalizeDomain(domain);
    return cleanHost === cleanDomain || cleanHost.endsWith(`.${cleanDomain}`);
  }

  function findMatchingSite(config, urlValue) {
    let url;
    try {
      url = new URL(urlValue);
    } catch (_error) {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return getActiveSites(config).find((site) => hostnameMatchesDomain(url.hostname, site.domain)) || null;
  }

  function escapeRegex(value) {
    return String(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
  }

  function exactUrlRegex(urlValue) {
    return `^${escapeRegex(urlValue)}$`;
  }

  function domainRegex(domain) {
    const escaped = escapeRegex(normalizeDomain(domain));
    return `^https?://([^/?#]+\\.)?${escaped}(?::[0-9]+)?([/?#].*)?$`;
  }

  global.SlowdownAddition = {
    DEFAULT_CONFIG,
    cloneDefaultConfig,
    normalizeDomain,
    isValidDomain,
    sanitizeConfig,
    getActiveSites,
    hostnameMatchesDomain,
    findMatchingSite,
    exactUrlRegex,
    domainRegex
  };
})(globalThis);
