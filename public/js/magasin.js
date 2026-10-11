// Espace magasin — une page par compte magasin, en français ou en
// néerlandais. Le magasin y voit SES écrans (état réel, cache), le lien
// d'écran du magasin, et y déclare ses ruptures du jour : le produit quitte
// SES écrans, pas ceux des autres magasins. La portée est décidée par le
// serveur (le magasin du compte), jamais par la page.
import { html, h, render, Component } from './vendor/preact-htm.js';

const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();
async function api(method, path, body) {
  const r = await fetch(apiUrl(path), {
    method, credentials: 'include', cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const RUBY = '#8D1D2C';
const REFRESH_MS = 15000;

// ---- FR / NL ---------------------------------------------------------------
const T = {
  title: { fr: 'Espace magasin', nl: 'Winkelruimte' },
  loginSub: { fr: 'Vos écrans et vos ruptures du jour.', nl: 'Uw schermen en de uitverkochte producten van vandaag.' },
  user: { fr: 'Identifiant', nl: 'Gebruikersnaam' },
  password: { fr: 'Mot de passe', nl: 'Wachtwoord' },
  signIn: { fr: 'Se connecter', nl: 'Aanmelden' },
  signingIn: { fr: 'Connexion…', nl: 'Aanmelden…' },
  badLogin: { fr: 'Identifiant ou mot de passe incorrect.', nl: 'Gebruikersnaam of wachtwoord onjuist.' },
  tooMany: { fr: 'Trop de tentatives — réessayez dans une minute.', nl: 'Te veel pogingen — probeer het over een minuut opnieuw.' },
  notStore: { fr: 'Ce compte n’est pas un compte magasin.', nl: 'Dit is geen winkelaccount.' },
  toConsole: { fr: 'Aller à la régie', nl: 'Naar de beheerconsole' },
  logout: { fr: 'Se déconnecter', nl: 'Afmelden' },
  loading: { fr: 'Chargement…', nl: 'Laden…' },
  screens: { fr: 'Vos écrans', nl: 'Uw schermen' },
  noScreens: { fr: 'Aucun écran enregistré pour l’instant. Pour brancher un écran, ouvrez le lien d’écran du magasin (ci-dessous) en plein écran sur sa box.', nl: 'Nog geen scherm geregistreerd. Open de schermlink van de winkel (hieronder) op volledig scherm op de box van het scherm.' },
  st_playing: { fr: 'En ligne', nl: 'Online' },
  st_offline: { fr: 'Hors ligne', nl: 'Offline' },
  st_syncing: { fr: 'Mise à jour…', nl: 'Bijwerken…' },
  st_error: { fr: 'Erreur', nl: 'Fout' },
  st_idle: { fr: 'En attente', nl: 'Wachtend' },
  upToDate: { fr: 'film à jour (v{v})', nl: 'film up-to-date (v{v})' },
  late: { fr: 'en retard : joue v{p}, v{a} attendue', nl: 'achter: speelt v{p}, v{a} verwacht' },
  files: { fr: '{c}/{t} fichiers sur l’écran', nl: '{c}/{t} bestanden op het scherm' },
  missing: { fr: '{n} absent(s) du serveur', nl: '{n} ontbreekt/ontbreken op de server' },
  bootOk: { fr: 'redémarre sans réseau ✓', nl: 'start op zonder netwerk ✓' },
  bootNo: { fr: 'ne redémarre pas sans réseau (http)', nl: 'start niet op zonder netwerk (http)' },
  seen: { fr: 'dernier contact {x}', nl: 'laatste contact {x}' },
  agoS: { fr: 'il y a {n} s', nl: '{n} s geleden' },
  agoM: { fr: 'il y a {n} min', nl: '{n} min geleden' },
  agoH: { fr: 'il y a {n} h', nl: '{n} u geleden' },
  agoD: { fr: 'il y a {n} j', nl: '{n} d geleden' },
  open: { fr: 'Ouvrir', nl: 'Openen' },
  copy: { fr: 'Copier le lien', nl: 'Link kopiëren' },
  copied: { fr: 'Lien copié ✓', nl: 'Link gekopieerd ✓' },
  storeLink: { fr: 'Lien d’écran du magasin', nl: 'Schermlink van de winkel' },
  storeLinkHelp: { fr: 'À ouvrir en plein écran sur la box d’un écran : il diffuse le film du magasin, avec vos prix et votre langue, et le garde sur l’écran pour les coupures réseau.', nl: 'Open op volledig scherm op de box van een scherm: het toont de film van de winkel, met uw prijzen en uw taal, en bewaart hem op het scherm voor netwerkonderbrekingen.' },
  watch: { fr: 'Voir ce que diffusent vos écrans ↗', nl: 'Bekijk wat uw schermen tonen ↗' },
  httpsBanner: { fr: 'Connexion sécurisée disponible : ouvrez cet espace — et vos écrans — à l’adresse https. Un écran ouvert en https redémarre même sans réseau.', nl: 'Beveiligde verbinding beschikbaar: open deze ruimte — en uw schermen — via het https-adres. Een scherm dat in https geopend is, start zelfs zonder netwerk op.' },
  httpsOpen: { fr: 'Ouvrir en https ↗', nl: 'Openen in https ↗' },
  ruptures: { fr: 'Ruptures du jour', nl: 'Uitverkocht vandaag' },
  rupturesHelp: { fr: 'Un produit épuisé disparaît de VOS écrans en moins d’une minute — pas de ceux des autres magasins. Il revient tout seul demain matin, ou dès que vous le remettez en vente.', nl: 'Een uitverkocht product verdwijnt binnen een minuut van UW schermen — niet van die van andere winkels. Het komt morgenochtend vanzelf terug, of zodra u het opnieuw in verkoop zet.' },
  keep: { fr: 'Garder aussi les jours suivants (jusqu’à remise en vente)', nl: 'Ook de volgende dagen behouden (tot opnieuw in verkoop)' },
  search: { fr: 'Chercher un produit…', nl: 'Product zoeken…' },
  markOut: { fr: 'Épuisé', nl: 'Uitverkocht' },
  backOn: { fr: 'Remettre en vente', nl: 'Opnieuw in verkoop' },
  tonight: { fr: 'jusqu’à ce soir', nl: 'tot vanavond' },
  manual: { fr: 'jusqu’à remise en vente', nl: 'tot opnieuw in verkoop' },
  nowOut: { fr: 'Actuellement épuisés ({n})', nl: 'Momenteel uitverkocht ({n})' },
  noneOut: { fr: 'Aucun produit épuisé.', nl: 'Geen uitverkochte producten.' },
  noProduct: { fr: 'Aucun produit trouvé.', nl: 'Geen producten gevonden.' },
  outToast: { fr: '« {p} » retiré de vos écrans', nl: '« {p} » van uw schermen gehaald' },
  backToast: { fr: '« {p} » de retour sur vos écrans', nl: '« {p} » terug op uw schermen' },
  error: { fr: 'Erreur : {e}', nl: 'Fout: {e}' },
};
const tr = (lang, k, vars) => {
  let s = (T[k] && (T[k][lang] || T[k].fr)) || k;
  if (vars) for (const v in vars) s = s.split(`{${v}}`).join(String(vars[v]));
  return s;
};
const savedLang = () => { try { return localStorage.getItem('sig_store_lang') || ''; } catch { return ''; } };
const browserLang = () => (/^nl\b/i.test(navigator.language || '') ? 'nl' : 'fr');

async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* repli */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

class Magasin extends Component {
  state = {
    ready: false, authRequired: false, wrongRole: false,
    lang: savedLang() || browserLang(),
    loginUser: '', loginPass: '', loginError: '', loggingIn: false,
    data: null, q: '', keep: false, busyId: '', toast: '',
  };

  async componentDidMount() {
    try {
      const me = await api('GET', '/me');
      if (me.role !== 'magasin') { this.setState({ ready: true, authRequired: true, wrongRole: true }); return; }
      await this.load();
    } catch { this.setState({ ready: true, authRequired: true }); }
    this._poll = setInterval(() => { if (!this.state.authRequired) this.load().catch(() => {}); }, REFRESH_MS);
  }
  componentWillUnmount() { clearInterval(this._poll); }

  t = (k, vars) => tr(this.state.lang, k, vars);
  setLang(lang) {
    try { localStorage.setItem('sig_store_lang', lang); } catch { /* préférence non mémorisée */ }
    document.documentElement.lang = lang;
    this.setState({ lang });
  }

  async load() {
    try {
      const data = await api('GET', '/my-store');
      // Première visite : la langue du magasin, tant qu'on n'en a pas choisi.
      const lang = savedLang() || (['fr', 'nl'].includes(data.store.lang) ? data.store.lang : this.state.lang);
      document.documentElement.lang = lang;
      this.setState({ ready: true, authRequired: false, wrongRole: false, data, lang });
    } catch (e) {
      if (e.status === 401 || e.status === 403) this.setState({ ready: true, authRequired: true, data: null });
      else throw e;
    }
  }
  toast(text) { clearTimeout(this._t); this.setState({ toast: text }); this._t = setTimeout(() => this.setState({ toast: '' }), 4200); }

  login = async (e) => {
    e.preventDefault();
    if (this.state.loggingIn) return;
    this.setState({ loggingIn: true, loginError: '' });
    try {
      const out = await api('POST', '/login', { username: this.state.loginUser.trim().toLowerCase(), password: this.state.loginPass });
      this.setState({ loginPass: '' });
      if (out.role !== 'magasin') { this.setState({ wrongRole: true, loginError: this.t('notStore') }); return; }
      await this.load();
    } catch (err) {
      this.setState({ loginError: err.status === 401 ? this.t('badLogin') : err.status === 429 ? this.t('tooMany') : String(err.message) });
    } finally { this.setState({ loggingIn: false }); }
  };
  logout = async () => { try { await api('POST', '/logout'); } catch { /* déjà déconnecté */ } this.setState({ authRequired: true, data: null }); };

  async setOut(p, out) {
    if (this.state.busyId) return;
    this.setState({ busyId: p.id });
    try {
      await api('POST', '/my-store/unavailable', { productId: p.id, unavailable: out, mode: this.state.keep ? 'manuel' : 'jour' });
      await this.load();
      this.toast(this.t(out ? 'outToast' : 'backToast', { p: p.name }));
    } catch (e) { this.toast(this.t('error', { e: e.message })); }
    finally { this.setState({ busyId: '' }); }
  }
  async copy(url) { if (await copyText(url)) this.toast(this.t('copied')); }

  ago(s) {
    if (s == null || s >= 999999) return '—';
    if (s < 60) return this.t('agoS', { n: s });
    if (s < 3600) return this.t('agoM', { n: Math.round(s / 60) });
    if (s < 86400) return this.t('agoH', { n: Math.round(s / 3600) });
    return this.t('agoD', { n: Math.round(s / 86400) });
  }

  langSwitch() {
    const b = (id) => `padding:6px 11px;font-size:12px;font-weight:700;border:none;border-radius:7px;cursor:pointer;${this.state.lang === id ? 'background:#fff;color:#232220;box-shadow:0 1px 3px rgba(0,0,0,0.1);' : 'background:transparent;color:#8A847C;'}`;
    return html`<div style="display:inline-flex;background:#EFE9E0;border-radius:9px;padding:3px;">
      <button onClick=${() => this.setLang('fr')} style=${b('fr')}>FR</button>
      <button onClick=${() => this.setLang('nl')} style=${b('nl')}>NL</button>
    </div>`;
  }

  render(_, st) {
    const t = this.t;
    if (!st.ready) return html`<div style="max-width:640px;margin:120px auto;text-align:center;color:#8A847C;font-family:'Gotham';">${t('loading')}</div>`;
    const card = 'background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:18px 20px;margin-bottom:16px;';
    const h3 = `margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${RUBY};`;
    const input = 'width:100%;box-sizing:border-box;padding:12px 14px;font-size:14px;border:1px solid rgba(35,34,32,0.18);border-radius:10px;background:#FBF8F2;';

    if (st.authRequired) {
      return html`
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Gotham';">
          <form onSubmit=${this.login} style="width:100%;max-width:380px;background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:18px;padding:30px 28px;box-shadow:0 20px 60px rgba(35,34,32,0.12);display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;"><img src="assets/logo.png" alt="" style="height:46px;" />${this.langSwitch()}</div>
            <h1 style="margin:4px 0 0;font-size:20px;font-weight:700;">${t('title')}</h1>
            <p style="margin:0 0 6px;font-size:12.5px;color:#8A847C;">${t('loginSub')}</p>
            <input value=${st.loginUser} onInput=${(e) => this.setState({ loginUser: e.target.value })} placeholder=${t('user')} autocomplete="username" autocapitalize="off" style=${input} />
            <input type="password" value=${st.loginPass} onInput=${(e) => this.setState({ loginPass: e.target.value })} placeholder=${t('password')} autocomplete="current-password" style=${input} />
            ${st.loginError ? html`<div style="font-size:12.5px;color:${RUBY};">${st.loginError}</div>` : ''}
            ${st.wrongRole ? html`<a href="./" style="font-size:12.5px;color:${RUBY};font-weight:600;">${t('toConsole')} →</a>` : ''}
            <button type="submit" disabled=${st.loggingIn} style="width:100%;padding:12px;font-size:14px;font-weight:600;color:#fff;background:${RUBY};border:none;border-radius:10px;cursor:pointer;">${st.loggingIn ? t('signingIn') : t('signIn')}</button>
          </form>
        </div>`;
    }

    const d = st.data;
    // Liens d'installation des écrans : en https dès que le serveur l'offre.
    const linkBase = d.https && d.https.ok ? d.https.base : location.href;
    const filmUrl = new URL(d.links.film, linkBase).toString();
    const q = st.q.trim().toLowerCase();
    const out = d.products.filter((p) => p.unavailable);
    const list = d.products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    const groups = [];
    for (const p of list) {
      let g = groups.find((x) => x.name === p.category);
      if (!g) { g = { name: p.category, items: [] }; groups.push(g); }
      g.items.push(p);
    }
    const stCol = { playing: '#2E7D32', syncing: '#B8860B', offline: RUBY, error: RUBY, idle: '#8A847C' };

    return html`
      <div style="max-width:1000px;margin:0 auto;padding:24px 20px 70px;font-family:'Gotham';color:#232220;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <img src="assets/logo.png" alt="" style="height:46px;" />
            <div>
              <div style="font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8A847C;">${t('title')}</div>
              <div style="font-size:22px;font-weight:700;">${d.store.name}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            ${this.langSwitch()}
            <button onClick=${this.logout} style="padding:9px 15px;font-size:12.5px;font-weight:600;color:${RUBY};background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:999px;cursor:pointer;">${t('logout')}</button>
          </div>
        </div>

        ${location.protocol === 'http:' && d.https && d.https.ok ? html`
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(46,110,78,0.08);border:1px solid rgba(46,110,78,0.3);border-radius:14px;padding:12px 16px;margin-bottom:16px;">
            <span style="flex:1 1 300px;font-size:12.5px;color:#1F5B2A;line-height:1.5;">🔒 ${t('httpsBanner')}</span>
            <a href=${new URL('magasin', d.https.base).toString()} style="font-size:12.5px;font-weight:700;color:#1F5B2A;">${t('httpsOpen')}</a>
          </div>` : ''}

        <!-- Écrans -->
        <div style=${card}>
          <h3 style=${h3}>${t('screens')} (${d.screens.length})</h3>
          ${d.screens.length ? html`<div style="display:flex;flex-direction:column;gap:8px;">
            ${d.screens.map((s) => {
              const a = (s.detail && s.detail.assets) || null;
              const late = s.assignedVer > s.playedVer;
              const notes = [late ? t('late', { p: s.playedVer, a: s.assignedVer }) : t('upToDate', { v: s.playedVer })];
              if (a) notes.push(t('files', { c: a.cached, t: a.total }));
              if (a && a.missing) notes.push(t('missing', { n: a.missing }));
              if (s.detail) notes.push(s.detail.sw ? t('bootOk') : t('bootNo'));
              notes.push(t('seen', { x: this.ago(s.syncAgo) }));
              const link = new URL(s.link, linkBase).toString();
              return html`<div style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;background:#FBF8F2;border:1px solid rgba(35,34,32,0.08);flex-wrap:wrap;">
                <span style="width:10px;height:10px;border-radius:50%;flex:0 0 auto;background:${stCol[s.state] || '#8A847C'};"></span>
                <div style="flex:1 1 260px;min-width:0;">
                  <div style="font-size:14px;font-weight:700;">${s.name} <span style="font-size:11.5px;font-weight:600;color:${stCol[s.state] || '#8A847C'};margin-left:6px;">${t('st_' + s.state) || s.state}</span></div>
                  <div style="font-size:12px;color:${(a && a.missing) || late ? RUBY : '#6E675E'};margin-top:3px;line-height:1.5;">${notes.join(' · ')}</div>
                </div>
                <a href=${link} target="_blank" style="font-size:12.5px;font-weight:600;color:${RUBY};">${t('open')} ↗</a>
                <button onClick=${() => this.copy(link)} style="padding:7px 12px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:${RUBY};cursor:pointer;">${t('copy')}</button>
              </div>`;
            })}
          </div>` : html`<p style="margin:0;font-size:13px;color:#6E675E;line-height:1.6;">${t('noScreens')}</p>`}
        </div>

        <!-- Lien d'écran du magasin -->
        <div style=${card}>
          <h3 style=${h3}>${t('storeLink')}</h3>
          <p style="margin:0 0 10px;font-size:12.5px;color:#6E675E;line-height:1.6;">${t('storeLinkHelp')}</p>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <input readonly value=${filmUrl} onClick=${(e) => e.target.select()} style="flex:1 1 280px;min-width:0;padding:9px 11px;font-size:12.5px;font-family:ui-monospace,monospace;border:1px solid rgba(35,34,32,0.12);border-radius:8px;background:#FBF8F2;" />
            <button onClick=${() => this.copy(filmUrl)} style="padding:9px 14px;font-size:12.5px;font-weight:600;border-radius:8px;border:1px solid rgba(141,29,44,0.25);background:rgba(141,29,44,0.06);color:${RUBY};cursor:pointer;">${t('copy')}</button>
            <a href=${filmUrl} target="_blank" style="font-size:12.5px;font-weight:600;color:${RUBY};">${t('watch')}</a>
          </div>
        </div>

        <!-- Ruptures -->
        <div style=${card}>
          <h3 style=${h3}>${t('ruptures')}</h3>
          <p style="margin:0 0 12px;font-size:12.5px;color:#6E675E;line-height:1.6;">${t('rupturesHelp')}</p>
          <div style="font-size:12px;font-weight:600;color:#4A4640;margin-bottom:8px;">${t('nowOut', { n: out.length })}</div>
          ${out.length ? html`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
            ${out.map((p) => html`<div style="display:inline-flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;border-radius:999px;background:rgba(141,29,44,0.08);border:1px solid rgba(141,29,44,0.25);">
              <span style="font-size:12.5px;font-weight:700;color:${RUBY};">${p.name}</span>
              <span style="font-size:11px;color:#8A847C;">${p.until ? t('tonight') : t('manual')}</span>
              <button disabled=${st.busyId === p.id} onClick=${() => this.setOut(p, false)} style="padding:5px 10px;font-size:11.5px;font-weight:700;border:none;border-radius:999px;background:#2E7D32;color:#fff;cursor:pointer;">${t('backOn')}</button>
            </div>`)}
          </div>` : html`<p style="margin:0 0 14px;font-size:12.5px;color:#8A847C;">${t('noneOut')}</p>`}
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
            <input value=${st.q} onInput=${(e) => this.setState({ q: e.target.value })} placeholder=${t('search')} style="flex:1 1 240px;min-width:0;padding:10px 12px;font-size:13.5px;border:1px solid rgba(35,34,32,0.16);border-radius:9px;background:#FBF8F2;" />
            <label style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#4A4640;cursor:pointer;">
              <input type="checkbox" checked=${st.keep} onChange=${(e) => this.setState({ keep: e.target.checked })} />${t('keep')}
            </label>
          </div>
          ${groups.length ? groups.map((g) => html`
            <div style="margin-top:10px;">
              <div style="font-size:10.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8A847C;margin-bottom:6px;">${g.name}</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px;">
                ${g.items.map((p) => html`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid ${p.unavailable ? 'rgba(141,29,44,0.3)' : 'rgba(35,34,32,0.08)'};background:${p.unavailable ? 'rgba(141,29,44,0.05)' : '#FBF8F2'};">
                  <span style="flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;line-height:1.3;overflow-wrap:anywhere;${p.unavailable ? `color:${RUBY};text-decoration:line-through;` : ''}">${p.name}</span>
                  <span style="flex:0 0 auto;font-size:11.5px;color:#8A847C;white-space:nowrap;">${p.price ? `${p.price} €` : ''}</span>
                  <button disabled=${st.busyId === p.id} onClick=${() => this.setOut(p, !p.unavailable)}
                    style="flex:0 0 auto;padding:6px 10px;font-size:11.5px;font-weight:700;border-radius:8px;cursor:pointer;${p.unavailable ? 'border:none;background:#2E7D32;color:#fff;' : `border:1px solid rgba(141,29,44,0.35);background:#fff;color:${RUBY};`}">${p.unavailable ? t('backOn') : t('markOut')}</button>
                </div>`)}
              </div>
            </div>`) : html`<p style="margin:8px 0 0;font-size:12.5px;color:#8A847C;">${t('noProduct')}</p>`}
        </div>

        ${st.toast ? html`<div style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#232220;color:#fff;font-size:13px;padding:11px 18px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,0.25);z-index:50;">${st.toast}</div>` : ''}
      </div>`;
  }
}

render(h(Magasin), document.getElementById('root'));
