// Tests de connexion "live" — vraies requêtes réseau (TCP + HTTP), utilisés par :
//  - Paramètres → « Tester la connexion (live) »
//  - la vérification automatique post-déploiement (POST /publish)
//  - le runner CLI test/live-test.js
import net from 'node:net';

const T = 4000; // timeout ms par vérification

export function tcpPing(host, ports = [80, 443, 8080]) {
  const started = Date.now();
  const tryPort = (port) => new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: T });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', (err) => {
      // ECONNREFUSED = l'hôte répond (port fermé) → joignable
      resolve(err && err.code === 'ECONNREFUSED' ? true : false);
    });
  });
  return (async () => {
    for (const p of ports) {
      if (await tryPort(p)) return { ok: true, ms: Date.now() - started };
    }
    return { ok: false, ms: Date.now() - started };
  })();
}

async function httpCheck(method, url, body, headers = {}) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), T);
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, ms: Date.now() - started, json };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - started, json: null };
  }
}

// Séquence de test complète d'un player contre un CMS (les 4 lignes de la maquette).
// baseUrl : URL de l'API (ex. http://localhost:8080/api/v1)
export async function runConnectionTest({ baseUrl, ip, playerId, token }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const rows = [];

  if (ip) {
    const r = await tcpPing(ip);
    rows.push({ label: `ping ${ip}`, ok: r.ok, ms: r.ms, detail: r.ok ? 'hôte joignable (TCP)' : 'injoignable' });
  }

  if (!base) {
    rows.push({ label: 'URL du CMS', ok: false, ms: 0, detail: 'URL manquante' });
    return rows;
  }
  const id = playerId || '{id}';
  const q = token ? `?token=${encodeURIComponent(token)}` : '';

  const a = await httpCheck('GET', `${base}/players/${id}/assignment${q}`);
  rows.push({ label: `GET ${base}/players/${id}/assignment`, ok: a.ok, ms: a.ms, status: a.status });

  const d = await httpCheck('GET', `${base}/datasets/latest${q}`);
  rows.push({ label: `GET ${base}/datasets/latest (prix)`, ok: d.ok, ms: d.ms, status: d.status });

  const h = await httpCheck('POST', `${base}/players/${id}/heartbeat`, { token, probe: true, state: 'probe' });
  rows.push({ label: `POST ${base}/players/${id}/heartbeat`, ok: h.ok, ms: h.ms, status: h.status });

  return rows;
}

// Vérification automatique post-déploiement : contrôle en conditions réelles (HTTP)
// que la publication est bien servie par le CMS.
export async function runDeployTests({ baseUrl, mode, version, players, mediaCheck }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const rows = [];

  if (mediaCheck) {
    const started = Date.now();
    const missing = await mediaCheck();
    rows.push({
      label: mode === 'data' ? `snapshot prix d${version} · intégrité JSON` : `snapshot v${version} · intégrité JSON + médias`,
      ok: missing.length === 0,
      ms: Date.now() - started,
      detail: missing.length ? `manquant : ${missing.join(', ')}` : 'OK',
    });
  }

  const sample = players.slice(0, 10);
  for (const p of sample) {
    if (mode === 'data') {
      const d = await httpCheck('GET', `${base}/datasets/latest?token=${encodeURIComponent(p.token)}`);
      const okVer = d.ok && d.json && d.json.dataVer === version;
      rows.push({ label: `GET /datasets/latest → ${p.id}`, ok: okVer, ms: d.ms, status: d.status, detail: okVer ? `d${version} servi` : 'version inattendue' });
    } else {
      const a = await httpCheck('GET', `${base}/players/${p.id}/assignment?token=${encodeURIComponent(p.token)}`);
      const okVer = a.ok && a.json && a.json.assignedVer === version;
      rows.push({ label: `GET /players/${p.id}/assignment`, ok: okVer, ms: a.ms, status: a.status, detail: okVer ? `v${version} assignée` : 'version inattendue' });
    }
  }

  if (players.length) {
    const p = players[0];
    const h = await httpCheck('POST', `${base}/players/${p.id}/heartbeat`, { token: p.token, probe: true, state: 'probe' });
    rows.push({ label: `POST /players/${p.id}/heartbeat (dry-run)`, ok: h.ok, ms: h.ms, status: h.status });
  }
  return rows;
}
