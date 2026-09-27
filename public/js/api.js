const cache = new Map();
let activeCatalogController = null;

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch (_) { const error = new Error(`Server mengembalikan respons tidak valid (HTTP ${response.status})`); error.status = response.status; throw error; }
  if (!response.ok || json.error) { const error = new Error(json.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return json;
}

function retryableStatus(status) { return [408, 425, 429, 500, 502, 503, 504].includes(Number(status)); }
async function requestWithRetry(path, options = {}, retries = 1, onRetry) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await request(path, options); } catch (error) {
      if (options.signal?.aborted || attempt >= retries || !retryableStatus(error.status)) throw error;
      const delay = 350 * (attempt + 1);
      onRetry?.(attempt + 1, delay, error);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("iln:catalog-retry", { detail: { attempt: attempt + 1, delay, status: error.status || 0 } }));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    }
  }
}

function cachedRequest(key, path, options = {}) {
  if (!cache.has(key)) {
    const pending = request(path, options).catch((error) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export const api = {
  health: () => request("/api/health"),
  daily: () => request("/api/daily"),
  genres: () => request("/api/genres"),
  cancelCatalog() { activeCatalogController?.abort(); activeCatalogController = null; },
  catalog(query, genre, onRetry) {
    const normalizedQuery = String(query || "").trim();
    const normalizedGenre = String(genre || "").trim();
    const key = `${normalizedQuery.toLocaleLowerCase()}|${normalizedGenre.toLocaleLowerCase()}`;
    if (cache.has(key)) return cache.get(key);
    activeCatalogController?.abort();
    const controller = new AbortController();
    activeCatalogController = controller;
    const params = new URLSearchParams({ search: normalizedQuery, genre: normalizedGenre });
    const pending = requestWithRetry(`/api/catalog?${params}`, { signal: controller.signal }, 1, onRetry).catch((error) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    }).finally(() => {
      if (activeCatalogController === controller) activeCatalogController = null;
    });
    cache.set(key, pending);
    return pending;
  },
  detail: (slug) => request(`/api/anime/${encodeURIComponent(slug)}`),
  mirrors: (slug) => request(`/api/streams/${encodeURIComponent(slug)}`),
};
