#!/usr/bin/env node
// Tests live du CMS signage — à lancer contre un serveur déployé :
//   node test/live-test.js                          → lecture seule sur http://localhost:8080
//   node test/live-test.js https://cms.mondomaine   → lecture seule sur une instance déployée
//   node test/live-test.js --mutate                 → cycle complet (draft + publish + heartbeat)
//   node test/live-test.js --local --mutate         → démarre un serveur jetable (BDD temporaire) puis teste
// Code retour ≠ 0 si un test échoue → utilisable en CI/CD après déploiement.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotAssets } from '../public/js/assets.js';
import { scheduledNow, tfbPromoLabel, tfbDiscountedPrice } from '../public/js/renderer.js';
import { startTfbMock, MOCK_ACCOUNTS } from './tfbuddy-mock.js';
import { startAnthropicMock, MOCK_KEY } from './anthropic-mock.js';
import { startS3Mock, MOCK_S3 } from './s3-mock.js';

const args = process.argv.slice(2);
const MUTATE = args.includes('--mutate');
const LOCAL = args.includes('--local');
const argVal = (name, fb) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : fb;
};
const USER = argVal('user', process.env.SIG_TEST_USER || 'admin');
const PASSWORD = argVal('password', process.env.SIG_ADMIN_PASSWORD || 'signage');
const baseArg = args.find((a) => !a.startsWith('--'));
let BASE = (baseArg || process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

const results = [];
let child = null;
let authToken = null;
let tfbMock = null;   // TFBuddy simulé (serveur jetable seulement)
let aiMock = null;    // API Claude simulée (idem)
let mkMock = null;    // module Marketing simulé : sa route de session (idem)

function report(label, ok, ms, detail = '') {
  results.push({ label, ok });
  const pad = String(ms).padStart(4, ' ');
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label} — ${pad} ms${detail ? ` · ${detail}` : ''}`);
}

async function step(label, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    report(label, true, Date.now() - t0, typeof detail === 'string' ? detail : '');
    return true;
  } catch (e) {
    report(label, false, Date.now() - t0, String(e.message || e));
    return false;
  }
}

async function call(method, path, body) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status} sur ${path}`);
  return json;
}

async function waitUp(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await call('GET', '/api/v1/health'); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error(`serveur injoignable sur ${BASE}`);
}

async function main() {
  if (LOCAL) {
    const dir = mkdtempSync(join(tmpdir(), 'sig-test-'));
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const port = 8123 + Math.floor(Math.random() * 500);
    BASE = `http://127.0.0.1:${port}`;
    tfbMock = await startTfbMock();
    aiMock = await startAnthropicMock();
    mkMock = await startMarketingMock();
    // Le serveur jetable démarre avec le seed de démonstration (SIG_DEMO=1)
    // pour disposer de modules / magasins / players à tester.
    child = spawn(process.execPath, [join(root, 'server', 'index.js')], {
      // TFBuddy simulé : le serveur jetable y lit ses bundles comme en production.
      env: { ...process.env, PORT: String(port), SIG_DB: join(dir, 'test.db'), SIG_DEMO: '1',
        TFBUDDY_API_BASE: tfbMock.url, TFBUDDY_PHONE: MOCK_ACCOUNTS.admin.phone, TFBUDDY_PASSWORD: MOCK_ACCOUNTS.admin.password, TFBUDDY_ROLE: '',
        // API Claude simulée : les traductions sont proposées comme en production.
        ANTHROPIC_API_KEY: MOCK_KEY, ANTHROPIC_BASE_URL: aiMock.url, ANTHROPIC_AUTH_TOKEN: '', SIG_TRANSLATE_MODEL: '',
        // Module Marketing simulé : la régie ouverte dans son cadre reprend sa session.
        SIG_MARKETING_SSO_URL: mkMock.url, SIG_MARKETING_SSO: '',
        // Catalogue : pas d'import automatique au milieu des tests (le test le lance).
        SIG_CATALOG_AUTO: '0' },
      stdio: 'ignore',
    });
    console.log(`▶ Serveur jetable : ${BASE} (BDD ${join(dir, 'test.db')})`);
  }

  console.log(`\nTests live du CMS signage — ${BASE} ${MUTATE ? '(cycle complet)' : '(lecture seule)'}\n`);
  await waitUp();

  // --- lecture seule -------------------------------------------------------
  let state = null;
  await step('GET /api/v1/health', async () => {
    const h = await call('GET', '/api/v1/health');
    if (!h.ok) throw new Error('health.ok = false');
    if (h.tablePrefix !== 'sig_') throw new Error('préfixe de tables inattendu');
    return `v${h.version} · d${h.dataVer} · tables ${h.tablePrefix}*`;
  });
  await step('API protégée sans session → 401 attendu', async () => {
    const res = await fetch(BASE + '/api/v1/state');
    if (res.status !== 401) throw new Error(`HTTP ${res.status} au lieu de 401 — back office non protégé !`);
  });
  const loginOk = await step(`POST /api/v1/login (${USER})`, async () => {
    const out = await call('POST', '/api/v1/login', { username: USER, password: PASSWORD });
    if (!out.token) throw new Error('pas de jeton de session');
    authToken = out.token;
  });
  if (!loginOk) {
    console.log('\n\x1b[31mConnexion impossible — passe --user=… --password=… (ou SIG_ADMIN_PASSWORD).\x1b[0m\n');
    if (child) child.kill();
    process.exit(1);
  }
  if (LOCAL) {
    // Ouverte dans le cadre du module Marketing, la régie reprend sa session :
    // pas de second mot de passe (server/marketing-sso.js).
    const sso = (cookie) => fetch(BASE + '/api/v1/sso/marketing', { method: 'POST', headers: cookie ? { cookie } : {} });
    await step('Ouverture depuis le Marketing — admin sans mot de passe', async () => {
      mkMock.reply = { status: 200, body: { authenticated: true, user_id: 7, role: 'BRAND_ADMIN', brand_id: null, shop_ids: null, dev_auth: true } };
      const res = await sso('PHPSESSID=erp-abc; sig_session=ancien-jeton');
      if (res.status !== 200) throw new Error(`HTTP ${res.status} : ${(await res.json().catch(() => ({}))).error || ''}`);
      const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
      if (!/^sig_session=\w+/.test(cookie)) throw new Error('pas de cookie de session');
      const st = await fetch(BASE + '/api/v1/state', { headers: { cookie } });
      if (st.status !== 200) throw new Error(`état refusé avec la session ouverte (HTTP ${st.status})`);
      const sent = mkMock.lastCookie || '';
      if (!sent.includes('PHPSESSID=erp-abc')) throw new Error('les cookies du navigateur ne sont pas transmis au module');
      if (sent.includes('sig_session')) throw new Error('la session de la régie part vers le module');
      return 'session du module → session admin · cookies du navigateur transmis, sauf celui de la régie';
    });
    await step('Ouverture depuis le Marketing — refusée sans session du module, à un franchisé, module muet', async () => {
      const cases = [
        [{ status: 200, body: { authenticated: false } }, 401, 'sans session'],
        [{ status: 200, body: { authenticated: true, role: 'FRANCHISEE', shop_ids: [4] } }, 403, 'franchisé'],
        [{ status: 401, body: { error: 'Unauthorized' } }, 401, 'module 401'],
        [{ status: 500, body: null }, 401, 'module en erreur'],
      ];
      for (const [reply, want, label] of cases) {
        mkMock.reply = reply;
        const res = await sso('');
        if (res.status !== want) throw new Error(`${label} : HTTP ${res.status} au lieu de ${want}`);
        if (res.headers.get('set-cookie')) throw new Error(`${label} : une session a été ouverte`);
      }
      return cases.map(([, want, label]) => `${label} ${want}`).join(' · ');
    });
  }
  await step('GET /api/v1/state — brouillon complet', async () => {
    state = await call('GET', '/api/v1/state');
    if (!Array.isArray(state.modules)) throw new Error('modules absents');
    if (!Array.isArray(state.playlist)) throw new Error('playlist absente');
    // Un serveur de production vierge (démo retirée) n'a pas encore de module.
    return state.modules.length ? `${state.modules.length} modules · playlist ×${state.playlist.length}` : 'serveur vierge (aucun module)';
  });
  await step('GET /api/v1/fleet — réseau & magasins', async () => {
    const f = await call('GET', '/api/v1/fleet');
    if (!Array.isArray(f.stores)) throw new Error('stores absent');
    const n = f.stores.reduce((s, x) => s + x.players.length, 0);
    return `${f.stores.length} magasins · ${n} écrans`;
  });
  await step('GET /api/v1/element-types — types depuis la table', async () => {
    const t = await call('GET', '/api/v1/element-types');
    if (!Array.isArray(t.types) || t.types.length < 5) throw new Error('types manquants (sig_element_types)');
    for (const x of t.types) if (!Array.isArray(x.layouts) || !x.layouts.length) throw new Error(`type ${x.id} sans mises en page`);
    if (!t.types.some((x) => x.id === 'promotion')) throw new Error('type « promotion » manquant');
    if (!t.types.some((x) => x.id === 'campagne')) throw new Error('type « campagne » manquant');
    if (!t.types.some((x) => x.id === 'html')) throw new Error('type « html » (gabarit) manquant');
    return t.types.map((x) => x.id).join(' · ');
  });
  await step('GET /api/v1/promo-types — sous-types de promotion (dynamiques)', async () => {
    const p = await call('GET', '/api/v1/promo-types');
    if (!Array.isArray(p.promoTypes) || p.promoTypes.length < 3) throw new Error('sous-types de promotion manquants (sig_promo_types)');
    for (const x of p.promoTypes) if (!x.id || !x.name || !x.icon) throw new Error(`sous-type ${x.id} incomplet`);
    return p.promoTypes.map((x) => `${x.icon} ${x.name}`).join(' · ');
  });
  await step('GET /api/v1/bundles — bundles TFBuddy (état de la synchro)', async () => {
    const r = await call('GET', '/api/v1/bundles');
    if (!Array.isArray(r.bundles) || !Array.isArray(r.promos) || !r.sync || !r.tfbuddy) throw new Error('réponse incomplète');
    if (JSON.stringify(r.tfbuddy).toLowerCase().includes('password')) throw new Error('la réponse parle de mot de passe');
    if (!r.tfbuddy.configured) return 'compte TFBuddy non configuré (secrets TFBUDDY_PHONE / TFBUDDY_PASSWORD)';
    if (r.sync.ok === false) return `synchro en erreur : ${r.sync.error}`;
    if (!r.sync.at) return 'compte configuré · première synchro en attente';
    return `${r.bundles.length} bundle(s) · ${r.bundles.filter((b) => b.status === 'ACTIVE').length} actif(s) · ${r.promos.length} autre(s) promotion(s) · synchro ${r.sync.at.slice(0, 16).replace('T', ' ')}`;
  });
  await step('Créneaux d’un bundle — jour ISO, heure de fin exclue (rendu des écrans)', async () => {
    const m = { bundle: { slots: [1, 2, 3, 4, 5].map((d) => ({ dow: d, from: '06:00', to: '11:00' })) } };
    const at = (d, h, mi) => new Date(2026, 9, d, h, mi);   // octobre 2026 : le 12 est un lundi
    const cases = [[at(12, 8, 0), true], [at(12, 11, 0), false], [at(12, 5, 59), false], [at(16, 10, 59), true], [at(11, 8, 0), false]];
    for (const [d, want] of cases) if (scheduledNow(m, d) !== want) throw new Error(`${d.toString().slice(0, 21)} → ${!want} au lieu de ${want}`);
    if (!scheduledNow({ bundle: { slots: [{ dow: 7, from: '00:00', to: '23:59' }] } }, at(11, 23, 59))) throw new Error('« 23:59 » doit courir jusqu’à minuit');
    if (!scheduledNow({ bundle: { slots: [] } }, at(11, 3, 0))) throw new Error('un bundle sans créneau passe tout le temps');
    return 'lun 08:00 ✓ · lun 11:00 ✗ · 05:59 ✗ · ven 10:59 ✓ · dim ✗ · « 23:59 » = minuit';
  });
  await step('GET /api/v1/translations — traductions des écrans (néerlandais)', async () => {
    const r = await call('GET', '/api/v1/translations?lang=nl');
    if (!Array.isArray(r.items) || !r.counts || !r.claude) throw new Error('réponse incomplète');
    if (/sk-ant-/.test(JSON.stringify(r))) throw new Error('la réponse expose une clé API');
    const fr = await fetch(BASE + '/api/v1/translations?lang=fr', { headers: { authorization: `Bearer ${authToken}` } });
    if (fr.status !== 400) throw new Error(`français (langue source) : HTTP ${fr.status} au lieu de 400`);
    const c = r.counts;
    return `${c.total} texte(s) · ${c.validated} validé(s) · ${c.proposed} à valider · ${c.missing} à traduire · ${c.erp} nom(s) ERP · `
      + `${r.stores.length} magasin(s) en nl · Claude ${r.claude.configured ? `prêt (${r.claude.model})` : 'non configuré (secret ANTHROPIC_API_KEY)'}`;
  });
  await step('GET /api/v1/campaigns — campagnes marketing (liste)', async () => {
    const c = await call('GET', '/api/v1/campaigns');
    if (!Array.isArray(c.campaigns)) throw new Error('campagnes illisibles (sig_campaigns)');
    for (const x of c.campaigns) if (!x.id || !x.name || !x.scope) throw new Error(`campagne ${x.id} incomplète`);
    return c.campaigns.length ? c.campaigns.map((x) => `${x.name} (${x.scope})`).join(' · ') : 'liste vide (prod démarre vide)';
  });
  await step('GET /api/v1/catalog — table produits', async () => {
    const c = await call('GET', '/api/v1/catalog');
    if (!Array.isArray(c.categories) || !Array.isArray(c.products)) throw new Error('catalogue incomplet');
    return `${c.categories.length} catégorie(s) · ${c.products.length} produit(s)`;
  });
  await step('GET /api/v1/langs — langues depuis la table', async () => {
    const l = await call('GET', '/api/v1/langs');
    if (!Array.isArray(l.langs) || !l.langs.some((x) => x.id === 'fr')) throw new Error('langues manquantes (sig_langs)');
    return l.langs.map((x) => x.id).join(' · ');
  });
  await step('GET /api/v1/pwa-config — connexion base PWA', async () => {
    const c = await call('GET', '/api/v1/pwa-config');
    if (typeof c.qProducts !== 'string' || !('hasPassword' in c)) throw new Error('config PWA illisible');
    if (c.password) throw new Error('le mot de passe ne doit jamais être renvoyé');
    const t = await call('POST', '/api/v1/pwa-test');
    if (t.ok !== true && !t.error) throw new Error('pwa-test sans message d\'erreur clair');
    return c.db ? `base « ${c.db} » configurée · test : ${t.ok ? 'OK' : t.error}` : `non configurée · ${t.error}`;
  });
  await step('GET / — back office servi', async () => {
    const res = await fetch(BASE + '/');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    // La régie est le « Marketing en magasin » du module Marketing (titre de la page).
    if (!txt.includes('Marketing en magasin') || !txt.includes('js/app.js')) throw new Error('HTML inattendu');
  });
  await step('GET /magasin — espace magasin servi (FR/NL)', async () => {
    const res = await fetch(BASE + '/magasin');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    if (!txt.includes('js/magasin.js')) throw new Error('HTML inattendu');
    const anon = await fetch(BASE + '/api/v1/my-store');
    if (anon.status !== 401) throw new Error(`espace magasin sans session → HTTP ${anon.status} au lieu de 401`);
  });
  await step('https — certificat de la régie (si le serveur en a un)', async () => {
    let hs = null;
    for (let i = 0; i < 3 && !hs; i++) { hs = (await call('GET', '/api/v1/health')).https; if (!hs) await new Promise((r) => setTimeout(r, 1500)); }
    if (!hs) return 'http seulement sur ce serveur';
    if (!hs.ok || !/^https:\/\//.test(hs.base) || !hs.validTo) throw new Error(`état https incohérent : ${JSON.stringify(hs)}`);
    if (hs.daysLeft != null && hs.daysLeft < 1) throw new Error(`certificat bientôt expiré (${hs.validTo}) — renouvellement en panne`);
    return `${hs.base} · valable jusqu'au ${hs.validTo.slice(0, 16).replace('T', ' ')} (${hs.daysLeft} j)`;
  });
  await step('GET /player.html — player servi', async () => {
    const res = await fetch(BASE + '/player.html');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
  await step('GET /sw.js — service worker des écrans (redémarrage hors ligne)', async () => {
    const res = await fetch(BASE + '/sw.js');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/javascript/.test(res.headers.get('content-type') || '')) throw new Error(`type ${res.headers.get('content-type')}`);
    const src = await res.text();
    const v = (src.match(/version ([0-9a-f]{12})/) || [])[1];
    const shell = JSON.parse((src.match(/const SHELL = (\[[^\n]*\]);/) || [])[1] || '[]');
    for (const f of ['player.html', 'film.html', 'js/player.js', 'js/offline.js', 'js/renderer.js', 'css/base.css', 'assets/logo.png']) {
      if (!shell.includes(f)) throw new Error(`coquille incomplète : ${f} manque`);
    }
    // chaque fichier de la coquille doit exister, sinon l'installation échoue
    for (const f of shell) { const r = await fetch(BASE + '/' + f, { method: 'HEAD' }); if (!r.ok) throw new Error(`${f} → HTTP ${r.status}`); }
    return `version ${v} · ${shell.length} fichiers gardés`;
  });
  await step('Fichiers statiques — revalidation (304) et lecture partielle (206)', async () => {
    const r1 = await fetch(BASE + '/assets/logo.png');
    const etag = r1.headers.get('etag');
    if (!r1.ok || !etag) throw new Error('ETag absent');
    const r2 = await fetch(BASE + '/assets/logo.png', { headers: { 'if-none-match': etag } });
    if (r2.status !== 304) throw new Error(`revalidation → HTTP ${r2.status} (attendu 304)`);
    const r3 = await fetch(BASE + '/assets/logo.png', { headers: { range: 'bytes=0-99' } });
    const body = await r3.arrayBuffer();
    if (r3.status !== 206 || body.byteLength !== 100) throw new Error(`Range → HTTP ${r3.status}, ${body.byteLength} octets`);
    return `ETag ${etag} · 304 · 206 (${r3.headers.get('content-range')})`;
  });
  await step('Snapshot — la liste « media » couvre tous les fichiers du film', async () => {
    const res = await fetch(BASE + '/api/v1/film');
    const f = await res.json();
    if (!Array.isArray(f.media)) throw new Error('liste media absente');
    const need = snapshotAssets(f);
    const lack = need.filter((u) => !f.media.includes(u));
    if (lack.length) throw new Error(`fichiers non listés : ${lack.slice(0, 3).join(', ')}`);
    return `${f.media.length} fichier(s) listé(s)`;
  });
  await step('GET /film — visionneuse publique servie', async () => {
    const res = await fetch(BASE + '/film');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    if (!txt.includes('Film')) throw new Error('HTML inattendu');
  });
  await step('GET /api/v1/film — film public (sans connexion)', async () => {
    const res = await fetch(BASE + '/api/v1/film');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = await res.json();
    if (!Array.isArray(f.modules)) throw new Error('modules absents');
    if (!Array.isArray(f.playlist)) throw new Error('playlist absente');
    return `v${f.version} · d${f.dataVer} · ${f.playlist.length} module(s) au programme`;
  });
  await step('GET /api/v1/report — rapport public (sans connexion)', async () => {
    const res = await fetch(BASE + '/api/v1/report');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    if (!r.meta || !Array.isArray(r.modules) || !Array.isArray(r.playlists)) throw new Error('structure du rapport incomplète');
    if (!Array.isArray(r.stores) || !r.plan || !Array.isArray(r.plan.windows)) throw new Error('planning/écrans absents du rapport');
    return `${r.playlists.length} film(s) · ${r.modules.length} élément(s) · ${r.stores.length} écran(s) · ${r.plan.windows.length} moment(s)`;
  });
  await step('GET /report — page du rapport servie', async () => {
    const res = await fetch(BASE + '/report');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!/report\.js/.test(html)) throw new Error('report.js non référencé');
    return 'page HTML du rapport OK';
  });
  await step('GET /api/v1/surprise — dossier vidéos surprise (lecture)', async () => {
    const r = await call('GET', '/api/v1/surprise');
    if (!Array.isArray(r.videos)) throw new Error('liste absente');
    return `${r.videos.length} vidéo(s) dans le dossier`;
  });
  await step('GET /api/v1/seasons — périodes de l\'année (lecture)', async () => {
    const r = await call('GET', '/api/v1/seasons');
    if (!Array.isArray(r.seasons) || !Array.isArray(r.current)) throw new Error('structure des périodes');
    const withImg = r.seasons.filter((s) => s.image).length;
    return `${r.seasons.length} période(s) · ${r.current.length} active(s)${withImg ? ` · ${withImg} illustration(s)` : ''}`;
  });
  // Diagnostic ws_season (lecture seule) : révèle les colonnes réelles de la
  // table de périodes et signale une éventuelle colonne d'illustration. Contre
  // la prod (MySQL branché) le détail imprimé montre le schéma réel ; en local
  // (pas de MySQL) l'étape passe en signalant « non lisible ». Ne fait jamais
  // échouer le déploiement (l'endpoint renvoie toujours 200 + ok:true/false).
  await step('POST /api/v1/seasons/inspect — diagnostic ws_season (illustration)', async () => {
    const r = await call('POST', '/api/v1/seasons/inspect', {});
    if (typeof r.ok !== 'boolean' || !Array.isArray(r.inspected)) throw new Error('réponse de diagnostic invalide');
    if (!r.ok) return `base non lisible ici : ${r.error || 'non configurée'}`;
    const imgTxt = r.imageFound
      ? `IMAGE=[${r.imageCols.map((c) => `${c.column}@${c.table}${c.sample ? `="${c.sample}"` : ''}`).join(', ')}]`
      : 'aucune colonne image détectée';
    const tables = r.inspected.map((t) => {
      const cols = (t.types || t.columns || []).join(', ');
      const ex = (t.sample && t.sample.length) ? ` ex[${t.sample.join(' | ')}]` : '';
      return `${t.table}{${cols}}${ex}`;
    }).join(' ;; ');
    return `${r.inspected.length} table(s) · ${imgTxt} · ${tables}`.slice(0, 1600);
  });
  await step('GET /api/v1/media — médiathèque agence (lecture)', async () => {
    const r = await call('GET', '/api/v1/media');
    if (!Array.isArray(r.media)) throw new Error('liste média absente');
    return `${r.media.length} média(s) · dossier ${r.dir}`;
  });
  if (LOCAL) {
    // Médiathèque (écran du menu) : un média déposé, ses tags retouchés, puis retiré.
    await step('Médiathèque — tags retouchés (moment, produit, période), média inconnu 404', async () => {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const prod = (state && state.catalog && state.catalog.products && state.catalog.products[0]) || null;
      const up = await call('POST', '/api/v1/media', { name: 'test-tags.png', kind: 'photo', moment: 'matin', dataUrl: png });
      const mine = up.media.find((x) => x.filename === '1_test-tags.png');
      if (!mine) throw new Error('média déposé introuvable');
      const r = await call('PATCH', `/api/v1/media/${encodeURIComponent(mine.id)}`, { moment: 'aprem', productId: prod ? prod.id : '', seasonId: '' });
      const after = r.media.find((x) => x.id === mine.id);
      if (!after || after.moment !== 'aprem') throw new Error(`moment non retouché (${after && after.moment})`);
      if (prod && after.productId !== prod.id) throw new Error('produit non retouché');
      if (after.filename !== mine.filename) throw new Error('le fichier a été renommé');
      const unknown = await fetch(BASE + '/api/v1/media/inconnu', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) }, body: '{}' });
      if (unknown.status !== 404) throw new Error(`média inconnu : HTTP ${unknown.status}`);
      await call('DELETE', `/api/v1/media/${encodeURIComponent(mine.id)}`);
      return `matin → après-midi${prod ? ` · produit « ${prod.name} »` : ''} · fichier inchangé · inconnu 404`;
    });
  }
  await step('GET /api/v1/product-moments — périodes de vente (lecture)', async () => {
    const r = await call('GET', '/api/v1/product-moments');
    if (!Array.isArray(r.moments) || !Array.isArray(r.rows)) throw new Error('structure périodes de vente');
    return `${r.rows.length} règle(s) · ${r.moments.join('/')} · moment courant ${r.current}`;
  });
  await step('GET /api/v1/film?film=… — lien direct par film', async () => {
    const base = await (await fetch(BASE + '/api/v1/film')).json();
    const id = base.playlistId || 'pl1';
    const res = await fetch(BASE + `/api/v1/film?film=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = await res.json();
    if ((f.playlistId || 'pl1') !== id) throw new Error('playlistId inattendu');
    const bad = await fetch(BASE + '/api/v1/film?film=inexistant');
    if (bad.status !== 404) throw new Error(`film inconnu : HTTP ${bad.status} au lieu de 404`);
    return `« ${f.playlistName || 'Film'} » → v${f.version}${f.draft ? ' (brouillon)' : ''}`;
  });
  await step('GET /api/v1/film?store=… — lien direct par magasin', async () => {
    const fleetRes = await call('GET', '/api/v1/fleet');
    const store = fleetRes.stores[0];
    // Serveur de production vierge : aucun magasin tant que l'import PWA
    // n'a pas eu lieu — on vérifie juste le 404 sur un id inconnu.
    if (!store) {
      const bad0 = await fetch(BASE + '/api/v1/film?store=inexistant');
      if (bad0.status !== 404) throw new Error(`magasin inconnu : HTTP ${bad0.status} au lieu de 404`);
      return 'serveur vierge (aucun magasin) · 404 OK';
    }
    const res = await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const f = await res.json();
    if (f.storeId !== store.id) throw new Error('storeId inattendu');
    if (!f.format || !(f.format.w > 0) || !(f.format.h > 0)) throw new Error('combo écrans absent (format)');
    const bad = await fetch(BASE + '/api/v1/film?store=inexistant');
    if (bad.status !== 404) throw new Error(`magasin inconnu : HTTP ${bad.status} au lieu de 404`);
    return `${f.storeName} → v${f.version} · ${f.format.label} = ${f.format.px}`;
  });
  await step('POST /api/v1/test — test de connexion live (auto-ciblé)', async () => {
    const anyToken = await firstToken();
    if (!anyToken) return 'serveur vierge (aucun player)';
    const out = await call('POST', '/api/v1/test', { url: `${BASE}/api/v1`, ip: new URL(BASE).hostname, token: anyToken });
    const ok = out.rows.filter((r) => r.ok).length;
    if (!out.ok) throw new Error(`${ok}/${out.rows.length} vérifications OK`);
    return `${ok}/${out.rows.length} vérifications OK`;
  });

  // --- cycle complet (mutations) ------------------------------------------
  if (MUTATE) {
    const token = 'plyr_LIVETEST';
    const pid = 'livetest';
    await step('POST/DELETE /api/v1/surprise — upload + suppression', async () => {
      const before = await call('GET', '/api/v1/surprise');
      const name = 'test-surprise-livetest.mp4';
      const dataUrl = 'data:video/mp4;base64,' + Buffer.from('livetest').toString('base64');
      const up = await call('POST', '/api/v1/surprise', { name, dataUrl });
      if (!up.ok || !up.videos.some((v) => v.name === name)) throw new Error('upload non listé');
      const del = await call('DELETE', `/api/v1/surprise/${encodeURIComponent(name)}`);
      if (del.videos.some((v) => v.name === name)) throw new Error('suppression échouée');
      return `upload + suppression (${before.videos.length} au départ)`;
    });
    await step('PUT /api/v1/seasons — enregistrement + détection', async () => {
      const before = await call('GET', '/api/v1/seasons');
      const out = await call('PUT', '/api/v1/seasons', { seasons: [
        { id: 'se_all_lt', name: 'Toute l\'année', from: '01/01', to: '31/12', products: [], image: 'https://exemple.test/galette.jpg', active: true },
        { id: 'se_far_lt', name: 'Invalide', from: '15/13', to: '16/13', products: [], active: true },
      ] });
      if (!out.ok || out.seasons.length !== 2) throw new Error('enregistrement des périodes');
      const cur = new Set(out.current || []);
      if (!cur.has('se_all_lt')) throw new Error('« toute l\'année » devrait être active');
      if (cur.has('se_far_lt')) throw new Error('période invalide ne doit pas être active');
      const saved = out.seasons.find((s) => s.id === 'se_all_lt');
      if (!saved || saved.image !== 'https://exemple.test/galette.jpg') throw new Error('illustration de période non persistée');
      await call('PUT', '/api/v1/seasons', { seasons: before.seasons }); // restauration
      return `${out.seasons.length} période(s) · ${out.current.length} active(s) · illustration OK`;
    });
    await step('Médiathèque agence — upload tagué + accès séparé', async () => {
      const dataUrl = 'data:video/mp4;base64,' + Buffer.from('lt').toString('base64');
      const up = await call('POST', '/api/v1/media', { name: 'lt-clip.mp4', kind: 'film', moment: 'aprem', productId: '', seasonId: '', dataUrl });
      const item = (up.media || []).find((x) => x.filename === '3_lt-clip.mp4');
      if (!up.ok || !item || !item.present || item.moment !== 'aprem') throw new Error('upload/tag/préfixe média');
      const ag = await (await fetch(BASE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'agence', password: process.env.SIG_AGENCY_PASSWORD || 'agence' }) })).json().catch(() => ({}));
      let agencyIsolated = 'compte agence absent';
      if (ag && ag.token) {
        const h = { authorization: `Bearer ${ag.token}` };
        const s = await fetch(BASE + '/api/v1/state', { headers: h });
        const md = await fetch(BASE + '/api/v1/media', { headers: h });
        if (s.status !== 403) throw new Error(`agence devrait être bloquée sur /state (reçu ${s.status})`);
        if (!md.ok) throw new Error('agence devrait lire /media');
        agencyIsolated = 'agence cloisonnée (/state 403 · /media OK)';
      }
      await call('DELETE', `/api/v1/media/${encodeURIComponent(item.id)}`);
      return `« 3_lt-clip.mp4 » (après-midi) · ${agencyIsolated}`;
    });
    await step('Signature S3 (AWS v4) — les exemples de la documentation AWS', async () => {
      const { signHeaders, presignUrl } = await import('../server/s3.js');
      const { createHash } = await import('node:crypto');
      const c = { endpoint: 'https://s3.amazonaws.com', bucket: 'examplebucket', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', prefix: '', pathStyle: false };
      const now = new Date('2013-05-24T00:00:00Z');
      const sigOf = (h) => /Signature=([0-9a-f]+)/.exec(h.headers.authorization)[1];
      const cases = [
        ['URL présignée', /X-Amz-Signature=([0-9a-f]+)/.exec(presignUrl(c, { key: 'test.txt', expires: 86400, now }))[1], 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'],
        ['GET + Range', sigOf(signHeaders(c, { method: 'GET', key: 'test.txt', headers: { range: 'bytes=0-9' }, now })), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'],
        ['PUT', sigOf(signHeaders(c, { method: 'PUT', key: 'test$file.text', headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, payloadHash: createHash('sha256').update('Welcome to Amazon S3.').digest('hex'), now })), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd'],
        ['GET ?lifecycle', sigOf(signHeaders(c, { method: 'GET', key: '', query: { lifecycle: '' }, now })), 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543'],
        ['liste', sigOf(signHeaders(c, { method: 'GET', key: '', query: { 'max-keys': '2', prefix: 'J' }, now })), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'],
      ];
      for (const [n, got, want] of cases) if (got !== want) throw new Error(`${n} : signature ${got.slice(0, 12)}… au lieu de ${want.slice(0, 12)}…`);
      const { s3Config } = await import('../server/s3.js');
      const ovh = s3Config({ SIG_S3_ENDPOINT: 'https://s3.gra.io.cloud.ovh.net', SIG_S3_BUCKET: 'b' });
      if (ovh.region !== 'gra' || ovh.prefix !== 'media/') throw new Error(`région ${ovh.region} / préfixe ${ovh.prefix} lus dans l’adresse OVH`);
      return `${cases.length} exemples AWS identiques (URL présignée, GET + Range, PUT, ?lifecycle, liste) · région « gra » lue dans l’adresse OVH`;
    });
    await step('Miroir MySQL — mots de passe et jetons masqués', async () => {
      const { mirrorRow } = await import('../server/mirror.js');
      const pw = mirrorRow('sig_settings', { key: 'pwa_import', value: JSON.stringify({ host: 'h', password: 'secret-pwa' }) });
      if (/secret-pwa/.test(pw.value) || JSON.parse(pw.value).host !== 'h') throw new Error(`mot de passe PWA : ${pw.value}`);
      for (const k of ['hd_pass', 'srv_token']) if (mirrorRow('sig_settings', { key: k, value: 'x1' }).value !== '(masqué)') throw new Error(`${k} recopié en clair`);
      if (mirrorRow('sig_settings', { key: 'loop', value: '1' }).value !== '1') throw new Error('réglage ordinaire altéré');
      if (mirrorRow('sig_media', { key: 'hd_pass', value: 'x' }).value !== 'x') throw new Error('autre table altérée');
      return 'mot de passe PWA, hd_pass, srv_token → « (masqué) » · réglages ordinaires intacts';
    });
    await step('Médiathèque — envoi en flux (19 Mo, sans base64), nom avec espace, lecture par morceaux, ETag', async () => {
      const { existsSync: exists } = await import('node:fs');
      const mediaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'media');
      const H = { authorization: `Bearer ${authToken}` };
      const up = (name, body, type = 'video/mp4') => fetch(`${BASE}/api/v1/media/upload?${new URLSearchParams({ name, kind: type.startsWith('image/') ? 'photo' : 'film', moment: 'midi' })}`, { method: 'POST', headers: { ...H, 'content-type': type }, body });
      const big = Buffer.alloc(19 * 1024 * 1024, 7);
      big.write('LTFLUX', 0);
      const ids = [];
      try {
        let r = await up('LT flux.mp4', big);
        let j = await r.json();
        if (r.status !== 200 || j.filename !== '2_LT flux.mp4' || j.storage !== 'local') throw new Error(`envoi : HTTP ${r.status} ${j.error || j.filename}`);
        const it = j.media.find((m) => m.filename === j.filename);
        ids.push(it.id);
        if (!it.present || it.size !== big.length) throw new Error(`fiche : ${JSON.stringify(it)}`);
        const url = `${BASE}/${it.url}`;
        let g = await fetch(url, { headers: { range: 'bytes=0-5' } });
        if (g.status !== 206 || (await g.text()) !== 'LTFLUX') throw new Error(`lecture par morceaux : HTTP ${g.status}`);
        g = await fetch(url, { method: 'HEAD' });
        const etag = g.headers.get('etag');
        if (Number(g.headers.get('content-length')) !== big.length || g.headers.get('content-type') !== 'video/mp4') throw new Error('taille ou type servis faux (nom avec espace)');
        if ((await fetch(url, { headers: { 'if-none-match': etag } })).status !== 304) throw new Error('revalidation par ETag : 304 attendu');
        // Même nom : un second fichier, sans écraser le premier.
        r = await up('LT flux.mp4', Buffer.from('second'));
        j = await r.json();
        if (j.filename !== '2_LT flux-2.mp4') throw new Error(`doublon : ${j.filename}`);
        ids.push(j.media.find((m) => m.filename === j.filename).id);
        if ((await up('LT.exe', Buffer.from('x'))).status !== 400) throw new Error('extension non média acceptée');
        // Taille annoncée au-delà du plafond : refus avant de lire le corps.
        const http = await import('node:http');
        const u = new URL(`${BASE}/api/v1/media/upload?name=LT%20gros.mp4&kind=film`);
        const code = await new Promise((resolve) => {
          const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { ...H, 'content-type': 'video/mp4', 'content-length': String(5 * 1024 ** 3) } }, (res) => { res.resume(); resolve(res.statusCode); rq.destroy(); });
          rq.on('error', () => resolve(0));
          rq.write(Buffer.alloc(1024));
        });
        if (code !== 413) throw new Error(`5 Go annoncés : HTTP ${code} au lieu de 413`);
        for (const id of ids.splice(0)) await call('DELETE', `/api/v1/media/${encodeURIComponent(id)}`);
        if (exists(join(mediaDir, '2_LT flux.mp4')) || exists(join(mediaDir, '2_LT flux-2.mp4'))) throw new Error('fichiers restés sur le disque après suppression');
        return `19 Mo envoyés tels quels · « 2_LT flux.mp4 » servi (206, 304) · doublon → « -2 » · .exe 400 · 5 Go annoncés 413 · supprimés du disque`;
      } finally {
        for (const id of ids) await call('DELETE', `/api/v1/media/${encodeURIComponent(id)}`).catch(() => {});
      }
    });
    await step('Médiathèque sur OVHcloud (S3 simulé) — envoi, lecture, migration des médias locaux, panne, suppression', async () => {
      const { mkdtempSync: mkd, existsSync: exists, unlinkSync: unlink } = await import('node:fs');
      const root = join(dirname(fileURLToPath(import.meta.url)), '..');
      const mediaDir = join(root, 'public', 'media');
      const dir = mkd(join(tmpdir(), 'sig-s3-'));
      const PW = 'admin-s3-test';
      const s3 = await startS3Mock();
      let port = 9300 + Math.floor(Math.random() * 400);
      const start = async (withS3) => {
        const env = { ...process.env, PORT: String(++port), SIG_DB: join(dir, 's3.db'), SIG_ADMIN_PASSWORD: PW, SIG_CATALOG_AUTO: '0' };
        for (const k of Object.keys(env)) if (/^SIG_S3_|^TFBUDDY_/.test(k)) delete env[k];
        delete env.SIG_DEMO;
        if (withS3) Object.assign(env, { SIG_S3_ENDPOINT: s3.url, SIG_S3_BUCKET: MOCK_S3.bucket, SIG_S3_ACCESS_KEY: MOCK_S3.accessKey, SIG_S3_SECRET_KEY: MOCK_S3.secretKey, SIG_S3_REGION: MOCK_S3.region, SIG_S3_PATH_STYLE: '1' });
        const proc = spawn(process.execPath, [join(root, 'server', 'index.js')], { env, stdio: 'ignore' });
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 80; i++) {
          if (await fetch(base + '/api/v1/health').then((r) => r.ok, () => false)) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        const tok = (await (await fetch(base + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) })).json()).token;
        const H = { authorization: `Bearer ${tok}` };
        const j = async (method, path, body) => (await fetch(base + path, { method, headers: { ...H, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
        const up = (name, body, type) => fetch(`${base}/api/v1/media/upload?${new URLSearchParams({ name, kind: type.startsWith('image/') ? 'photo' : 'film' })}`, { method: 'POST', headers: { ...H, 'content-type': type }, body });
        return { base, H, j, up, stop: () => new Promise((r) => { proc.once('exit', r); proc.kill(); }) };
      };
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
      let srv = null;
      try {
        // 1. Un média envoyé AVANT le stockage OVH : il reste sur le disque.
        srv = await start(false);
        let r = await srv.up('lt-local.png', png, 'image/png');
        let o = await r.json();
        if (o.storage !== 'local' || !exists(join(mediaDir, 'lt-local.png'))) throw new Error(`média local : ${JSON.stringify(o).slice(0, 160)}`);
        await srv.stop();
        // 2. Même base, stockage OVH configuré.
        srv = await start(true);
        let st = await srv.j('GET', '/api/v1/media-storage');
        if (st.mode !== 's3' || !st.check || !st.check.ok || st.counts.localOnDisk !== 1) throw new Error(`état : ${JSON.stringify(st).slice(0, 220)}`);
        if (/ovh-test-secret|OVHTESTACCESS/.test(JSON.stringify(st))) throw new Error('l’état expose les clés S3');
        const vid = Buffer.alloc(2 * 1024 * 1024, 3);
        vid.write('LTOVH', 0);
        r = await srv.up('LT ovh.mp4', vid, 'video/mp4');
        o = await r.json();
        if (r.status !== 200 || o.storage !== 's3' || o.filename !== 'LT ovh.mp4') throw new Error(`envoi OVH : HTTP ${r.status} ${o.error || JSON.stringify(o).slice(0, 120)}`);
        const obj = s3.objects.get('media/LT ovh.mp4');
        if (!obj || obj.body.length !== vid.length || obj.type !== 'video/mp4') throw new Error('objet absent du bucket (ou taille / type faux)');
        if (exists(join(mediaDir, 'LT ovh.mp4'))) throw new Error('le média OVH a aussi été écrit sur le disque');
        const url = `${srv.base}/media/${encodeURIComponent('LT ovh.mp4')}`;
        let g = await fetch(url, { headers: { range: 'bytes=0-4' } });
        if (g.status !== 206 || (await g.text()) !== 'LTOVH' || g.headers.get('content-range') !== `bytes 0-4/${vid.length}`) throw new Error(`lecture par morceaux depuis OVH : HTTP ${g.status}`);
        g = await fetch(url);
        const etag = g.headers.get('etag');
        if (g.status !== 200 || Buffer.from(await g.arrayBuffer()).length !== vid.length || g.headers.get('content-type') !== 'video/mp4') throw new Error('lecture entière depuis OVH');
        if ((await fetch(url, { headers: { 'if-none-match': etag } })).status !== 304) throw new Error('revalidation par ETag depuis OVH : 304 attendu');
        // L'ancien envoi (base64) range lui aussi sur OVH.
        o = await srv.j('POST', '/api/v1/media', { name: 'lt-b64.png', kind: 'photo', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
        if (o.storage !== 's3' || !s3.objects.has('media/lt-b64.png')) throw new Error('ancien envoi base64 non rangé sur OVH');
        // 3. Migration des médias locaux vers OVH (copie vérifiée, copie locale gardée).
        await srv.j('POST', '/api/v1/media-storage/migrate');
        for (let i = 0; i < 40 && (st = await srv.j('GET', '/api/v1/media-storage')).job && st.job.running; i++) await new Promise((res) => setTimeout(res, 100));
        if (!st.job || st.job.moved !== 1 || st.job.errors.length || st.counts.local !== 0) throw new Error(`migration : ${JSON.stringify(st.job)}`);
        if (!s3.objects.has('media/lt-local.png') || !exists(join(mediaDir, 'lt-local.png'))) throw new Error('migration : objet absent ou copie locale effacée');
        const before = s3.calls.length;
        g = await fetch(`${srv.base}/media/lt-local.png`);
        if (g.status !== 200 || !s3.calls.slice(before).some((c) => c.includes('/media/lt-local.png'))) throw new Error('média migré non servi depuis OVH');
        // 4. Panne d'OVH : envoi refusé et dit, rien d'enregistré ; lecture 502.
        const n0 = (await srv.j('GET', '/api/v1/media')).media.length;
        s3.down(true);
        r = await srv.up('LT panne.mp4', Buffer.from('x'), 'video/mp4');
        o = await r.json();
        const g502 = (await fetch(url)).status;
        s3.down(false);
        if (r.status !== 502 || !/503/.test(o.error || '')) throw new Error(`panne : HTTP ${r.status} ${o.error}`);
        if ((await srv.j('GET', '/api/v1/media')).media.length !== n0) throw new Error('fiche créée malgré l’échec de l’envoi');
        if (g502 !== 502) throw new Error(`lecture pendant la panne : HTTP ${g502}`);
        // 5. Suppression : l'objet du bucket, et la copie locale.
        for (const m of (await srv.j('GET', '/api/v1/media')).media) await srv.j('DELETE', `/api/v1/media/${encodeURIComponent(m.id)}`);
        if (s3.objects.size || exists(join(mediaDir, 'lt-local.png'))) throw new Error(`après suppression : ${s3.objects.size} objet(s) au bucket`);
        return 'local avant OVH · 2 Mo en flux → bucket (type vidéo, pas sur le disque) · 206 / 304 servis depuis OVH · base64 → OVH · migration vérifiée (copie locale gardée) · panne : 502 dit, rien d’enregistré · suppression au bucket · clés jamais exposées · signature vérifiée à chaque appel';
      } finally {
        if (srv) await srv.stop().catch(() => {});
        s3.close();
        for (const f of ['lt-local.png', 'LT ovh.mp4', 'lt-b64.png']) { try { unlink(join(mediaDir, f)); } catch { /* absent */ } }
      }
    });
    await step('Élément « média ciblé » — pioche selon moment + saison', async () => {
      // moment courant calculé EXACTEMENT comme le serveur (fenêtres par défaut).
      const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
      const moment = (mins >= 360 && mins < 660) ? 'matin' : (mins >= 660 && mins < 900) ? 'midi'
        : (mins >= 900 && mins < 1200) ? 'aprem' : (now.getHours() < 11 ? 'matin' : now.getHours() < 16 ? 'midi' : 'aprem');
      const bad = moment === 'matin' ? 'aprem' : 'matin';
      const dU = (s) => 'data:video/mp4;base64,' + Buffer.from(s).toString('base64');
      await call('POST', '/api/v1/media', { name: 'mediael-good.mp4', kind: 'film', moment, dataUrl: dU('g') });
      await call('POST', '/api/v1/media', { name: 'mediael-bad.mp4', kind: 'film', moment: bad, dataUrl: dU('b') });
      const st = await call('GET', '/api/v1/state');
      const mods = st.modules.concat([{ id: 'mediaLT', type: 'media', name: 'Média ciblé', layout: 'cover', dur: 12, schedule: { days: [1, 1, 1, 1, 1, 1, 1], from: '00:00', to: '23:59' }, items: [] }]);
      const pls = st.playlists.map((p) => (p.id === st.activePlaylistId ? { ...p, items: [...p.items, 'mediaLT'] } : p));
      await call('PUT', '/api/v1/draft', { modules: mods, playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      let ok2 = false, badPicked = false, cnt = null;
      for (let i = 0; i < 10; i++) {
        const f = await (await fetch(BASE + `/api/v1/film?film=${encodeURIComponent(st.activePlaylistId)}`)).json();
        const em = (f.modules || []).find((x) => x.id === 'mediaLT');
        if (em) { cnt = em.mediaCount; if (em.mediaUrl) ok2 = true; if (/mediael-bad/.test(em.mediaUrl || '')) badPicked = true; }
      }
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      for (const mm of (await call('GET', '/api/v1/media')).media || []) if (/mediael-/.test(mm.filename)) await call('DELETE', `/api/v1/media/${encodeURIComponent(mm.id)}`);
      if (!ok2) throw new Error('aucun média pioché');
      if (badPicked) throw new Error('média du mauvais moment pioché');
      if (cnt !== 1) throw new Error(`éligibles attendus 1, reçu ${cnt}`);
      return `moment ${moment} · 1 éligible pioché, mauvais moment exclu`;
    });
    await step('PUT /api/v1/product-moments — produit × moment (aller-retour)', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const p = (cat.products || [])[0];
      if (!p) return 'catalogue vide (aucun produit)';
      const before = await call('GET', '/api/v1/product-moments');
      const out = await call('PUT', '/api/v1/product-moments', { rows: [
        { productId: p.id, moment: 'matin', exception: false },
        { productId: p.id, moment: 'midi', exception: true },
      ] });
      const inc = (out.rows || []).find((r) => r.productId === p.id && r.moment === 'matin');
      const exc = (out.rows || []).find((r) => r.productId === p.id && r.moment === 'midi');
      if (!inc || inc.exception) throw new Error('inclusion (matin) non enregistrée');
      if (!exc || !exc.exception) throw new Error('exception (midi) non enregistrée');
      await call('PUT', '/api/v1/product-moments', { rows: before.rows }); // restauration
      return `${p.name} : matin vendu + midi exclu`;
    });
    await step('Film « continu » — boucle générée · moment · exception', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const actives = (cat.products || []).filter((p) => p.active !== false);
      if (actives.length < 2) return `catalogue insuffisant (${actives.length} produit actif)`;
      const p0 = actives[0]; const p1 = actives[1];
      const st = await call('GET', '/api/v1/state');
      const pmBefore = await call('GET', '/api/v1/product-moments');
      // moment courant dans le vocabulaire des périodes de vente (matin/midi/aprem).
      const moment = pmBefore.current;
      // p0 exclu au moment courant ; p1 laissé par défaut (vendu partout).
      await call('PUT', '/api/v1/product-moments', { rows: [{ productId: p0.id, moment, exception: true }] });
      const contFilm = {
        id: 'pl-contLT', name: 'Boucle continue LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: true, order: 'catalogue', maxItems: 20,
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 },
          exceptionFilms: [st.activePlaylistId] },
      };
      const pls = [...st.playlists, contFilm];
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const f = await (await fetch(BASE + '/api/v1/film?film=pl-contLT')).json();
      // restauration AVANT les assertions (pour ne rien laisser derrière)
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
      if (!f.continuous) throw new Error('film non marqué continu');
      if (!f.revision) throw new Error('révision absente');
      if (!Array.isArray(f.modules) || !f.modules.length) throw new Error('boucle vide');
      const itemPids = f.modules.flatMap((m) => (m.items || []).map((it) => it.productId));
      if (itemPids.includes(p0.id)) throw new Error('produit exclu au moment courant présent dans la boucle');
      if (!itemPids.includes(p1.id)) throw new Error('produit vendu absent de la boucle');
      if (!f.modules.some((m) => String(m.id).startsWith('k-exc-'))) throw new Error('playlist d\'exception non injectée');
      return `${f.modules.length} slot(s) · moment ${moment} · p0 exclu, p1 présent, exception OK`;
    });
    await step('Rupture produit — exclu de la boucle continue', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const actives = (cat.products || []).filter((p) => p.active !== false && !p.unavailable);
      if (actives.length < 2) return `catalogue insuffisant (${actives.length} produit dispo)`;
      const target = actives[0];
      const st = await call('GET', '/api/v1/state');
      const prods = cat.products.map((p) => (p.id === target.id ? { ...p, unavailable: true } : p));
      await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: prods });
      const contFilm = { id: 'pl-ruptLT', name: 'Rupture LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 40,
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 } } };
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: [...st.playlists, contFilm], activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const f = await (await fetch(BASE + '/api/v1/film?film=pl-ruptLT')).json();
      // restauration AVANT les assertions
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: cat.products });
      const pids = (f.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId));
      if (pids.includes(target.id)) throw new Error(`produit en rupture (${target.name}) présent dans la boucle`);
      return `${target.name} en rupture → exclu · ${f.modules ? f.modules.length : 0} slot(s)`;
    });
    await step('Jetons dynamiques — {{magasin}}/{{adresse}} résolus par magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const st = await call('GET', '/api/v1/state');
      const coord0 = { address: store.address || '' };
      const tokMod = { id: 'mTOKLT', type: 'liaison', name: 'Bienvenue à {{magasin}}', sub: '{{adresse}} · {{moment}} · {{xyz}}', dur: 6, items: [] };
      await call('POST', `/api/v1/stores/${store.id}`, { address: 'TESTADDR-Corbais' });
      await call('PUT', '/api/v1/draft', {
        modules: [...st.modules, tokMod],
        playlists: [...st.playlists, { id: 'pl-tokLT', name: 'Film jetons LT', items: [] }],
        activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
      });
      const f = await (await fetch(BASE + `/api/v1/film?film=pl-tokLT&store=${encodeURIComponent(store.id)}`)).json();
      // restauration AVANT les assertions (brouillon + coordonnées d'origine)
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('POST', `/api/v1/stores/${store.id}`, coord0);
      const m = (f.modules || []).find((x) => x.id === 'mTOKLT');
      if (!m) throw new Error('module à jetons absent du film');
      if (m.name !== `Bienvenue à ${store.store}`) throw new Error(`{{magasin}} non injecté : ${m.name}`);
      if (!String(m.sub).startsWith('TESTADDR-Corbais')) throw new Error(`{{adresse}} non injectée : ${m.sub}`);
      if (!/\{\{\s*xyz\s*\}\}/.test(m.sub)) throw new Error('un jeton inconnu doit rester littéral');
      return `« ${m.name} » · sous-titre résolu, jeton inconnu conservé`;
    });
    await step('Groupe d\'écrans — zone catégories (toute la journée) + rattachement', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin');
      const cat = await call('GET', '/api/v1/catalog');
      const c0 = (cat.categories || [])[0];
      if (!c0) return 'aucune catégorie au catalogue';
      const catOf = new Map(cat.products.map((p) => [p.id, p.categoryId]));
      // 1) créer une zone (combo portrait propre) avec cette catégorie
      const created = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Zone LT', screens: 1, size: 55, orient: 'portrait', cats: [c0.id] });
      if (!created.ok || !created.group || !created.group.id) throw new Error('création de zone échouée');
      const gid = created.group.id;
      try {
        if (created.group.format.w !== 2160 || created.group.format.h !== 3840) throw new Error(`format zone inattendu : ${created.group.format.px}`);
        // 2) aperçu ?group= : la boucle ne contient QUE cette catégorie
        const prev = await (await fetch(BASE + `/api/v1/film?group=${encodeURIComponent(gid)}`)).json();
        const pids = (prev.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId));
        if (!pids.length || !pids.every((pid) => catOf.get(pid) === c0.id)) throw new Error('aperçu zone : produit hors catégorie');
        if (!prev.format || prev.format.w !== 2160) throw new Error('aperçu zone : format du groupe non appliqué');
        // 3) rattacher un écran → son assignment sert la boucle catégories au format du groupe
        const player = (store.players || [])[0];
        let assignTxt = 'pas d\'écran à rattacher';
        if (player) {
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: gid });
          const a = await call('GET', `/api/v1/players/${player.id}/assignment?token=${player.token}`);
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: '' }); // détacher AVANT assertions
          if (a.groupId !== gid) throw new Error('assignment ne reflète pas la zone');
          const apids = (a.snapshot.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId));
          if (apids.length && !apids.every((pid) => catOf.get(pid) === c0.id)) throw new Error('produit hors catégorie dans la zone assignée');
          if (!a.snapshot.format || a.snapshot.format.w !== 2160) throw new Error('format du groupe non appliqué à l\'écran');
          assignTxt = `écran « ${player.name} » → zone (${apids.length} slot(s), ${a.snapshot.format.px})`;
        }
        return `zone « ${c0.name} » ${created.group.format.px} · aperçu ${pids.length} produit(s) en catégorie · ${assignTxt}`;
      } finally {
        // 4) nettoyage : suppression de la zone (détache aussi les écrans)
        await call('DELETE', `/api/v1/groups/${gid}`);
      }
    });
    await step('Secteurs d\'écrans — position + nombre, config INDÉPENDANTE', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin');
      const storePx0 = store.format.px;
      // Deux secteurs du MÊME magasin, configurés différemment.
      const a = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Secteur A LT', screens: 3, size: 55, orient: 'portrait', cats: [] });
      const b = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Secteur B LT', screens: 1, size: 43, orient: 'paysage', cats: [] });
      try {
        if (a.group.format.w !== 6480 || a.group.format.h !== 3840) throw new Error(`secteur A (3 × portrait) → ${a.group.format.px}`);
        if (b.group.format.w !== 3840 || b.group.format.h !== 2160) throw new Error(`secteur B (1 × paysage) → ${b.group.format.px}`);
        // Modifier A ne doit toucher NI B NI le magasin.
        await call('POST', `/api/v1/groups/${a.group.id}`, { screens: 2, orient: 'paysage' });
        const fl2 = await call('GET', '/api/v1/fleet');
        const st2 = fl2.stores.find((s) => s.id === store.id);
        const gA = st2.groups.find((g) => g.id === a.group.id);
        const gB = st2.groups.find((g) => g.id === b.group.id);
        if (!gA || gA.format.w !== 7680 || gA.format.h !== 2160) throw new Error(`secteur A non mis à jour → ${gA && gA.format.px}`);
        if (!gB || gB.format.px !== b.group.format.px) throw new Error('secteur B modifié par la config de A — pas indépendant');
        if (st2.format.px !== storePx0) throw new Error('le format du MAGASIN a été modifié par un secteur');
        // Un écran rattaché prend le format de SON secteur.
        const player = (store.players || [])[0];
        let asgTxt = 'pas d\'écran à rattacher';
        if (player) {
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: b.group.id });
          const asg = await call('GET', `/api/v1/players/${player.id}/assignment?token=${player.token}`);
          await call('POST', `/api/v1/players/${player.id}/group`, { groupId: '' }); // détacher AVANT assertions
          if (!asg.snapshot.format || asg.snapshot.format.w !== 3840 || asg.snapshot.format.h !== 2160) {
            throw new Error(`l'écran ne reçoit pas le format de SON secteur → ${asg.snapshot.format && asg.snapshot.format.px}`);
          }
          asgTxt = `écran « ${player.name} » → secteur B (${asg.snapshot.format.px})`;
        }
        return `A ${gA.format.label} (${gA.format.px}) · B ${gB.format.label} (${gB.format.px}) · magasin inchangé · ${asgTxt}`;
      } finally {
        await call('DELETE', `/api/v1/groups/${a.group.id}`);
        await call('DELETE', `/api/v1/groups/${b.group.id}`);
      }
    });
    await step('Vidéo — cadrage (adapter/remplir) + position et zoom', async () => {
      const st = await call('GET', '/api/v1/state');
      const mods = [...st.modules, {
        id: 'mVidLT', type: 'film', name: 'Vidéo LT', orient: 'paysage', layout: 'contain', dur: 10,
        video: 'media/lt.mp4', items: [], bgColor: '#8D1D2C', pos: { vidX: 240, vidY: -120, vidZoom: 1.4 },
      }];
      try {
        await call('PUT', '/api/v1/draft', { modules: mods, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        const back = (await call('GET', '/api/v1/state')).modules.find((m) => m.id === 'mVidLT');
        if (!back) throw new Error('élément vidéo non enregistré');
        if (back.layout !== 'contain') throw new Error('cadrage « adapter » non conservé : ' + back.layout);
        const p = back.pos || {};
        if (p.vidX !== 240 || p.vidY !== -120 || Math.abs(p.vidZoom - 1.4) > 0.001) {
          throw new Error('position/zoom non conservés : ' + JSON.stringify(p));
        }
        if (back.bgColor !== '#8D1D2C') throw new Error('couleur de fond non conservée : ' + back.bgColor);
        // Une valeur qui n'est pas une couleur est refusée (retour au noir).
        await call('PUT', '/api/v1/draft', {
          modules: mods.map((m) => (m.id === 'mVidLT' ? { ...m, bgColor: 'rouge; drop table' } : m)),
          playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
        });
        const bad = (await call('GET', '/api/v1/state')).modules.find((m) => m.id === 'mVidLT');
        if (bad.bgColor !== '') throw new Error('couleur invalide acceptée : ' + JSON.stringify(bad.bgColor));
        return `cadrage « adapter » · décalage +240 / −120 px · zoom 1.40× · fond rubis conservés · couleur invalide refusée`;
      } finally {
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Suites — intro / clôture / toutes les N, montées à la main', async () => {
      const st = await call('GET', '/api/v1/state');
      const before = await call('GET', '/api/v1/sequences');
      // Trois éléments repérables, au format paysage.
      const mk = (id, name) => ({ id, type: 'liaison', name, sub: '', orient: 'paysage', items: [] });
      const mods = [...st.modules, mk('mSeqA', 'INTRO-LT'), mk('mSeqB', 'GAMME-LT'), mk('mSeqC', 'OUTRO-LT')];
      const film = { id: 'pl-seqLT', name: 'Suites LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 12, orient: 'paysage',
          ratios: { liaison: 0, produitSeul: 1, media: 0, animation: 0, surprise: 0 },
          sequences: ['sqIntroLT', 'sqGammeLT', 'sqOutroLT'] } };
      const seqs = [
        { id: 'sqIntroLT', name: 'Intro LT', placement: 'debut', orient: 'paysage', active: true, items: ['mSeqA'] },
        { id: 'sqGammeLT', name: 'Gamme LT', placement: 'boucle', ratio: 3, orient: 'paysage', active: true, items: ['mSeqB'] },
        { id: 'sqOutroLT', name: 'Outro LT', placement: 'fin', orient: 'paysage', active: true, items: ['mSeqC'] },
        // Une suite au MAUVAIS format ne doit pas passer sur une boucle paysage.
        { id: 'sqPortLT', name: 'Portrait LT', placement: 'debut', orient: 'portrait', active: true, items: ['mSeqA'] },
      ];
      const names = async () => {
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-seqLT')).json();
        return (f.modules || []).map((m) => m.name || '');
      };
      try {
        await call('PUT', '/api/v1/sequences', { sequences: seqs });
        const back = (await call('GET', '/api/v1/sequences')).sequences;
        const intro = back.find((s) => s.id === 'sqIntroLT');
        if (!intro || intro.placement !== 'debut' || intro.items.join() !== 'mSeqA') throw new Error('aller-retour de la suite incorrect : ' + JSON.stringify(intro));
        await call('PUT', '/api/v1/draft', { modules: mods, playlists: [...st.playlists, { ...film, continuous: { ...film.continuous, sequences: [...film.continuous.sequences, 'sqPortLT'] } }], activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        const out = await names();
        if (out[0] !== 'INTRO-LT') throw new Error(`l'ouverture n'est pas en tête : ${out.slice(0, 3).join(' | ')}`);
        if (out[out.length - 1] !== 'OUTRO-LT') throw new Error(`la clôture n'est pas en fin : ${out.slice(-3).join(' | ')}`);
        const gamme = out.filter((n) => n === 'GAMME-LT').length;
        if (gamme < 1) throw new Error('la suite « toutes les N » ne passe jamais');
        if (out.filter((n) => n === 'INTRO-LT').length !== 1) throw new Error('la suite portrait est passée sur une boucle paysage');
        // Une suite désactivée disparaît de la boucle.
        await call('PUT', '/api/v1/sequences', { sequences: seqs.map((s) => (s.id === 'sqIntroLT' ? { ...s, active: false } : s)) });
        const off = await names();
        if (off.includes('INTRO-LT')) throw new Error('une suite inactive passe encore');
        // Une suite non retenue par le film ne passe pas non plus.
        await call('PUT', '/api/v1/sequences', { sequences: seqs });
        await call('PUT', '/api/v1/draft', { modules: mods, playlists: [...st.playlists, { ...film, continuous: { ...film.continuous, sequences: [] } }], activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        const none = await names();
        if (none.includes('INTRO-LT') || none.includes('OUTRO-LT')) throw new Error('une suite non retenue par le film passe quand même');
        return `ouverture en tête · ${gamme} passage(s) de la suite « 1:3 » · clôture en fin · format et sélection respectés`;
      } finally {
        await call('PUT', '/api/v1/sequences', { sequences: before.sequences });
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Animation — import d\'un fichier (fond + animation autonome)', async () => {
      const st = await call('GET', '/api/v1/state');
      // 1 × 1 px GIF : le plus petit fichier valide pour l'aller-retour.
      const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const up = await call('POST', '/api/v1/anim-assets', { name: 'lt-anim.gif', dataUrl: gif });
      if (!up.ok || !/^anim\//.test(up.url)) throw new Error('upload refusé : ' + JSON.stringify(up));
      // Le fichier est réellement servi.
      const got = await fetch(BASE + '/' + up.url);
      if (!got.ok) throw new Error(`le fichier importé n'est pas servi (HTTP ${got.status})`);
      // Un .json illisible est refusé plutôt que de vider un écran en magasin.
      let refused = false;
      try { await call('POST', '/api/v1/anim-assets', { name: 'ko.json', dataUrl: 'data:application/json;base64,' + Buffer.from('pas du json').toString('base64') }); }
      catch { refused = true; }
      if (!refused) throw new Error('un .json illisible a été accepté');
      // Format inconnu refusé aussi.
      let refused2 = false;
      try { await call('POST', '/api/v1/anim-assets', { name: 'x.exe', dataUrl: gif }); } catch { refused2 = true; }
      if (!refused2) throw new Error('une extension non supportée a été acceptée');
      // Aller-retour des champs sur un élément « animation ».
      const mods = [...st.modules, {
        id: 'mAnimLT', type: 'animation', name: 'Anim LT', sub: '', orient: 'paysage', items: [],
        animMode: 'fichier', animFile: up.url, animBg: up.url, animDim: 70, animFit: 'contain',
      }];
      try {
        await call('PUT', '/api/v1/draft', { modules: mods, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        const back = (await call('GET', '/api/v1/state')).modules.find((m) => m.id === 'mAnimLT');
        if (!back) throw new Error('élément animation non enregistré');
        if (back.animMode !== 'fichier' || back.animFile !== up.url || back.animBg !== up.url) throw new Error('champs non conservés : ' + JSON.stringify(back));
        if (back.animDim !== 70 || back.animFit !== 'contain') throw new Error('voile/cadrage non conservés : ' + JSON.stringify({ d: back.animDim, f: back.animFit }));
        // Le type d'élément annonce bien la double possibilité.
        const t = (await call('GET', '/api/v1/element-types')).types.find((x) => x.id === 'animation');
        if (!/fichier/i.test(t.label)) throw new Error('le libellé du type n\'annonce pas le fichier : ' + t.label);
        return `« ${up.name} » servi · mode fichier + fond + voile 70 % + cadrage conservés · .json et .exe refusés`;
      } finally {
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Matières premières — ingrédient lié à une animation', async () => {
      const before = await call('GET', '/api/v1/ingredients');
      const st = await call('GET', '/api/v1/state');
      const anim = (st.modules || []).find((m) => m.type === 'animation');
      try {
        const row = { id: 'ingLTTEST', name: 'Beurre AOP LT', extRef: 'MP-42', moduleId: anim ? anim.id : '', active: true };
        const saved = await call('PUT', '/api/v1/ingredients', { ingredients: [...before.ingredients, row] });
        const back = (saved.ingredients || []).find((x) => x.id === row.id);
        if (!back || back.name !== row.name || back.extRef !== 'MP-42' || back.moduleId !== row.moduleId) {
          throw new Error('aller-retour incorrect : ' + JSON.stringify(back));
        }
        // Un ingrédient sans nom est refusé (ligne inutilisable).
        const noName = await call('PUT', '/api/v1/ingredients', { ingredients: [{ id: 'x', name: '  ' }] });
        if ((noName.ingredients || []).length) throw new Error('un ingrédient sans nom a été accepté');
        return `« ${row.name} » (réf. MP-42)${anim ? ` → animation « ${anim.name || anim.id} »` : ' · aucune animation en bibliothèque'}`;
      } finally {
        await call('PUT', '/api/v1/ingredients', { ingredients: before.ingredients });
      }
    });
    await step('Réécriture du catalogue — les réglages de la régie survivent', async () => {
      // Le rafraîchissement ERP réécrit le catalogue (DELETE + INSERT sur les
      // mêmes ids). Les tags de période, eux, appartiennent à la régie : ils ne
      // doivent pas partir avec.
      const cat = await call('GET', '/api/v1/catalog');
      const p = (cat.products || []).find((x) => x.active !== false);
      if (!p) return 'aucun produit actif';
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const lcBefore = await call('GET', '/api/v1/lib-categories');
      try {
        await call('PUT', '/api/v1/product-moments', { rows: [
          { productId: p.id, moment: 'matin', exception: false, kind: 'produit' },
          { productId: p.categoryId, moment: 'midi', exception: true, kind: 'categorie' },
        ] });
        // Réécriture intégrale du catalogue, ids inchangés.
        await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: cat.products });
        const after = await call('GET', '/api/v1/product-moments');
        const mine = (after.rows || []).filter((r) => r.productId === p.id || r.productId === p.categoryId);
        if (mine.length !== 2) throw new Error(`les tags ont été perdus à la réécriture : ${JSON.stringify(after.rows)}`);
        const lcAfter = await call('GET', '/api/v1/lib-categories');
        if (lcAfter.libCategories.length !== lcBefore.libCategories.length) throw new Error('les catégories de bibliothèque ont bougé');
        // Le visuel et l'état rupture restent ceux de la régie.
        const p2 = (await call('GET', '/api/v1/catalog')).products.find((x) => x.id === p.id);
        if (p2.img !== p.img || p2.src !== p.src) throw new Error(`visuel modifié : ${p2.src} ${p2.img}`);
        return `tags produit + catégorie conservés · visuel « ${p2.src} » intact · ${lcAfter.libCategories.length} catégorie(s) de bibliothèque`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
      }
    });
    await step('Régie → Apparition — résumé lu par la carte produit ERP', async () => {
      const cat = await call('GET', '/api/v1/catalog');
      const p = (cat.products || []).find((x) => x.active !== false);
      if (!p) return 'aucun produit actif';
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const moment = pmBefore.current;
      const other = ['matin', 'midi', 'aprem'].find((m) => m !== moment);
      try {
        const a0 = await call('GET', `/api/v1/appearance?product=${encodeURIComponent(p.id)}`);
        if (!a0.produit || a0.produit.id !== p.id) throw new Error('produit absent du résumé');
        if (!Array.isArray(a0.periodes) || a0.periodes.length !== 3) throw new Error('les 3 périodes devraient être décrites');
        if (a0.maintenant.visible !== true) throw new Error('sans règle, le produit devrait être visible maintenant');
        if (!Array.isArray(a0.secteurs)) throw new Error('secteurs absents');
        // Un tag posé en régie se lit tout de suite dans le résumé.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: p.id, moment: other, exception: false, kind: 'produit' }] });
        const a1 = await call('GET', `/api/v1/appearance?product=${encodeURIComponent(p.id)}`);
        if (a1.maintenant.visible !== false || a1.maintenant.raison !== 'hors période') throw new Error('le tag de période n\'est pas reflété : ' + JSON.stringify(a1.maintenant));
        const row = a1.periodes.find((m) => m.id === other);
        if (!row || row.produit !== 'visible' || !row.visible) throw new Error('la période taguée devrait être « visible » : ' + JSON.stringify(row));
        // Le tag de la CATÉGORIE se lit aussi, et prime.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: p.categoryId, moment: other, exception: false, kind: 'categorie' }] });
        const a2 = await call('GET', `/api/v1/appearance?product=${encodeURIComponent(p.id)}`);
        const r2 = a2.periodes.find((m) => m.id === moment);
        if (!r2 || r2.categorie !== 'aucune règle' || r2.visible) throw new Error('le tag de catégorie devrait masquer ce créneau : ' + JSON.stringify(r2));
        const bad = await fetch(BASE + '/api/v1/appearance?product=nexiste-pas', { headers: { authorization: `Bearer ${authToken}` } });
        if (bad.status !== 404) throw new Error(`produit inconnu → ${bad.status} (404 attendu)`);
        return `« ${p.name} » · ${a0.periodes.length} périodes · ${a0.secteurs.length} secteur(s) · ${a0.elements.length} élément(s) · tags produit + catégorie reflétés`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
      }
    });
    await step('Périodes sur une PROMOTION et une CAMPAGNE', async () => {
      const st = await call('GET', '/api/v1/state');
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const moment = pmBefore.current;
      const other = ['matin', 'midi', 'aprem'].find((m) => m !== moment);
      const pt = (await call('GET', '/api/v1/promo-types')).promoTypes[0];
      const cmps = (await call('GET', '/api/v1/campaigns')).campaigns;
      if (!pt || !cmps.length) return 'aucun sous-type de promotion ou campagne';
      const cmp = cmps[0];
      // Deux éléments de bibliothèque : une promo et une campagne, non tagués
      // eux-mêmes — c'est l'ENTITÉ pointée qui porte la période.
      const mods = [...st.modules,
        { id: 'mPromoLT', type: 'promotion', name: 'Promo LT', promoType: pt.id, orient: 'paysage', moments: [], items: [] },
        { id: 'mCampLT', type: 'campagne', name: 'Camp LT', campaignRef: cmp.id, orient: 'paysage', moments: [], items: [] }];
      const film = { id: 'pl-tagLT', name: 'Tags LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 12, orient: 'paysage',
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 },
          itemRatios: [{ id: 'mPromoLT', on: true, n: 2 }, { id: 'mCampLT', on: true, n: 3 }] } };
      const put = () => call('PUT', '/api/v1/draft', { modules: mods, playlists: [...st.playlists, film], activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const namesOf = async () => {
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-tagLT')).json();
        return (f.modules || []).map((m) => m.name || '').join('|');
      };
      try {
        await put();
        const both = await namesOf();
        if (!both.includes('Promo LT') || !both.includes('Camp LT')) throw new Error('sans tag, les deux devraient passer : ' + both);
        // La promo n'est visible qu'à un AUTRE moment → elle disparaît.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: pt.id, moment: other, exception: false, kind: 'promotion' }] });
        const noPromo = await namesOf();
        if (noPromo.includes('Promo LT')) throw new Error(`la promo « ${pt.name} » passe hors de sa période`);
        if (!noPromo.includes('Camp LT')) throw new Error('la campagne ne devrait pas être affectée par le tag de la promo');
        // Idem pour la campagne, via une exception au moment courant.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: cmp.id, moment, exception: true, kind: 'campagne' }] });
        const noCamp = await namesOf();
        if (noCamp.includes('Camp LT')) throw new Error(`la campagne « ${cmp.name} » passe alors qu'elle est exclue à ${moment}`);
        if (!noCamp.includes('Promo LT')) throw new Error('la promo devrait être revenue (son tag a été remplacé)');
        return `promo « ${pt.name} » limitée à ${other} → absente à ${moment} · campagne « ${cmp.name} » exclue à ${moment} → absente`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Catégories de bibliothèque — éditables + table liée', async () => {
      const before = await call('GET', '/api/v1/lib-categories');
      if (!Array.isArray(before.libCategories) || !before.libCategories.length) throw new Error('aucune catégorie de bibliothèque');
      if (!Array.isArray(before.libSources) || !before.libSources.some((s) => s.id === 'produits')) throw new Error('tables liées non exposées');
      const seeded = before.libCategories.find((c) => c.id === 'produit');
      if (!seeded || seeded.src !== 'produits') throw new Error('la catégorie « produit » devrait être liée à la table produits');
      try {
        const extra = { id: 'lcLTTEST', name: 'Catégorie LT', color: '#123456', src: 'campagnes', active: true };
        const saved = await call('PUT', '/api/v1/lib-categories', { libCategories: [...before.libCategories, extra] });
        const back = (saved.libCategories || []).find((c) => c.id === extra.id);
        if (!back || back.name !== extra.name || back.color !== extra.color || back.src !== 'campagnes') {
          throw new Error('aller-retour de la catégorie incorrect : ' + JSON.stringify(back));
        }
        // Une table inconnue retombe sur « aucune » plutôt que d'être écrite telle quelle.
        const fake = await call('PUT', '/api/v1/lib-categories', { libCategories: [{ ...extra, src: 'table-qui-nexiste-pas' }] });
        const f = (fake.libCategories || []).find((c) => c.id === extra.id);
        if (!f || f.src !== '') throw new Error('table inconnue acceptée : ' + JSON.stringify(f));
        // Liste vide refusée : la bibliothèque garde toujours un classement.
        const empty = await call('PUT', '/api/v1/lib-categories', { libCategories: [] });
        if (!(empty.libCategories || []).length) throw new Error('une liste vide a effacé le classement');
        return `${before.libCategories.length} catégorie(s) · ${before.libSources.length} tables liables · aller-retour + garde-fous OK`;
      } finally {
        await call('PUT', '/api/v1/lib-categories', { libCategories: before.libCategories });
      }
    });
    await step('Secteur — filtre PÉRIODES / CATÉGORIES au choix', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      const cat = await call('GET', '/api/v1/catalog');
      const c0 = (cat.categories || [])[0];
      if (!store || !c0) return 'aucun magasin ou catégorie';
      const pmBefore = await call('GET', '/api/v1/product-moments');
      const moment = pmBefore.current;
      // Le catalogue de démo n'a qu'une catégorie : on en ajoute une seconde le
      // temps du test, sinon « filtrer les catégories » ne changerait rien.
      const cLT = { id: 'pc_cLT', name: 'Catégorie LT', img: '' };
      const pLT = { id: 'pr_cLT', name: 'Produit LT', price: '3,50', categoryId: cLT.id, img: 'assets/cookies.png', active: true };
      await call('PUT', '/api/v1/catalog', { categories: [...cat.categories, cLT], products: [...cat.products, pLT] });
      const g = await call('POST', `/api/v1/stores/${store.id}/groups`, { name: 'Secteur filtre LT', screens: 1, size: 55, orient: 'paysage', cats: [c0.id] });
      const pidsOf = async () => {
        const f = await (await fetch(BASE + `/api/v1/film?group=${encodeURIComponent(g.group.id)}`)).json();
        return (f.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId)).filter(Boolean);
      };
      try {
        // Par défaut : filtre catégories oui, périodes non (comportement d'origine).
        if (g.group.filterCats !== true || g.group.filterMoments !== false) throw new Error('défauts du secteur inattendus : ' + JSON.stringify({ c: g.group.filterCats, m: g.group.filterMoments }));
        const catOf = new Map([...cat.products, pLT].map((p) => [p.id, p.categoryId]));
        const only = await pidsOf();
        if (!only.length || only.some((pid) => catOf.get(pid) !== c0.id)) throw new Error(`le filtre catégories ne tient pas (${only.length} produit(s))`);
        // Catégories non + périodes oui → sa propre boucle, tout le catalogue.
        // On repart d'une table de périodes vide pour isoler l'effet mesuré.
        await call('PUT', '/api/v1/product-moments', { rows: [] });
        await call('POST', `/api/v1/groups/${g.group.id}`, { filterCats: false, filterMoments: true });
        const all = await pidsOf();
        // La boucle est bornée en nombre de slots : on compare les CATÉGORIES
        // atteintes, pas le nombre de passages.
        if (!all.some((pid) => catOf.get(pid) !== c0.id)) throw new Error('« catégories : non » devrait élargir hors de la catégorie choisie');
        // Périodes : un produit exclu au moment courant disparaît…
        const target = [...cat.products, pLT].find((p) => p.active !== false && !p.unavailable && all.includes(p.id));
        if (!target) throw new Error('aucun produit testable pour les périodes');
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: target.id, moment, exception: true }] });
        const timed = await pidsOf();
        if (timed.includes(target.id)) throw new Error(`« périodes : oui » ne filtre pas (${target.name} passe hors créneau)`);
        // …et revient dès que le secteur ne filtre plus les périodes.
        await call('POST', `/api/v1/groups/${g.group.id}`, { filterMoments: false, filterCats: true });
        const back = await pidsOf();
        if (!back.includes(target.id)) throw new Error('« périodes : non » devrait laisser passer le produit');
        // Aucun filtre → le secteur suit le film du magasin (pas de boucle propre).
        await call('POST', `/api/v1/groups/${g.group.id}`, { filterCats: false, filterMoments: false });
        const none = await (await fetch(BASE + `/api/v1/film?group=${encodeURIComponent(g.group.id)}`)).json();
        const shop = await (await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`)).json();
        const ids = (f) => (f.modules || []).map((m) => m.id).join('|');
        if (ids(none) !== ids(shop)) throw new Error('sans filtre, le secteur devrait diffuser le film du magasin');
        const nCats = new Set(all.map((pid) => catOf.get(pid))).size;
        return `catégories oui (« ${c0.name} » seule) → non (${nCats} catégories) · périodes oui/non (${target.name} masqué puis rendu) · sans filtre = film du magasin`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: pmBefore.rows });
        await call('PUT', '/api/v1/catalog', { categories: cat.categories, products: cat.products });
        await call('DELETE', `/api/v1/groups/${g.group.id}`);
      }
    });
    await step('Promotion — sous-type dynamique + badge résolu dans le film', async () => {
      const before = await call('GET', '/api/v1/promo-types');
      const st = await call('GET', '/api/v1/state');
      // 1) Ajouter un sous-type de promotion (aller-retour PUT /promo-types)
      const extra = { id: 'ptLTTEST', name: 'Test LT', icon: '🧪', color: '#123456', descr: 'sous-type de test', active: true };
      const saved = await call('PUT', '/api/v1/promo-types', { promoTypes: [...before.promoTypes, extra] });
      try {
        const got = (saved.promoTypes || []).find((t) => t.id === 'ptLTTEST');
        if (!got || got.name !== 'Test LT' || got.color !== '#123456') throw new Error('sous-type de promotion non persisté');
        // 2) Élément « promotion » référençant ce sous-type
        const promoMod = { id: 'mPROMOLT', type: 'promotion', name: 'Happy hour -20%', sub: '16h → 18h', promoType: 'ptLTTEST', layout: 'band', dur: 7, items: [] };
        await call('PUT', '/api/v1/draft', {
          modules: [...st.modules, promoMod],
          playlists: [...st.playlists, { id: 'pl-promoLT', name: 'Film promo LT', items: ['mPROMOLT'] }],
          activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
        });
        // 3) Le film résout le badge (icône · couleur · libellé) sur le module
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-promoLT')).json();
        const m = (f.modules || []).find((x) => x.id === 'mPROMOLT');
        if (!m) throw new Error('élément promotion absent du film');
        if (m.promoType !== 'ptLTTEST') throw new Error('promoType non persisté sur le module');
        if (!m.promo || m.promo.name !== 'Test LT' || m.promo.icon !== '🧪' || m.promo.color !== '#123456') {
          throw new Error(`badge de promotion non résolu : ${JSON.stringify(m.promo)}`);
        }
        return `« ${m.name} » · badge ${m.promo.icon} ${m.promo.name} (${m.promo.color})`;
      } finally {
        // restauration : brouillon + sous-types d'origine
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        await call('PUT', '/api/v1/promo-types', { promoTypes: before.promoTypes });
      }
    });
    await step('Campagne — entité listée + contenu résolu dans le film', async () => {
      const before = await call('GET', '/api/v1/campaigns');
      const cat = await call('GET', '/api/v1/catalog');
      const prod = (cat.products || [])[0];
      const st = await call('GET', '/api/v1/state');
      // 1) Ajouter une campagne « produit » (aller-retour PUT /campaigns)
      const extra = { id: 'cmpLTTEST', name: 'Campagne LT', scope: 'produit', productRef: prod ? prod.id : '', theme: '', image: '', message: 'Offre du moment', dateFrom: '01/01', dateTo: '31/01', color: '#0A7E3D', active: true };
      const saved = await call('PUT', '/api/v1/campaigns', { campaigns: [...before.campaigns, extra] });
      try {
        const got = (saved.campaigns || []).find((c) => c.id === 'cmpLTTEST');
        if (!got || got.name !== 'Campagne LT' || got.color !== '#0A7E3D' || got.message !== 'Offre du moment') throw new Error('campagne non persistée');
        // 2) Élément « campagne » qui pointe vers cette campagne
        const campMod = { id: 'mCAMPLT', type: 'campagne', name: 'Campagne', campaignRef: 'cmpLTTEST', layout: 'cover', dur: 8, items: [] };
        await call('PUT', '/api/v1/draft', {
          modules: [...st.modules, campMod],
          playlists: [...st.playlists, { id: 'pl-campLT', name: 'Film campagne LT', items: ['mCAMPLT'] }],
          activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
        });
        // 3) Le film résout le contenu de la campagne sur le module (+ produit lié)
        const f = await (await fetch(BASE + '/api/v1/film?film=pl-campLT')).json();
        const m = (f.modules || []).find((x) => x.id === 'mCAMPLT');
        if (!m) throw new Error('élément campagne absent du film');
        if (m.campaignRef !== 'cmpLTTEST') throw new Error('campaignRef non persisté sur le module');
        if (!m.campaign || m.campaign.name !== 'Campagne LT' || m.campaign.message !== 'Offre du moment') {
          throw new Error(`campagne non résolue : ${JSON.stringify(m.campaign)}`);
        }
        // portée produit → la photo/le prix viennent du produit lié (items[0])
        if (prod && (!m.items || !m.items[0] || m.items[0].productId !== prod.id)) throw new Error('produit lié de la campagne non résolu en item');
        return `« ${m.campaign.name} » (${m.campaign.scope}) · ${m.items && m.items[0] ? m.items[0].name : 'sans produit'}`;
      } finally {
        // restauration : brouillon + campagnes d'origine
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
        await call('PUT', '/api/v1/campaigns', { campaigns: before.campaigns });
      }
    });
    await step('Gabarit HTML — code collé + variables résolues par magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const st = await call('GET', '/api/v1/state');
      const coord0 = { address: store.address || '' };
      // Document complet (doctype + head/style + body) avec variables et un
      // <script> qui doit être retiré à l'affichage.
      const code = `<!DOCTYPE html><html><head><style>.k{color:#8D1D2C}</style></head>`
        + `<body><div class="k">{{magasin}} — {{adresse}}</div><script>alert(1)</script></body></html>`;
      const htmlMod = { id: 'mHTMLLT', type: 'html', name: 'Gabarit LT', html: code, htmlW: 1080, htmlH: 1920, layout: 'fit', dur: 9, items: [] };
      await call('POST', `/api/v1/stores/${store.id}`, { address: 'HTMLADDR-LT' });
      await call('PUT', '/api/v1/draft', {
        modules: [...st.modules, htmlMod],
        playlists: [...st.playlists, { id: 'pl-htmlLT', name: 'Film gabarit LT', items: ['mHTMLLT'] }],
        activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop,
      });
      const f = await (await fetch(BASE + `/api/v1/film?film=pl-htmlLT&store=${encodeURIComponent(store.id)}`)).json();
      // restauration AVANT les assertions
      await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      await call('POST', `/api/v1/stores/${store.id}`, coord0);
      const m = (f.modules || []).find((x) => x.id === 'mHTMLLT');
      if (!m) throw new Error('gabarit HTML absent du film');
      if (m.htmlW !== 1080 || m.htmlH !== 1920) throw new Error(`format source perdu : ${m.htmlW}×${m.htmlH}`);
      if (!m.html || !m.html.includes('.k{color:#8D1D2C}')) throw new Error('le code collé (style) n\'est pas conservé');
      if (m.html.includes('{{magasin}}')) throw new Error('{{magasin}} non résolu dans le HTML');
      if (!m.html.includes(store.store)) throw new Error('nom du magasin non injecté dans le HTML');
      if (!m.html.includes('HTMLADDR-LT')) throw new Error('{{adresse}} non résolue dans le HTML');
      return `${m.htmlW}×${m.htmlH} · « ${store.store} » + adresse injectés`;
    });
    await step('Règle photo/illustration — produit = photo, catégorie = illustration', async () => {
      const before = await call('GET', '/api/v1/catalog');
      if (!before.categories.length) return 'aucune catégorie au catalogue';
      const cats = JSON.parse(JSON.stringify(before.categories));
      cats[0].img = 'assets/sweet-tart-big.png';       // illustration de la catégorie
      await call('PUT', '/api/v1/catalog', { categories: cats, products: before.products });
      try {
        const mid = await call('GET', '/api/v1/catalog');
        const c0 = mid.categories.find((c) => c.id === cats[0].id);
        if (!c0 || c0.img !== 'assets/sweet-tart-big.png') throw new Error('illustration de catégorie non persistée');
        // un produit garde SA photo, distincte de l'illustration de sa catégorie
        const p0 = mid.products.find((p) => p.categoryId === c0.id);
        if (p0 && !p0.img) throw new Error('photo du produit perdue');
        return `catégorie « ${c0.name} » → illustration · produit → photo (${p0 ? p0.img : 'aucun produit'})`;
      } finally {
        await call('PUT', '/api/v1/catalog', { categories: before.categories, products: before.products });
      }
    });
    await step('Période sur une CATÉGORIE — retire tous ses produits hors créneau', async () => {
      const before = await call('GET', '/api/v1/product-moments');
      const cat = await call('GET', '/api/v1/catalog');
      const c0 = (cat.categories || [])[0];
      if (!c0) return 'aucune catégorie au catalogue';
      const now = before.current || 'matin';
      const other = ['matin', 'midi', 'aprem'].find((m) => m !== now);
      try {
        // La catégorie n'est vendue QU'À un autre moment que maintenant.
        await call('PUT', '/api/v1/product-moments', { rows: [{ productId: c0.id, moment: other, exception: false, kind: 'categorie' }] });
        const f = await (await fetch(BASE + '/api/v1/film?film=' + encodeURIComponent((await call('GET', '/api/v1/state')).activePlaylistId))).json();
        const pids = (f.modules || []).flatMap((m) => (m.items || []).map((it) => it.productId)).filter(Boolean);
        const catOf = new Map(cat.products.map((p) => [p.id, p.categoryId]));
        if (pids.some((pid) => catOf.get(pid) === c0.id)) throw new Error(`des produits de « ${c0.name} » passent hors créneau de leur catégorie`);
        return `catégorie « ${c0.name} » vendue à ${other} → aucun de ses produits à ${now}`;
      } finally {
        await call('PUT', '/api/v1/product-moments', { rows: before.rows });
      }
    });
    await step('Parcours de la bibliothèque — case actif + ratio de passage', async () => {
      const st = await call('GET', '/api/v1/state');
      // Un élément de bibliothèque en paysage sert de cobaye.
      const mm = (st.modules || []).find((m) => m.orient !== 'portrait' && m.type !== 'html');
      if (!mm) return 'aucun élément de bibliothèque en paysage';
      const film = (id, itemRatios) => ({
        id, name: 'Parcours LT', items: [], mode: 'continu',
        continuous: { source: 'tout', perMoment: false, order: 'catalogue', maxItems: 12, orient: 'paysage',
          ratios: { liaison: 0, produitSeul: 0, media: 0, animation: 0, surprise: 0 }, itemRatios },
      });
      const put = (pls) => call('PUT', '/api/v1/draft', { modules: st.modules, playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const slots = async (id) => {
        const f = await (await fetch(BASE + '/api/v1/film?film=' + id)).json();
        return (f.modules || []).filter((x) => String(x.id).startsWith('k-item-')).length;
      };
      try {
        // 1) coché → il passe. 2) décoché mais ratio gardé → il ne passe plus.
        await put([...st.playlists, film('pl-loopOnLT', [{ id: mm.id, on: true, n: 2 }])]);
        const on = await slots('pl-loopOnLT');
        await put([...st.playlists, film('pl-loopOffLT', [{ id: mm.id, on: false, n: 2 }])]);
        const off = await slots('pl-loopOffLT');
        // 3) compat : l'ancien format { id, n } vaut « actif ».
        await put([...st.playlists, film('pl-loopOldLT', [{ id: mm.id, n: 2 }])]);
        const old = await slots('pl-loopOldLT');
        if (!on) throw new Error('élément coché absent de la boucle');
        if (off) throw new Error(`élément décoché présent ${off} fois dans la boucle`);
        if (!old) throw new Error('ancien format { id, n } non reconnu comme actif');
        return `« ${mm.name || mm.id} » : coché ${on} passage(s), décoché 0, ancien format ${old}`;
      } finally {
        await put(st.playlists);
      }
    });
    await step('POST heartbeat — auto-enregistrement d\'un player de test', async () => {
      const hb = await call('POST', `/api/v1/players/${pid}/heartbeat`, {
        token, name: 'Écran de test live', state: 'playing', cachePct: 91, media: 'test', playedVer: 0, dataVer: 0,
        detail: { assets: { total: 11, cached: 10, missing: 1 }, storage: { persisted: true, usage: 5, quota: 9 }, sw: true, secure: true, intrus: 'x'.repeat(5000) },
      });
      if (!hb.ok) throw new Error('heartbeat refusé');
      const me = (await call('GET', '/api/v1/fleet')).stores.flatMap((s) => s.players).find((x) => x.id === pid);
      const d = me && me.detail;
      if (!d || d.assets.cached !== 10 || d.assets.missing !== 1 || !d.storage.persisted || !d.sw) throw new Error(`détail du cache non remonté : ${JSON.stringify(d)}`);
      if ('intrus' in d) throw new Error('champ inattendu enregistré');
      return `assignée v${hb.assignedVer} · supervision : ${d.assets.cached}/${d.assets.total} fichiers, ${d.assets.missing} absent`;
    });
    await step('POST /api/v1/stores/<id> — combo d\'écrans du magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const before = store.format;
      const out = await call('POST', `/api/v1/stores/${store.id}`, { screens: 3, size: 55, orient: 'portrait' });
      if (!out.ok || out.format.w !== 3 * 2160 || out.format.h !== 3840) {
        throw new Error(`combo 3×55″ portrait → ${out.format && out.format.px} (attendu 6480 × 3840 px)`);
      }
      const film = await (await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`)).json();
      if (!film.format || film.format.w !== 6480) throw new Error('le lien magasin ne reflète pas le combo');
      // Coordonnées du magasin (alimentent les jetons {{adresse}}/{{horaires}}/{{tel}}).
      const coord0 = { address: store.address || '', hours: store.hours || '', phone: store.phone || '' };
      await call('POST', `/api/v1/stores/${store.id}`, { address: 'TESTADDR-live', hours: '7h-19h', phone: '010 00 00 00' });
      const fl2 = await call('GET', '/api/v1/fleet');
      const s2 = fl2.stores.find((s) => s.id === store.id);
      if (!s2 || s2.address !== 'TESTADDR-live' || s2.hours !== '7h-19h' || s2.phone !== '010 00 00 00') throw new Error('coordonnées du magasin non persistées');
      // restauration de la configuration d'origine (écrans + coordonnées)
      await call('POST', `/api/v1/stores/${store.id}`, { screens: before.screens, size: before.size, orient: before.orient, ...coord0 });
      return `${store.store} : ${out.format.label} = ${out.format.px} + coordonnées OK, restauré ${before.label}`;
    });
    await step('PUT /api/v1/catalog — produit + prix par magasin', async () => {
      const before = await call('GET', '/api/v1/catalog');
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const cats = before.categories.length ? before.categories : [{ id: 'pcT', name: 'Catégorie test', active: true }];
      const catId = cats[0].id;
      const testProd = {
        id: 'prLIVETEST', categoryId: catId, name: 'Produit test live', price: '9,99',
        img: 'assets/cake.png', src: 'illus', active: true, unavailable: true, prices: { [store.id]: '7,77' },
        aliases: { nl: 'Levend testproduct' },
      };
      await call('PUT', '/api/v1/catalog', { categories: cats, products: [...before.products, testProd] });
      const mid = await call('GET', '/api/v1/catalog');
      const found = mid.products.find((p) => p.id === 'prLIVETEST');
      if (!found) throw new Error('produit test absent après enregistrement');
      if (found.prices[store.id] !== '7,77') throw new Error('prix par magasin perdu');
      if ((found.aliases || {}).nl !== 'Levend testproduct') throw new Error('alias de langue perdu (sig_aliases)');
      if (found.unavailable !== true) throw new Error('état « rupture » (unavailable) non persisté');
      // restauration
      await call('PUT', '/api/v1/catalog', { categories: before.categories.length ? before.categories : [], products: before.products });
      const after = await call('GET', '/api/v1/catalog');
      if (after.products.some((p) => p.id === 'prLIVETEST')) throw new Error('produit test non supprimé');
      return `aller-retour OK · prix ${store.store} 7,77 + alias nl → restauré (${after.products.length} produits)`;
    });
    await step('POST /api/v1/mirror — miroir MySQL (best-effort)', async () => {
      const out = await call('POST', '/api/v1/mirror');
      if (out.ok) {
        if (!(out.tables > 0)) throw new Error('miroir sans table');
        return `${out.tables} tables · ${out.rows} lignes → base « ${out.db} »`;
      }
      // MySQL indisponible / pas de base cible : le miroir est best-effort.
      return `non répliqué (${out.error}) — best-effort, la régie fonctionne`;
    });
    await step('POST /api/v1/plan — planning hebdo (semaine × jour × moments)', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const stateNow = await call('GET', '/api/v1/state');
      const film = (stateNow.playlists || [])[0];
      if (!film) throw new Error('aucun film en base');
      const film2 = (stateNow.playlists || [])[1] || film;
      const before = await call('GET', '/api/v1/plan');
      if (!Array.isArray(before.weeks) || before.weeks.length !== 5) throw new Error('semaines A–E absentes');
      const day = (new Date().getDay() + 6) % 7; // 0 = lundi (comme le serveur)
      // Semaine A, jour courant, matin couvrant toute la journée + 2 films enchaînés.
      const out = await call('POST', '/api/v1/plan', {
        stores: [store.id], week: 'A', day, slots: { matin: [film.id, film2.id] },
        windows: [{ id: 'matin', from: '00:00', to: '23:59' }, { id: 'midi', from: '11:00', to: '15:00' }, { id: 'aprem', from: '15:00', to: '20:00' }],
      });
      const saved = (((out.byStore[store.id] || {}).A || {})[day] || {}).matin;
      if (!out.ok || !Array.isArray(saved) || saved[0] !== film.id) throw new Error(`plan non enregistré : ${JSON.stringify(saved)}`);
      await call('POST', '/api/v1/plan/active', { week: 'A' }); // semaine A diffusée
      const f = await (await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`)).json();
      if (!f.plan || !f.plan.moment) throw new Error('moment du plan absent du film servi');
      const multi = film2.id !== film.id;
      if (multi && f.plan.films !== 2) throw new Error(`films enchaînés attendus : 2, reçu ${f.plan.films}`);
      // nettoyage : on vide ce jour
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'A', day, slots: {}, windows: before.windows });
      return `${store.store} : ${multi ? '2 films enchaînés' : '« ' + film.name + ' »'} · sem. ${f.plan.week} jour ${f.plan.day} au ${f.plan.moment}`;
    });
    await step('POST /api/v1/plan/duplicate — copie d\'une semaine', async () => {
      const store = (await call('GET', '/api/v1/fleet')).stores[0];
      const film = (await call('GET', '/api/v1/state')).playlists[0];
      const day = (new Date().getDay() + 6) % 7;
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'B', day, slots: { midi: [film.id] } });
      const out = await call('POST', '/api/v1/plan/duplicate', { stores: [store.id], from: 'B', to: 'C' });
      const cell = (((out.byStore[store.id] || {}).C || {})[day] || {}).midi || [];
      if (cell[0] !== film.id) throw new Error(`duplication B→C ratée : ${JSON.stringify(cell)}`);
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'B', day, slots: {} });
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'C', day, slots: {} });
      return `semaine B copiée vers C (jour ${day})`;
    });
    await step('POST /api/v1/plan — plafond de 5 films par moment', async () => {
      const MAX = 5;
      const store = (await call('GET', '/api/v1/fleet')).stores[0];
      const snap = await call('GET', '/api/v1/state'); // brouillon complet, restauré à la fin
      const modIds = (snap.modules || []).map((m) => m.id);
      if (!store || !modIds.length) throw new Error('pré-requis manquants (magasin / modules)');
      const day = (new Date().getDay() + 6) % 7;
      // 6 films éphémères (chacun = 1 module) pour dépasser volontairement la limite
      const films6 = Array.from({ length: MAX + 1 }, (_, i) => ({ id: `plcap${i + 1}`, name: `Cap ${i + 1}`, items: [modIds[0]] }));
      await call('PUT', '/api/v1/draft', {
        modules: snap.modules, playlists: films6, activePlaylistId: 'plcap1',
        secPerLine: snap.secPerLine, loop: snap.loop,
      });
      const out = await call('POST', '/api/v1/plan', { stores: [store.id], week: 'E', day, slots: { midi: films6.map((f) => f.id) } });
      const saved = (((out.byStore[store.id] || {}).E || {})[day] || {}).midi || [];
      if (saved.length !== MAX) throw new Error(`plafond attendu ${MAX}, obtenu ${saved.length}`);
      // nettoyage : efface la cellule, puis restaure le brouillon d'origine
      await call('POST', '/api/v1/plan', { stores: [store.id], week: 'E', day, slots: {} });
      await call('PUT', '/api/v1/draft', {
        modules: snap.modules, playlists: snap.playlists,
        activePlaylistId: snap.activePlaylistId, secPerLine: snap.secPerLine, loop: snap.loop,
      });
      return `${MAX + 1} films soumis → ${saved.length} conservés (plafond ${MAX})`;
    });
    await step('POST /api/v1/stores/<id> — langue du magasin', async () => {
      const fleetRes = await call('GET', '/api/v1/fleet');
      const store = fleetRes.stores[0];
      if (!store) throw new Error('aucun magasin en base');
      const before = store.lang || 'fr';
      const out = await call('POST', `/api/v1/stores/${store.id}`, { lang: 'nl' });
      if (out.lang !== 'nl') throw new Error(`langue non enregistrée : ${out.lang}`);
      const film = await fetch(BASE + `/api/v1/film?store=${encodeURIComponent(store.id)}`);
      if (!film.ok) throw new Error(`film?store en ${film.status} avec langue nl`);
      await call('POST', `/api/v1/stores/${store.id}`, { lang: before });
      return `${store.store} : fr → nl → restauré ${before}`;
    });
    const basePlaylists = (state.playlists && state.playlists.length)
      ? state.playlists
      : [{ id: 'pl1', name: 'Film principal', items: state.playlist }];
    const activeId = state.activePlaylistId || basePlaylists[0].id;
    await step('PUT /api/v1/draft — aller-retour du brouillon (films multiples)', async () => {
      await call('PUT', '/api/v1/draft', {
        modules: state.modules,
        playlists: [...basePlaylists, { id: 'pltest', name: 'Film de test', items: state.playlist, cat: 'promo', tags: ['noel', 'vitrine'] }],
        activePlaylistId: activeId,
        secPerLine: state.secPerLine, loop: state.loop,
      });
      const mid = await call('GET', '/api/v1/state');
      if (mid.modules.length !== state.modules.length) throw new Error('perte de modules après enregistrement');
      const pt = mid.playlists.find((p) => p.id === 'pltest');
      if (!pt) throw new Error('film de test perdu à l\'aller-retour');
      if (pt.cat !== 'promo') throw new Error(`catégorie du film perdue : ${pt.cat}`);
      if (!Array.isArray(pt.tags) || pt.tags.join(',') !== 'noel,vitrine') throw new Error(`tags du film perdus : ${JSON.stringify(pt.tags)}`);
      const namesBefore = JSON.stringify(state.modules.map((m) => [m.id, m.name, (m.items || []).length]));
      const namesAfter = JSON.stringify(mid.modules.map((m) => [m.id, m.name, (m.items || []).length]));
      if (namesBefore !== namesAfter) throw new Error('brouillon modifié par l\'aller-retour');
      // nettoyage : on retire le film de test
      await call('PUT', '/api/v1/draft', {
        modules: state.modules, playlists: basePlaylists, activePlaylistId: activeId,
        secPerLine: state.secPerLine, loop: state.loop,
      });
      const after = await call('GET', '/api/v1/state');
      if (after.playlists.some((p) => p.id === 'pltest')) throw new Error('film de test non supprimé');
      return `${after.playlists.length} film(s) · actif : ${after.activePlaylistId}`;
    });
    let pub = null;
    await step('POST /api/v1/publish — film actif + tests auto', async () => {
      pub = await call('POST', '/api/v1/publish', { mode: 'full', playlistId: activeId, targets: [], slot: 'Toute la journée', when: 'now' });
      const ok = pub.tests.filter((t) => t.ok).length;
      if (!pub.ok) throw new Error(`tests post-déploiement : ${ok}/${pub.tests.length} OK`);
      if (!pub.film || !pub.film.name) throw new Error('nom du film absent de la publication');
      return `« ${pub.film.name} » v${pub.version} · tests ${ok}/${pub.tests.length} OK`;
    });
    await step('GET assignment — le player reçoit la nouvelle version', async () => {
      const a = await call('GET', `/api/v1/players/${pid}/assignment?token=${token}`);
      if (a.assignedVer !== pub.version) throw new Error(`assignée v${a.assignedVer}, attendu v${pub.version}`);
      if (!a.snapshot || a.snapshot.version !== pub.version) throw new Error('snapshot manquant ou mauvaise version');
      return `snapshot v${a.snapshot.version} · ${a.snapshot.modules.length} modules`;
    });
    await step('POST /api/v1/publish — snapshot prix (sync légère) + tests auto', async () => {
      const p2 = await call('POST', '/api/v1/publish', { mode: 'data', targets: [] });
      const ok = p2.tests.filter((t) => t.ok).length;
      if (!p2.ok) throw new Error(`tests post-déploiement : ${ok}/${p2.tests.length} OK`);
      return `d${p2.version} · tests ${ok}/${p2.tests.length} OK`;
    });
    await step('GET /api/v1/datasets/latest — dataset de prix servi', async () => {
      const d = await call('GET', `/api/v1/datasets/latest?token=${token}`);
      if (!Array.isArray(d.prices) || !d.prices.length) throw new Error('dataset vide');
      return `d${d.dataVer} · ${d.prices.length} modules tarifés`;
    });
    await step('Heartbeat de confirmation — le player remonte la version jouée', async () => {
      const hb = await call('POST', `/api/v1/players/${pid}/heartbeat`, {
        token, state: 'playing', cachePct: 100, media: 'Tartes · Brookie', playedVer: pub.version, dataVer: 0,
      });
      if (!hb.ok) throw new Error('heartbeat refusé');
      const f = await call('GET', '/api/v1/fleet');
      const me = f.stores.flatMap((s) => s.players).find((p) => p.id === pid);
      if (!me) throw new Error('player absent du réseau');
      if (me.playedVer !== pub.version) throw new Error(`réseau : v${me.playedVer} ≠ v${pub.version}`);
      return `réseau à jour : ${me.state} · v${me.playedVer}`;
    });
    await step('GET /api/v1/publications — historique + tests archivés', async () => {
      const p = await call('GET', '/api/v1/publications');
      if (!p.publications.length) throw new Error('aucune publication archivée');
      if (!p.publications[0].tests.length) throw new Error('tests non archivés');
      return `${p.publications.length} publication(s)`;
    });
  }

  // --- compte magasin : portée décidée par le serveur ------------------------
  if (MUTATE) {
    await step('Compte magasin — portée limitée à SON magasin, ruptures sur SES écrans', async () => {
      const fleet = await call('GET', '/api/v1/fleet');
      const store = fleet.stores.find((x) => x.id !== 'st-new' && x.players.length) || fleet.stores.find((x) => x.id !== 'st-new');
      const other = fleet.stores.find((x) => x.id !== store.id && x.id !== 'st-new');
      if (!store) throw new Error('aucun magasin');
      const acc = await call('POST', `/api/v1/stores/${store.id}/account`, { username: 'livetest-magasin' });
      if (!acc.ok || !acc.password) throw new Error('compte non créé');
      try {
        const login = await (await fetch(BASE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: acc.username, password: acc.password }) })).json();
        if (login.role !== 'magasin' || login.storeId !== store.id) throw new Error(`rôle ${login.role} / magasin ${login.storeId}`);
        const H = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
        const as = (method, path, body) => fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
        // tout ce qui n'est pas SON espace : refusé
        for (const [m, path] of [['GET', '/api/v1/state'], ['GET', '/api/v1/fleet'], ['PUT', '/api/v1/draft'], ['POST', '/api/v1/publish'], ['GET', '/api/v1/media'], ['GET', '/api/v1/pwa-config'], ['POST', `/api/v1/stores/${other ? other.id : store.id}`], ['POST', `/api/v1/stores/${store.id}/account`]]) {
          const r = await as(m, path, m === 'GET' ? undefined : {});
          if (r.status !== 403) throw new Error(`${m} ${path} → HTTP ${r.status} au lieu de 403`);
        }
        const mine = await (await as('GET', '/api/v1/my-store')).json();
        if (!mine.store || mine.store.id !== store.id) throw new Error('/my-store ne renvoie pas son magasin');
        const prod = mine.products[0];
        if (!prod) return `${acc.username} · aucun produit à déclarer (catalogue vide)`;
        const set = await (await as('POST', '/api/v1/my-store/unavailable', { productId: prod.id, unavailable: true })).json();
        if (!set.ok || !set.storeStamp.includes(prod.id)) throw new Error('rupture non enregistrée');
        const film = await call('GET', `/api/v1/film?store=${store.id}`);
        if (!String(film.storeStamp || '').includes(prod.id)) throw new Error('le film du magasin ignore la rupture');
        if (film.modules.some((m) => (m.items || []).some((it) => it.productId === prod.id) || m.productRef === prod.id)) throw new Error('produit épuisé encore à l\'écran du magasin');
        if (other) {
          const f2 = await call('GET', `/api/v1/film?store=${other.id}`);
          if (String(f2.storeStamp || '').includes(prod.id)) throw new Error('la rupture déborde sur un autre magasin');
        }
        await as('POST', '/api/v1/my-store/unavailable', { productId: prod.id, unavailable: false });
        // nouveau mot de passe : l'ancienne session tombe
        await call('POST', `/api/v1/stores/${store.id}/account`, {});
        if ((await as('GET', '/api/v1/my-store')).status !== 401) throw new Error('session conservée après réinitialisation');
        return `${acc.username} → ${store.store} · 8 accès refusés · « ${prod.name} » retiré de SES écrans puis rétabli`;
      } finally {
        await call('DELETE', `/api/v1/stores/${store.id}/account`);
      }
    });
  }

  // --- mode production (serveur jetable uniquement) --------------------------
  // Le serveur jetable tourne en démo (SIG_DEMO=1), où « agence/agence » reste
  // ouvert pour la commodité. On rejoue ici ce que vit la production : sans
  // SIG_AGENCY_PASSWORD, pas de compte agence ; avec, seul ce mot de passe
  // ouvre ; le secret retiré, le compte et ses sessions tombent.
  if (LOCAL) {
    await step('Production — compte agence : fermé sans secret, jamais « agence »', async () => {
      const db = join(mkdtempSync(join(tmpdir(), 'sig-prod-')), 'prod.db');
      const ADMIN_PW = 'admin-prod-test';
      const AGENCY_PW = 'Secret agence « test » 2026';
      const login = async (base, username, password) => {
        const res = await fetch(base + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
        return { status: res.status, token: (await res.json().catch(() => ({}))).token };
      };
      const agencyEnabled = async (base) => {
        const a = await login(base, 'admin', ADMIN_PW);
        if (!a.token) throw new Error(`admin refusé en mode production (HTTP ${a.status})`);
        return (await (await fetch(base + '/api/v1/state', { headers: { authorization: `Bearer ${a.token}` } })).json()).agencyEnabled;
      };
      let port = 9000 + Math.floor(Math.random() * 500);
      // Serveur de production : ni SIG_DEMO, ni mot de passe hérité de l'environnement.
      const prod = async (agencyPw) => {
        const env = { ...process.env, PORT: String(++port), SIG_DB: db, SIG_ADMIN_PASSWORD: ADMIN_PW };
        delete env.SIG_DEMO; delete env.SIG_AGENCY_PASSWORD;
        if (agencyPw) env.SIG_AGENCY_PASSWORD = agencyPw;
        const proc = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js')], { env, stdio: 'ignore' });
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 60; i++) {
          if (await fetch(base + '/api/v1/health').then((r) => r.ok, () => false)) break;
          await new Promise((r) => setTimeout(r, 150));
        }
        return { base, stop: () => new Promise((r) => { proc.once('exit', r); proc.kill(); }) };
      };

      let srv = await prod('');
      try {
        if ((await login(srv.base, 'agence', 'agence')).status !== 401) throw new Error('serveur neuf sans secret : « agence/agence » accepté');
        if (await agencyEnabled(srv.base) !== false) throw new Error('serveur neuf sans secret : agencyEnabled devrait être false');
      } finally { await srv.stop(); }

      srv = await prod(AGENCY_PW);
      let token;
      try {
        if ((await login(srv.base, 'agence', 'agence')).status !== 401) throw new Error('secret posé : le défaut « agence » est encore accepté');
        const ag = await login(srv.base, 'agence', AGENCY_PW);
        if (!ag.token) throw new Error(`secret posé : le mot de passe agence est refusé (HTTP ${ag.status})`);
        token = ag.token;
        if (await agencyEnabled(srv.base) !== true) throw new Error('secret posé : agencyEnabled devrait être true');
      } finally { await srv.stop(); }

      srv = await prod('');
      try {
        if ((await login(srv.base, 'agence', AGENCY_PW)).status !== 401) throw new Error('secret retiré : l’ancien mot de passe agence ouvre encore');
        const old = await fetch(srv.base + '/api/v1/media', { headers: { authorization: `Bearer ${token}` } });
        if (old.status !== 401) throw new Error(`secret retiré : la session agence survit (HTTP ${old.status})`);
        if (await agencyEnabled(srv.base) !== false) throw new Error('secret retiré : agencyEnabled devrait être false');
      } finally { await srv.stop(); }
      return 'sans secret : fermé · secret posé : lui seul ouvre · secret retiré : compte et session tombent';
    });
  }

  if (MUTATE && tfbMock) {
    await step('Bundles TFBuddy — synchro : pagination, détail, magasins, produits', async () => {
      // Les produits TFBuddy 901 et 902 = « pwp901 », « pwp902 » (ids de l'import PWA).
      const cat = await call('GET', '/api/v1/catalog');
      const cid = cat.categories[0].id;
      cat.products = cat.products.filter((p) => !/^pwp90[12]$/.test(p.id));
      cat.products.push({ id: 'pwp901', categoryId: cid, name: 'Croissant LT', price: '1,40', img: 'assets/cookies.png', src: 'illus', active: true, prices: { st2: '1,50' }, aliases: {} });
      cat.products.push({ id: 'pwp902', categoryId: cid, name: 'Café LT', price: '2,60', img: 'assets/cherry.png', src: 'illus', active: true, prices: {}, aliases: {} });
      await call('PUT', '/api/v1/catalog', cat);
      const r = await call('POST', '/api/v1/bundles/sync');
      const s = r.sync;
      if (!r.ok || !s.ok) throw new Error(`synchro en échec : ${s.error}`);
      if (s.count !== 3 || s.active !== 2) throw new Error(`3 bundles dont 2 actifs attendus, reçu ${s.count}/${s.active}`);
      if (!tfbMock.calls.some((c) => c.includes('/admin/promotions/bundles?page=2'))) throw new Error('page 2 de la liste non lue');
      if (!tfbMock.calls.some((c) => c.endsWith('/admin/promotions/bundles/32'))) throw new Error('détail d’un bundle non lu');
      const b31 = r.bundles.find((b) => b.id === 'tfb31');
      const b32 = r.bundles.find((b) => b.id === 'tfb32');
      if (!b31 || b31.items.map((i) => i.productId).join() !== 'pwp901,pwp902') throw new Error('produits du bundle non reliés au catalogue');
      if (b31.schedule.length !== 5 || b31.schedule[0].dow !== 1 || b31.schedule[0].from !== '06:00' || b31.schedule[0].to !== '11:00') throw new Error(`créneaux mal relus : ${JSON.stringify(b31.schedule[0])}`);
      if (!b32 || b32.price !== 6.9 || b32.scope !== 'selected' || JSON.stringify(b32.storeIds) !== '["st2"]') throw new Error(`bundle magasin mal relu : ${JSON.stringify(b32)}`);
      if (JSON.stringify(s.unmappedShops) !== '["77"]' || JSON.stringify(s.unknownProducts) !== '["903"]') throw new Error(`signalements inattendus : ${JSON.stringify(s)}`);
      if (!r.stores.some((x) => x.id === 'st2' && x.name)) throw new Error('noms des magasins absents');
      // Le visuel choisi en régie survit à la synchro suivante.
      await call('PATCH', '/api/v1/bundles/tfb31', { img: 'assets/cookies.png' });
      const again = await call('POST', '/api/v1/bundles/sync');
      if (again.bundles.find((b) => b.id === 'tfb31').img !== 'assets/cookies.png') throw new Error('visuel perdu à la resynchro');
      return `${s.count} bundles (${s.active} actifs) · 2 pages + détails · magasin TFBuddy 4 → st2 · signalés : magasin 77, produit 903`;
    });
    await step('Bundles TFBuddy — à l’écran : son magasin, ses prix, tombé si épuisé', async () => {
      const st = await call('GET', '/api/v1/state');
      const sched = { days: [1, 1, 1, 1, 1, 1, 1], from: '00:00', to: '23:59' };
      const extra = [['lt_b31', 'tfb31'], ['lt_b32', 'tfb32'], ['lt_b33', 'tfb33']].map(([id, ref]) => (
        { id, type: 'bundle', name: id, bundleRef: ref, layout: 'composition', schedule: sched, items: [], tag: {}, pos: {} }));
      const pls = st.playlists.map((p) => (p.id === st.activePlaylistId ? { ...p, items: [...extra.map((m) => m.id), ...p.items] } : p));
      await call('PUT', '/api/v1/draft', { modules: [...st.modules, ...extra], playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      let acc = null;
      try {
        const back = await call('GET', '/api/v1/state');
        if ((back.modules.find((m) => m.id === 'lt_b32') || {}).bundleRef !== 'tfb32') throw new Error('bundleRef non enregistré');
        await call('POST', '/api/v1/publish', { mode: 'full', targets: [] });
        const bundlesOf = async (store) => (await call('GET', `/api/v1/film?store=${store}`)).modules.filter((m) => m.type === 'bundle');
        const gare = await bundlesOf('st2');
        const nord = await bundlesOf('st3');
        if (gare.map((m) => m.id).sort().join() !== 'lt_b31,lt_b32') throw new Error(`Gare : ${gare.map((m) => m.id).join() || 'aucun'} (inactif exclu, bundle du magasin inclus)`);
        if (nord.map((m) => m.id).join() !== 'lt_b31') throw new Error(`Nord : ${nord.map((m) => m.id).join() || 'aucun'} (bundle d’un autre magasin exclu)`);
        const g31 = gare.find((m) => m.id === 'lt_b31');
        if (g31.items[0].price !== '1,50' || nord[0].items[0].price !== '1,40') throw new Error('prix du magasin non appliqués aux produits du bundle');
        if (g31.bundle.price !== 3.5 || g31.bundle.slots.length !== 5 || g31.bundle.img !== 'assets/cookies.png') throw new Error('bundle mal résolu pour l’écran');
        const snap = await call('GET', '/api/v1/film?store=st2');
        if (!snap.media.includes('assets/cookies.png')) throw new Error('visuels du bundle absents du cache des écrans');
        if (!String(snap.storeStamp || '').includes('|b:')) throw new Error('l’empreinte du magasin ignore les bundles');
        // Rupture déclarée par la Gare sur le croissant : ses deux bundles tombent, chez elle seulement.
        acc = await call('POST', '/api/v1/stores/st2/account', { username: 'livetest-bundles' });
        const login = await (await fetch(BASE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: acc.username, password: acc.password }) })).json();
        const H = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
        const out = async (on) => fetch(BASE + '/api/v1/my-store/unavailable', { method: 'POST', headers: H, body: JSON.stringify({ productId: 'pwp901', unavailable: on }) });
        await out(true);
        if ((await bundlesOf('st2')).length) throw new Error('croissant épuisé à la Gare : ses bundles passent encore');
        if ((await bundlesOf('st3')).length !== 1) throw new Error('la rupture de la Gare a touché le Nord');
        await out(false);
        if ((await bundlesOf('st2')).length !== 2) throw new Error('bundles non rétablis après la rupture');
        // Le compte magasin n'atteint pas les bundles de la régie.
        if ((await fetch(BASE + '/api/v1/bundles', { headers: H })).status !== 403) throw new Error('compte magasin : /bundles non refusé');
        return 'Gare : 2 bundles (prix Gare) · Nord : 1 · inactif exclu · épuisé → retirés puis rétablis · cache + empreinte';
      } finally {
        if (acc) await call('DELETE', '/api/v1/stores/st2/account').catch(() => {});
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Promotions TFBuddy — synchro : X achetés = Y offert, quantité, remises, bons', async () => {
      const r = await call('POST', '/api/v1/bundles/sync');
      const k = r.sync.kinds || {};
      for (const [kind, n] of [['bundle', 3], ['buy_x_get_y', 2], ['quantity', 1], ['scheduled_discount', 2], ['voucher', 2]]) {
        if (!k[kind] || !k[kind].ok || k[kind].count !== n) throw new Error(`${kind} : ${JSON.stringify(k[kind])}`);
      }
      if (!tfbMock.calls.some((c) => c.endsWith('/admin/promotions/buy-x-get-y/41'))) throw new Error('détail d’une promotion non lu');
      if (tfbMock.calls.some((c) => /voucher-campaigns\/\d+/.test(c))) throw new Error('les bons ne demandent pas de détail');
      const by = new Map(r.promos.map((p) => [p.id, p]));
      const [bx, qt, sd, sd2, vc] = ['bx41', 'qt51', 'sd61', 'sd62', 'vc71'].map((id) => by.get(id));
      if (!bx || bx.mech.buy !== 2 || bx.mech.get !== 1 || bx.mech.rewardType !== 'FREE' || bx.products[0].productId !== 'pwp901') throw new Error(`X + Y mal relue : ${JSON.stringify(bx)}`);
      if (tfbPromoLabel(bx, 'fr') !== '2 achetés = 1 offert' || tfbPromoLabel(bx, 'nl') !== '2 gekocht = 1 gratis') throw new Error(`libellé X + Y : ${tfbPromoLabel(bx, 'fr')}`);
      if (!qt || qt.scope !== 'selected' || JSON.stringify(qt.storeIds) !== '["st2"]' || tfbPromoLabel(qt, 'fr') !== '3 pour le prix de 2') throw new Error(`quantité mal relue : ${JSON.stringify(qt)}`);
      if (!(k.quantity.unknownProducts || []).includes('903')) throw new Error('produit 903 (absent du catalogue) non signalé');
      if (!sd || sd.schedule.length !== 5 || sd.schedule[0].from !== '14:00' || tfbPromoLabel(sd, 'fr') !== '-20 %') throw new Error(`remise mal relue : ${JSON.stringify(sd)}`);
      if (!sd2 || sd2.status !== 'INACTIVE' || sd2.categories[0].extCategoryId !== '5') throw new Error('remise par catégorie mal relue');
      if (!vc || vc.mech.code !== 'RENTREE10' || vc.mech.promotionId !== '41' || tfbPromoLabel(vc, 'fr') !== 'Code « RENTREE10 » en caisse') throw new Error(`bon mal relu : ${JSON.stringify(vc)}`);
      // Le visuel choisi en régie survit à la synchro suivante.
      await call('PATCH', '/api/v1/tfb-promos/sd61', { img: 'media/happy-hour.jpg' });
      const again = await call('POST', '/api/v1/bundles/sync');
      if (again.promos.find((p) => p.id === 'sd61').img !== 'media/happy-hour.jpg') throw new Error('visuel perdu à la resynchro');
      return `X + Y 2 · quantité 1 · remises 2 · bons 2 · « ${tfbPromoLabel(bx, 'fr')} » · « ${tfbPromoLabel(qt, 'fr')} » · « ${tfbPromoLabel(sd, 'fr')} » · « ${tfbPromoLabel(vc, 'fr')} »`;
    });
    await step('Promotions TFBuddy — à l’écran : magasin, créneaux, prix remisé, rupture', async () => {
      const st = await call('GET', '/api/v1/state');
      const sched = { days: [1, 1, 1, 1, 1, 1, 1], from: '00:00', to: '23:59' };
      const mk = (id, ref, productRef) => ({ id, type: 'promotion', name: id, tfbRef: ref, promoType: 'bxgy', productRef, layout: 'hero-right', schedule: sched, items: [], tag: {}, pos: {} });
      const extra = [mk('lt_bx41', 'bx41', 'pwp901'), mk('lt_qt51', 'qt51', ''), mk('lt_sd61', 'sd61', 'pwp902'), mk('lt_sd62', 'sd62', ''), mk('lt_vc71', 'vc71', '')];
      const pls = st.playlists.map((p) => (p.id === st.activePlaylistId ? { ...p, items: [...extra.map((m) => m.id), ...p.items] } : p));
      await call('PUT', '/api/v1/draft', { modules: [...st.modules, ...extra], playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      let acc = null;
      try {
        const back = await call('GET', '/api/v1/state');
        if ((back.modules.find((m) => m.id === 'lt_bx41') || {}).tfbRef !== 'bx41') throw new Error('tfbRef non enregistré');
        await call('POST', '/api/v1/publish', { mode: 'full', targets: [] });
        const promosOf = async (store) => (await call('GET', `/api/v1/film?store=${store}`)).modules.filter((m) => m.tfb);
        const ids = (l) => l.map((m) => m.id).sort().join();
        const gare = await promosOf('st2');
        const nord = await promosOf('st3');
        if (ids(gare) !== 'lt_bx41,lt_qt51,lt_sd61,lt_vc71') throw new Error(`Gare : ${ids(gare) || 'aucune'} (inactive exclue, promotion du magasin incluse)`);
        if (ids(nord) !== 'lt_bx41,lt_sd61,lt_vc71') throw new Error(`Nord : ${ids(nord) || 'aucune'} (promotion d’un autre magasin exclue)`);
        const sd = gare.find((m) => m.id === 'lt_sd61');
        if (tfbDiscountedPrice(sd.tfb, sd.items[0].price) !== 2.08) throw new Error(`prix remisé : ${sd.items[0].price} → ${tfbDiscountedPrice(sd.tfb, sd.items[0].price)} au lieu de 2,08`);
        const at = (d, hh) => new Date(2026, 9, d, hh, 0);   // octobre 2026 : le 12 est un lundi
        if (!scheduledNow(sd, at(12, 15)) || scheduledNow(sd, at(12, 17)) || scheduledNow(sd, at(17, 15))) throw new Error('créneaux de la remise non respectés à l’écran');
        const bx = gare.find((m) => m.id === 'lt_bx41');
        if (bx.items[0].price !== '1,50' || bx.tfb.kind !== 'buy_x_get_y') throw new Error('produit de la promotion sans le prix du magasin');
        const snap = await call('GET', '/api/v1/film?store=st2');
        if (!snap.media.includes('media/happy-hour.jpg')) throw new Error('visuel de la promotion absent du cache des écrans');
        if (!String(snap.storeStamp || '').includes('|p:')) throw new Error('l’empreinte du magasin ignore les promotions');
        // Croissant épuisé à la Gare : « 2 + 1 » tombe chez elle seulement.
        acc = await call('POST', '/api/v1/stores/st2/account', { username: 'livetest-promos' });
        const login = await (await fetch(BASE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: acc.username, password: acc.password }) })).json();
        const H = { authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
        const out = async (on) => fetch(BASE + '/api/v1/my-store/unavailable', { method: 'POST', headers: H, body: JSON.stringify({ productId: 'pwp901', unavailable: on }) });
        await out(true);
        if ((await promosOf('st2')).some((m) => m.id === 'lt_bx41')) throw new Error('croissant épuisé à la Gare : « 2 + 1 » passe encore');
        if (!(await promosOf('st3')).some((m) => m.id === 'lt_bx41')) throw new Error('la rupture de la Gare a touché le Nord');
        await out(false);
        if (!(await promosOf('st2')).some((m) => m.id === 'lt_bx41')) throw new Error('promotion non rétablie après la rupture');
        return `Gare : 4 promotions · Nord : 3 · inactive exclue · remise 2,60 → 2,08 de 14 h à 16 h en semaine · épuisé → retirée puis rétablie`;
      } finally {
        if (acc) await call('DELETE', '/api/v1/stores/st2/account').catch(() => {});
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Style des badges — chaque famille TFBuddy habille ses promotions à l’écran', async () => {
      const st = await call('GET', '/api/v1/state');
      const types = new Map((await call('GET', '/api/v1/promo-types')).promoTypes.map((t) => [t.id, t]));
      const before = (await call('GET', '/api/v1/bundles')).badges;
      const want = { bundle: '', buy_x_get_y: 'bxgy', quantity: 'bxgy', happy_hour: 'happy-hour', scheduled_discount: 'scheduled', voucher: 'voucher' };
      if (JSON.stringify(before) !== JSON.stringify(want)) throw new Error(`styles par défaut : ${JSON.stringify(before)}`);
      const sched = { days: [1, 1, 1, 1, 1, 1, 1], from: '00:00', to: '23:59' };
      // lt_bg41 porte exprès un autre sous-type (« bon d'achat ») : reliée, la famille l'emporte.
      const extra = [
        { id: 'lt_bg41', type: 'promotion', name: 'lt_bg41', tfbRef: 'bx41', promoType: 'voucher', productRef: 'pwp901', layout: 'hero-right', schedule: sched, items: [], tag: {}, pos: {} },
        { id: 'lt_bg61', type: 'promotion', name: 'lt_bg61', tfbRef: 'sd61', promoType: 'bxgy', productRef: 'pwp902', layout: 'hero-right', schedule: sched, items: [], tag: {}, pos: {} },
        { id: 'lt_bg31', type: 'bundle', name: 'lt_bg31', bundleRef: 'tfb31', layout: 'composition', schedule: sched, items: [], tag: {}, pos: {} },
      ];
      const pls = st.playlists.map((p) => (p.id === st.activePlaylistId ? { ...p, items: [...extra.map((m) => m.id), ...p.items] } : p));
      await call('PUT', '/api/v1/draft', { modules: [...st.modules, ...extra], playlists: pls, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      const put = (badges) => fetch(BASE + '/api/v1/tfb-badges', { method: 'PUT', headers: { ...(authToken ? { authorization: `Bearer ${authToken}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ badges }) });
      try {
        await call('POST', '/api/v1/publish', { mode: 'full', targets: [] });
        const film = async () => {
          const f = await call('GET', '/api/v1/film?store=st2');
          return { stamp: f.storeStamp, by: new Map(f.modules.map((m) => [m.id, m])) };
        };
        const f0 = await film();
        const b0 = f0.by.get('lt_bg41').promo;
        if (!b0 || b0.type !== 'bxgy' || b0.color !== types.get('bxgy').color) throw new Error(`X + Y : badge ${JSON.stringify(b0)} au lieu du style « bxgy » de sa famille`);
        if ((f0.by.get('lt_bg61').promo || {}).type !== 'happy-hour') throw new Error(`remise sur créneaux : ${JSON.stringify(f0.by.get('lt_bg61').promo)}`);
        if (f0.by.get('lt_bg31').promo) throw new Error('bundle sans style choisi : la puce maison ne doit pas changer');
        // La régie habille les bundles et change le style d'une famille : l'écran suit, sans republier.
        let r = await put({ bundle: 'bundle', buy_x_get_y: 'flash' });
        if (r.status !== 200) throw new Error(`enregistrement refusé : ${r.status}`);
        const f1 = await film();
        const b1 = f1.by.get('lt_bg31').promo;
        if (!b1 || b1.type !== 'bundle' || b1.icon !== types.get('bundle').icon || b1.color !== types.get('bundle').color) throw new Error(`bundle : ${JSON.stringify(b1)}`);
        if ((f1.by.get('lt_bg41').promo || {}).type !== 'flash') throw new Error('nouveau style de la famille X + Y absent à l’écran');
        if (!String(f1.stamp || '').includes('|g:') || f1.stamp === f0.stamp) throw new Error('l’empreinte du magasin ignore le style des badges : les écrans ne rechargeraient pas');
        // Famille sans style : l'élément reprend son propre sous-type.
        await put({ buy_x_get_y: '' });
        if (((await film()).by.get('lt_bg41').promo || {}).type !== 'voucher') throw new Error('sans style de famille, le sous-type de l’élément ne revient pas');
        // Refus : famille ou sous-type inconnus.
        if ((r = await put({ nope: 'bxgy' })).status !== 400) throw new Error(`famille inconnue acceptée (${r.status})`);
        if ((r = await put({ voucher: 'inexistant' })).status !== 400) throw new Error(`sous-type inconnu accepté (${r.status})`);
        return 'X + Y → « bxgy » malgré le sous-type de l’élément · créneaux → « happy-hour » · bundle maison puis « bundle » · changement sans republier (empreinte |g:) · repli · refus 400';
      } finally {
        await put(want);
        await call('PUT', '/api/v1/draft', { modules: st.modules, playlists: st.playlists, activePlaylistId: st.activePlaylistId, secPerLine: st.secPerLine, loop: st.loop });
      }
    });
    await step('Catalogue TFBuddy — produits, catégories, prix par magasin ; la régie garde les siens', async () => {
      const before = await call('GET', '/api/v1/catalog');
      const cat = JSON.parse(JSON.stringify(before));
      // Ce qui appartient à la régie : visuel et nom traduit du croissant, un
      // produit saisi à la main, une référence que TFBuddy ne liste plus.
      const cr = cat.products.find((p) => p.id === 'pwp901');
      if (!cr) throw new Error('pwp901 absent (posé par le test des bundles)');
      Object.assign(cr, { img: 'assets/cookies.png', src: 'photo', aliases: { nl: 'Croissant NL' } });
      cat.products.push({ id: 'pwp999', categoryId: cat.categories[0].id, name: 'Retiré LT', price: '3,00', img: 'assets/cake.png', src: 'illus', active: true, prices: {}, aliases: {} });
      await call('PUT', '/api/v1/catalog', cat);
      const local = cat.products.filter((p) => !/^pwp?\d+$/.test(p.id)).map((p) => p.id).sort().join();
      try {
        const r = await call('POST', '/api/v1/catalog-import', { source: 'tfbuddy' });
        if (!r.ok || r.source !== 'tfbuddy') throw new Error(`import en échec : ${r.error}`);
        if (r.categories !== 2 || r.products !== 5 || r.sold !== 3) throw new Error(`comptes : ${JSON.stringify(r)}`);
        if (JSON.stringify(r.unmappedShops) !== '["77"]' || r.storePrices !== 2 || r.retired !== 1 || r.noPrice !== 2) throw new Error(`signalements : ${JSON.stringify(r)}`);
        for (const path of ['/product/categories', '/shops/4/products/available', '/shops/77/products/available', '/product-categories/5/products']) {
          if (!tfbMock.calls.some((c) => c.startsWith(`GET /api/v1${path}`))) throw new Error(`${path} non lu`);
        }
        const c = await call('GET', '/api/v1/catalog');
        const by = new Map(c.products.map((p) => [p.id, p]));
        const p901 = by.get('pwp901');
        if (p901.name !== 'Croissant' || p901.categoryId !== 'pw5') throw new Error(`croissant : ${JSON.stringify(p901)}`);
        if (p901.price !== '1,40' || JSON.stringify(p901.prices) !== '{"st2":"1,50"}') throw new Error(`prix du croissant : base ${p901.price} (le plus bas des plus pratiqués), magasins ${JSON.stringify(p901.prices)}`);
        if (p901.img !== 'assets/cookies.png' || p901.src !== 'photo' || p901.aliases.nl !== 'Croissant NL') throw new Error('visuel ou nom traduit de la régie perdu');
        const p904 = by.get('pwp904');
        if (!p904 || p904.categoryId !== 'pw5' || p904.price !== '1,60' || !p904.active || Object.keys(p904.prices).length) throw new Error(`pain au chocolat (catégorie portée par la ligne, magasin non relié) : ${JSON.stringify(p904)}`);
        if (!by.get('pwp905') || by.get('pwp905').active) throw new Error('référence sans prix connu : doit rester inactive (jamais 0,00 € à l’écran)');
        if (!by.get('pwp906') || by.get('pwp906').active) throw new Error('référence désactivée dans TFBuddy restée active');
        if (!by.get('pwp999') || by.get('pwp999').active) throw new Error('référence que TFBuddy ne liste plus : gardée mais inactive attendue');
        if (c.products.filter((p) => !/^pwp?\d+$/.test(p.id)).map((p) => p.id).sort().join() !== local) throw new Error('produits saisis en régie touchés');
        if (!c.categories.some((x) => x.id === 'pw6' && x.name === 'Boissons')) throw new Error('catégorie Boissons absente');
        // API muette : la base PWA est essayée en secours ; si elle échoue aussi, rien ne bouge.
        tfbMock.catalogDown(true);
        const f = await call('POST', '/api/v1/catalog-import', { source: 'auto' });
        if (f.source !== 'pwa' || !/HTTP 500/.test(f.apiError || '')) throw new Error(`secours PWA non tenté : ${JSON.stringify(f)}`);
        const st = (await call('GET', '/api/v1/catalog-import')).status;
        if (!f.ok) {
          if (JSON.stringify(await call('GET', '/api/v1/catalog')) !== JSON.stringify(c)) throw new Error('catalogue modifié alors que les deux sources ont échoué');
          if (st.lastOkSource !== 'tfbuddy' || !st.lastOk || !st.apiError) throw new Error(`statut : ${JSON.stringify(st)}`);
        }
        return `2 catégories · 5 produits (3 vendus) · prix Gare + base la plus pratiquée · visuel et alias gardés · retirée → inactive · magasin 77 signalé · API muette → PWA ${f.ok ? 'utilisée' : `essayée (${String(f.error).slice(0, 40)}…), catalogue intact`}`;
      } finally {
        tfbMock.catalogDown(false);
        await call('PUT', '/api/v1/catalog', before);
      }
    });
    await step('Bundles TFBuddy — compte sans MENU.BUNDLE.MANAGE : erreur dite, bundles gardés', async () => {
      tfbMock.revoke(true);
      try {
        const r = await call('POST', '/api/v1/bundles/sync');
        if (r.ok || r.sync.ok) throw new Error('synchro réussie malgré le droit retiré');
        if (!/403/.test(r.sync.error) || !/MENU\.BUNDLE\.MANAGE/.test(r.sync.error)) throw new Error(`message peu clair : ${r.sync.error}`);
        if (r.bundles.length !== 3) throw new Error('les bundles déjà lus ont été effacés');
        if (r.promos.length !== 7) throw new Error('les promotions déjà lues ont été effacées');
        if (!r.sync.kinds || r.sync.kinds.buy_x_get_y.ok !== false || r.sync.kinds.voucher.ok !== false) throw new Error('refus des autres familles non signalé');
        return r.sync.error;
      } finally { tfbMock.revoke(false); }
    });
  }

  if (MUTATE && aiMock) {
    const texts = (f) => JSON.stringify(f.modules.map((m) => [m.name, m.sub, (m.items || []).map((i) => i.name)]));
    const filmOf = (store) => call('GET', `/api/v1/film?store=${encodeURIComponent(store)}`);
    const waitJob = async (t, lang) => {
      for (let i = 0; i < 150 && t.job && t.job.running; i++) {
        await new Promise((r) => setTimeout(r, 100));
        t = await call('GET', `/api/v1/translations?lang=${lang}`);
      }
      if (!t.job || t.job.running) throw new Error('proposition jamais terminée');
      return t;
    };
    const fleet = await call('GET', '/api/v1/fleet');
    const nlStore = fleet.stores[0];
    const frStore = fleet.stores.find((x) => x.id !== nlStore.id && (x.lang || 'fr') === 'fr');
    const langBefore = nlStore.lang || 'fr';
    const st0 = await call('GET', '/api/v1/state');
    let modKey = null;
    await step('Traductions — Claude propose, rien à l’écran avant validation', async () => {
      await call('POST', `/api/v1/stores/${nlStore.id}`, { lang: 'nl' });
      const t0 = await call('GET', '/api/v1/translations?lang=nl');
      if (!t0.claude.configured) throw new Error('Claude non configuré sur le serveur jetable');
      if (!t0.stores.some((x) => x.id === nlStore.id)) throw new Error('le magasin passé en néerlandais n’est pas listé');
      const todo = t0.counts.missing;
      const t = await waitJob(await call('POST', '/api/v1/translations/propose', { lang: 'nl' }), 'nl');
      if (t.job.errors.length) throw new Error(`proposition en erreur : ${t.job.errors[0]}`);
      if (t.counts.proposed !== todo || t.counts.missing !== 0) throw new Error(`${t.counts.proposed} proposition(s) pour ${todo} texte(s) à traduire`);
      const req = aiMock.calls[aiMock.calls.length - 1];
      if (req.model !== 'claude-haiku-5-5' || req.lang !== 'nl' || !/Flanders/.test(req.system)) throw new Error(`requête Claude inattendue : ${req.model} / ${req.lang}`);
      const f0 = await filmOf(nlStore.id);
      if (/\[nl\]/.test(texts(f0))) throw new Error('une proposition non validée est passée à l’écran');
      const inFilm = new Set(f0.modules.map((m) => m.id));
      const mod = t.items.find((x) => x.kind === 'module' && x.field === 'name' && inFilm.has(x.refId));
      if (!mod) throw new Error('aucun titre d’élément du film à traduire');
      modKey = mod.key;
      return `${todo} texte(s) → ${t.counts.proposed} proposition(s) · ${aiMock.calls.length} requête(s) · ${t.job.usage.input_tokens} jetons lus`;
    });
    await step('Traductions — validées (retouche comprise) : l’écran flamand change, pas le francophone', async () => {
      if (!modKey) throw new Error('étape précédente en échec');
      const f0 = await filmOf(nlStore.id);
      const v = await call('POST', '/api/v1/translations/validate', { lang: 'nl', edits: { [modKey]: 'Retouche régie' } });
      if (!v.validated || v.counts.proposed !== 0) throw new Error(`${v.validated} validée(s), ${v.counts.proposed} restante(s)`);
      if (v.items.find((x) => x.key === modKey).translation.origin !== 'regie') throw new Error('retouche non marquée « régie »');
      const f1 = await filmOf(nlStore.id);
      if (!/\[nl\]/.test(texts(f1)) || !texts(f1).includes('Retouche régie')) throw new Error(`écran flamand non traduit : ${texts(f1).slice(0, 160)}`);
      if (f1.storeStamp === f0.storeStamp || !String(f1.storeStamp).includes('|t:')) throw new Error('empreinte du magasin inchangée : ses écrans ne se resynchroniseraient pas');
      if (frStore && /\[nl\]|Retouche régie/.test(texts(await filmOf(frStore.id)))) throw new Error('un magasin francophone reçoit le néerlandais');
      return `${v.validated} validée(s) · empreinte ${f0.storeStamp || '∅'} → ${f1.storeStamp}`;
    });
    await step('Traductions — texte français modifié : à retraduire, l’écran garde la sienne jusqu’à la republication', async () => {
      if (!modKey) throw new Error('étape précédente en échec');
      const id = modKey.split(':')[1];
      const name0 = st0.modules.find((m) => m.id === id).name;
      const renamed = st0.modules.map((m) => (m.id === id ? { ...m, name: `${m.name} bis` } : m));
      await call('PUT', '/api/v1/draft', { modules: renamed, playlists: st0.playlists, activePlaylistId: st0.activePlaylistId, secPerLine: st0.secPerLine, loop: st0.loop });
      try {
        const it = (await call('GET', '/api/v1/translations?lang=nl')).items.find((x) => x.key === modKey);
        if (!it || !it.missing || !it.stale || !it.previous || it.previous.text !== 'Retouche régie') throw new Error(`texte modifié non signalé : ${JSON.stringify(it)}`);
        // Une nouvelle proposition ne retire pas la traduction du film publié.
        await waitJob(await call('POST', '/api/v1/translations/propose', { lang: 'nl' }), 'nl');
        if (!texts(await filmOf(nlStore.id)).includes('Retouche régie')) throw new Error('la traduction du film publié est tombée avant la republication');
        // Republier le nouveau texte, non validé : le français passe.
        await call('POST', '/api/v1/publish', { mode: 'full', targets: [] });
        const f = texts(await filmOf(nlStore.id));
        if (!f.includes(`${name0} bis`) || f.includes('Retouche régie')) throw new Error('le nouveau texte non validé devrait passer en français');
        // Validé : le néerlandais revient.
        await call('POST', '/api/v1/translations/validate', { lang: 'nl', keys: [modKey] });
        if (!texts(await filmOf(nlStore.id)).includes(`${name0} bis [nl]`)) throw new Error('nouvelle traduction validée absente de l’écran');
        return `« ${name0} » → « ${name0} bis » : à retraduire · film publié inchangé · republié en français · validé → néerlandais`;
      } finally {
        await call('PUT', '/api/v1/draft', { modules: st0.modules, playlists: st0.playlists, activePlaylistId: st0.activePlaylistId, secPerLine: st0.secPerLine, loop: st0.loop });
        await call('POST', '/api/v1/publish', { mode: 'full', targets: [] }).catch(() => {});
      }
    });
    await step('Traductions — saisie en régie, nom ERP prioritaire, accès réservé à la régie', async () => {
      const t = await call('GET', '/api/v1/translations?lang=nl');
      const prod = t.items.find((x) => x.kind === 'product');
      if (!prod) throw new Error('aucun produit dans la liste');
      const put = await call('PUT', '/api/v1/translations', { lang: 'nl', key: prod.key, text: 'Handmatig' });
      const p1 = put.items.find((x) => x.key === prod.key);
      if (!p1.translation || p1.translation.text !== 'Handmatig' || p1.translation.status !== 'valide' || p1.translation.origin !== 'regie') throw new Error('saisie en régie non validée d’office');
      // Nom donné par l'ERP dans la langue : il prime, rien à traduire.
      const cat = await call('GET', '/api/v1/catalog');
      const pid = prod.refId;
      const withAlias = { ...cat, products: cat.products.map((p) => (p.id === pid ? { ...p, aliases: { ...(p.aliases || {}), nl: 'Naam uit ERP' } } : p)) };
      await call('PUT', '/api/v1/catalog', withAlias);
      try {
        const p2 = (await call('GET', '/api/v1/translations?lang=nl')).items.find((x) => x.key === prod.key);
        if (!p2 || !p2.fromErp || p2.erpText !== 'Naam uit ERP' || p2.missing) throw new Error(`nom ERP non reconnu : ${JSON.stringify(p2)}`);
      } finally { await call('PUT', '/api/v1/catalog', cat); }
      if ((await fetch(BASE + '/api/v1/translations', { method: 'PUT', headers: { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ lang: 'nl', key: 'product:inconnu:name', text: 'x' }) })).status !== 404) throw new Error('texte inconnu : 404 attendu');
      // Un compte magasin n'atteint pas les traductions.
      const acc = await call('POST', `/api/v1/stores/${nlStore.id}/account`, { username: 'livetest-traductions' });
      try {
        const login = await (await fetch(BASE + '/api/v1/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: acc.username, password: acc.password }) })).json();
        const r = await fetch(BASE + '/api/v1/translations?lang=nl', { headers: { authorization: `Bearer ${login.token}` } });
        if (r.status !== 403) throw new Error(`compte magasin : HTTP ${r.status} au lieu de 403`);
      } finally { await call('DELETE', `/api/v1/stores/${nlStore.id}/account`).catch(() => {}); }
      return 'saisie validée d’office · nom ERP prioritaire · texte inconnu 404 · compte magasin 403';
    });
    await step('Traductions — clé API refusée : erreur dite, rien d’écrit', async () => {
      aiMock.revoke(true);
      try {
        const t = await waitJob(await call('POST', '/api/v1/translations/propose', { lang: 'de' }), 'de');
        if (!t.job.errors.length || !/ANTHROPIC_API_KEY/.test(t.job.errors[0])) throw new Error(`message peu clair : ${JSON.stringify(t.job.errors)}`);
        if (t.counts.proposed !== 0) throw new Error('des propositions ont été écrites malgré le refus');
        return t.job.errors[0];
      } finally {
        aiMock.revoke(false);
        await call('POST', `/api/v1/stores/${nlStore.id}`, { lang: langBefore }).catch(() => {});
      }
    });
  }

  const ok = results.filter((r) => r.ok).length;
  const ko = results.length - ok;
  console.log(`\n${ko === 0 ? '\x1b[32m' : '\x1b[31m'}${ok}/${results.length} tests OK${ko ? ` · ${ko} en échec` : ''}\x1b[0m\n`);
  if (child) child.kill();
  if (tfbMock) tfbMock.close();
  if (aiMock) aiMock.close();
  if (mkMock) mkMock.close();
  process.exit(ko === 0 ? 0 : 1);
}

// Module Marketing simulé : sa route de session répond `reply` et garde les
// cookies reçus (la régie doit transmettre ceux du navigateur, pas le sien).
function startMarketingMock() {
  return new Promise((resolve) => {
    const mock = { reply: { status: 200, body: { authenticated: false } }, lastCookie: '' };
    const srv = createServer((req, res) => {
      mock.lastCookie = String(req.headers.cookie || '');
      const { status, body } = mock.reply;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body == null ? 'erreur' : JSON.stringify(body));
    });
    srv.listen(0, '127.0.0.1', () => {
      mock.url = `http://127.0.0.1:${srv.address().port}/marketing/api/v1/marketing/session`;
      mock.close = () => srv.close();
      resolve(mock);
    });
  });
}

async function firstToken() {
  const f = await call('GET', '/api/v1/fleet');
  const p = f.stores.flatMap((s) => s.players)[0];
  return p ? p.token : null;
}

main().catch((e) => {
  console.error('\x1b[31mÉchec du runner :\x1b[0m', e.message || e);
  if (child) child.kill();
  process.exit(1);
});
