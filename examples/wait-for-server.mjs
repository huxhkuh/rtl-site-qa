const url = process.argv[2];
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('A local preview URL is required');
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: 'error' }); if (response.ok) { ready = true; break; } } catch { /* bounded retry */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) { console.error('Preview did not become ready in time'); process.exitCode = 2; }
