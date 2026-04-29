/* coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT
 * From https://github.com/gzuidhof/coi-serviceworker
 *
 * Adds Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy headers
 * to all responses, enabling SharedArrayBuffer support on static hosts
 * (e.g. GitHub Pages) that do not allow custom response headers.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function handleFetch(request) {
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }

  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    return;
  }

  if (response.status === 0) {
    return response;
  }

  const newHeaders = new Headers(response.headers);
  newHeaders.set("Cross-Origin-Embedder-Policy", "credentialless");
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event.request));
});
