import { canonical, excluded } from './config.mjs';

export function resourceAllowed(url, type, c) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  if (type === 'document') return !!canonical(url, url, c);
  return (u.origin === c.origin || c.allowedResourceOrigins.includes(u.origin)) && !excluded(url, c);
}

// Each redirect is fetched separately. The browser never receives an unchecked redirect.
export async function safeGet(request, url, c, type = 'document') {
  const seen = new Set(); let current = url;
  for (let hop = 0; hop < 10; hop++) {
    if (!resourceAllowed(current, type, c)) return { blocked: true, url: current, reason: 'scope-or-exclusion' };
    if (seen.has(current)) return { error: 'redirect-loop', url: current };
    seen.add(current);
    const response = await request.get(current, { timeout: c.timeoutMs, maxRedirects: 0, failOnStatusCode: false });
    const status = response.status(), headers = response.headers();
    if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
      current = new URL(headers.location, current).href; await response.dispose(); continue;
    }
    return { response, status, url: current, headers };
  }
  return { error: 'redirect-limit', url: current };
}

export async function guardContext(context, c, state, record) {
  const mark = (request, reason, mocked = false) => { state.prevented.add(request); record({ url: request.url(), method: request.method(), resourceType: request.resourceType(), reason, mocked, phase: state.phase }); };
  await context.routeWebSocket('**/*', ws => { record({ url: ws.url(), method: 'WS', reason: 'websocket-disabled', phase: state.phase }); ws.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url(), method = request.method();
    const mock = state.phase === 'scenario' && state.mocks.find(m => m.method.toUpperCase() === method && new URL(m.url, c.baseURL).href === url);
    if (mock) {
      mock.hits = (mock.hits || 0) + 1; mark(request, 'explicit-mock', true);
      return route.fulfill({ status: mock.status, contentType: mock.contentType || 'application/json', body: typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body ?? {}) });
    }
    const unplannedDocument = request.resourceType() === 'document' && state.documentURL && canonical(url, url, c) !== canonical(state.documentURL, state.documentURL, c);
    if (state.phase !== 'scan' || !['GET', 'HEAD'].includes(method) || !resourceAllowed(url, request.resourceType(), c) || unplannedDocument) {
      mark(request, state.phase !== 'scan' ? 'scenario-network-lock' : !['GET', 'HEAD'].includes(method) ? 'mutation-method-blocked' : unplannedDocument ? 'unplanned-document' : 'scope-or-exclusion');
      return route.abort('blockedbyclient');
    }
    try {
      // Playwright routing may only intercept the first request in a redirect chain.
      // Never hand a redirect back to the browser. Main-page redirects are resolved
      // separately by safeGet before navigation; redirected subresources are blocked.
      const response = await route.fetch({ timeout: c.timeoutMs, maxRedirects: 0 });
      const location = response.headers().location;
      if ([301, 302, 303, 307, 308].includes(response.status()) && location) {
        mark(request, resourceAllowed(new URL(location, url).href, request.resourceType(), c) ? 'browser-redirect-blocked' : 'redirect-out-of-scope'); await response.dispose(); return route.abort('blockedbyclient');
      }
      await route.fulfill({ response }); await response.dispose();
    } catch (e) {
      if (!state.closed) record({ url, method, reason: 'network-error', error: String(e.message).split('\n')[0].slice(0, 500), phase: state.phase });
      await route.abort('failed').catch(() => {});
    }
  });
}
