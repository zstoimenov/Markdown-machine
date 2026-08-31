/**
 * The service worker exists for two reasons, in this order.
 *
 * One: an app whose whole claim is that your notes never leave your disk should
 * not need a network to open them. After one visit it runs with the aeroplane
 * mode on.
 *
 * Two: a browser will not offer to install a page that cannot do that.
 *
 * It caches nothing it is not asked for. The two strategies are picked by what
 * the thing being fetched actually is: a build asset carries a content hash in
 * its name and can never go stale, so it is served from the cache without asking;
 * everything else — the page itself above all — goes to the network first, so a
 * deploy is picked up on the next load rather than on the load after that.
 */
const CACHE = 'markdown-machine-v1';

/** Hashed build output: `assets/index-BciIhK-r.js` and friends. */
const IMMUTABLE = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z]+$/;

/**
 * The one thing that has to be cached before it is asked for: on the first visit
 * the worker is still installing while the page loads, so nothing goes through
 * it, and without this the app would only work offline from the second visit on.
 *
 * There is still no list kept by hand. The build says what it emitted, and the
 * page says where it is; between them that is the shell and every chunk, the
 * lazily-loaded editor included — which matters, because it is the half of the
 * app you would be offline to use.
 */
async function precache() {
  const shell = new URL('./', self.registration.scope).href;
  const cache = await caches.open(CACHE);

  const page = await fetch(shell, { cache: 'reload' });
  if (!page.ok) return;
  await cache.put(shell, page.clone());

  const files = new Set();
  for (const [, asset] of Object.entries(await buildFiles(shell))) {
    if (asset.file) files.add(new URL(asset.file, shell).href);
    for (const css of asset.css ?? []) files.add(new URL(css, shell).href);
    // What the CSS itself pulls in — the self-hosted faces. Without this they
    // are cached at runtime and then swept by forgetOldBuilds below, which only
    // spares hashed assets it has been told about.
    for (const file of asset.assets ?? []) files.add(new URL(file, shell).href);
  }
  // A build with no manifest still leaves its shell naming what the page needs.
  if (files.size === 0) {
    for (const [, path] of (await page.text()).matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
      files.add(new URL(path, shell).href);
    }
  }

  await Promise.all([...files].map((file) => cache.add(file).catch(() => undefined)));
  await forgetOldBuilds(cache, files, shell);
}

/**
 * Drop the assets of builds that are no longer deployed.
 *
 * Content hashes are what make `cacheFirst` safe, and they are also why this is
 * needed: every deploy emits new filenames, so without pruning the cache grew by
 * about a megabyte per deploy and nothing ever took any of it back. The cache
 * name is a constant, so the usual trick — a new cache name per version, old
 * ones swept on activate — never fired.
 *
 * On the folder path that was untidy. On the device path it was worse: the notes
 * live in the same origin's storage under the same quota, and pressure on it is
 * exactly what the app warns people about. It should not be competing with
 * itself for the room it asks them to trust.
 *
 * Only hashed assets are considered. Anything else — the shell, the manifest,
 * the icons — keeps its name across builds and is refreshed rather than
 * replaced.
 */
async function forgetOldBuilds(cache, current, shell) {
  const assets = new URL('assets/', shell).href;
  await Promise.all(
    (await cache.keys()).map(async (request) => {
      if (!request.url.startsWith(assets)) return;
      if (!IMMUTABLE.test(new URL(request.url).pathname)) return;
      if (current.has(request.url)) return;
      await cache.delete(request);
    }),
  );
}

async function buildFiles(shell) {
  try {
    const response = await fetch(new URL('assets/build-manifest.json', shell));
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener('install', (event) => {
  // A failed precache is not a failed install: the runtime caching below still
  // fills in, one visit later than it should.
  event.waitUntil(precache().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});


/**
 * `ignoreVary` because a precached file was fetched by the worker and the page
 * then asks for the same file with `crossorigin`, which sends an Origin header a
 * `Vary: Origin` response would otherwise refuse to match. Nothing here is
 * content-negotiated, so the URL is the whole key.
 */
const MATCH = { ignoreVary: true };

async function cacheFirst(request) {
  const cached = await caches.match(request, MATCH);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, MATCH);
    if (cached) return cached;
    // A navigation that misses still has somewhere to go: the shell is enough,
    // since every file this app shows comes off the disk rather than the network.
    if (request.mode === 'navigate') {
      const shell = await caches.match(new URL('./', self.registration.scope).href, MATCH);
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(IMMUTABLE.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});
