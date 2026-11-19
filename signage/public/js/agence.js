// Espace « Vidéo — Agence » — page isolée (accès agence dédié). Les agences
// uploadent des vidéos/photos taguées (moment · produit · saison) et vérifient
// leur présence sur le serveur. N'ouvre que la médiathèque, rien d'autre.
import { html, h, render, Component } from './vendor/preact-htm.js';

const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();
// Envoi d'un fichier tel quel (sans base64), avec sa progression (0 → 1).
function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', apiUrl(path));
    x.withCredentials = true;
    x.setRequestHeader('content-type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText || '{}'); } catch { /* corps non JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(j);
      else { const e = new Error(j.error || `HTTP ${x.status}`); e.status = x.status; reject(e); }
    };
    x.onerror = () => reject(new Error('envoi interrompu (réseau)'));
    x.send(file);
  });
}
async function api(method, path, body) {
  const r = await fetch(apiUrl(path), {
    method, credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const RUBY = '#8D1D2C';
const MOMENTS = [{ id: 'matin', label: 'Matin' }, { id: 'midi', label: 'Midi' }, { id: 'aprem', label: 'Après-midi' }, { id: 'all', label: 'Toute la journée' }];
const momentLabel = (id) => (MOMENTS.find((m) => m.id === id) || {}).label || id;
const fmtMo = (b) => `${Math.round((b || 0) / 1024 / 1024 * 10) / 10} Mo`;

class Agence extends Component {
  state = {
    ready: false, authRequired: false, loginPass: '', loginError: '', loggingIn: false,
    media: [], products: [], seasons: [], toast: '',
    form: { kind: 'film', moment: 'matin', productId: '', seasonId: '' }, busy: false, pct: 0, maxMb: 4096, storage: 'local',
  };

  async componentDidMount() {
    try {
      const me = await api('GET', '/me');
      if (me.role === 'agence' || me.role === 'admin') await this.loadAll();
      else this.setState({ authRequired: true, ready: true, loginError: 'Ce compte n’est pas un accès agence.' });
    } catch { this.setState({ authRequired: true, ready: true }); }
  }
  async loadAll() {
    const [media, cat, seas] = await Promise.all([
      api('GET', '/media').catch(() => ({ media: [] })),
      api('GET', '/catalog').catch(() => ({ products: [] })),
      api('GET', '/seasons').catch(() => ({ seasons: [] })),
    ]);
    this.setState({ ready: true, authRequired: false, media: media.media || [], products: cat.products || [], seasons: seas.seasons || [], maxMb: media.maxMb || 4096, storage: media.storage || 'local' });
  }
  toast(t) { clearTimeout(this._t); this.setState({ toast: t }); this._t = setTimeout(() => this.setState({ toast: '' }), 4500); }
  login = async (e) => {
    e.preventDefault();
    if (this.state.loggingIn) return;
    this.setState({ loggingIn: true, loginError: '' });
    try {
      await api('POST', '/login', { username: 'agence', password: this.state.loginPass });
      this.setState({ loginPass: '' });
      await this.loadAll();
    } catch (err) { this.setState({ loginError: err.status === 401 ? 'Mot de passe incorrect.' : String(err.message) }); }
    finally { this.setState({ loggingIn: false }); }
  };
  logout = async () => { try { await api('POST', '/logout'); } catch { /* ignore */ } this.setState({ authRequired: true }); };
  setForm(p) { this.setState({ form: { ...this.state.form, ...p } }); }

  onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > this.state.maxMb * 1048576) { this.toast(`${f.name} trop lourd (max ${this.state.maxMb} Mo).`); return; }
    this.setState({ busy: true, pct: 0 });
    try {
      const fm = this.state.form;
      const q = new URLSearchParams({ name: f.name, kind: fm.kind, moment: fm.moment, productId: fm.productId || '', seasonId: fm.seasonId || '' });
      const out = await uploadFile(`/media/upload?${q}`, f, (p) => this.setState({ pct: Math.round(p * 100) }));
      this.setState({ media: out.media || [], busy: false, pct: 0 });
      this.toast(`« ${out.filename || f.name} » ajouté ✓`);
    } catch (err) { this.setState({ busy: false, pct: 0 }); this.toast(`Erreur : ${err.message}`); }
  };
  del = async (id, name) => {
    if (!window.confirm(`Supprimer « ${name} » du serveur ?`)) return;
    try { const out = await api('DELETE', '/media/' + encodeURIComponent(id)); this.setState({ media: out.media || [] }); }
    catch (err) { this.toast(`Erreur : ${err.message}`); }
  };

  render(_, st) {
    if (!st.ready) return html`<div style="max-width:640px;margin:120px auto;text-align:center;color:var(--muted);font-family:'Gotham';">Chargement…</div>`;

    if (st.authRequired) {
      return html`
        <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:'Gotham';">
          <form onSubmit=${this.login} style="width:100%;max-width:380px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:30px 28px;box-shadow:0 20px 60px rgba(35,34,32,0.12);">
            <img src="assets/logo.png" alt="" style="height:46px;margin-bottom:16px;" />
            <h1 style="margin:0 0 4px;font-size:20px;font-weight:500;">Espace Vidéo — Agence</h1>
            <p style="margin:0 0 18px;font-size:12.5px;color:var(--muted);">Accès réservé aux agences : upload et vérification des vidéos/photos.</p>
            <input type="password" value=${st.loginPass} onInput=${(e) => this.setState({ loginPass: e.target.value })} placeholder="Mot de passe agence" autofocus
              style="width:100%;box-sizing:border-box;padding:9px 11px;font-size:13px;border:1px solid var(--line);border-radius:10px;background:var(--paper);margin-bottom:12px;" />
            ${st.loginError ? html`<div style="font-size:12.5px;color:${RUBY};margin-bottom:12px;">${st.loginError}</div>` : ''}
            <button type="submit" disabled=${st.loggingIn} style="width:100%;padding:12px;font-size:14px;font-weight:500;color:#fff;background:${RUBY};border:none;border-radius:10px;cursor:pointer;">${st.loggingIn ? 'Connexion…' : 'Se connecter'}</button>
          </form>
        </div>`;
    }

    const f = st.form;
    const prodName = (id) => (st.products.find((p) => p.id === id) || {}).name || '';
    const seasName = (id) => (st.seasons.find((s) => s.id === id) || {}).name || '';
    const tab = (on) => `padding:9px 16px;font-size:13px;font-weight:500;border:none;border-radius:8px;cursor:pointer;${on ? 'background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,0.1);' : 'background:transparent;color:var(--muted);'}`;
    const fieldLbl = 'font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;display:block;';
    const selCss = 'width:100%;box-sizing:border-box;padding:10px 12px;font-size:13.5px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;';

    return html`
      <div style="max-width:1000px;margin:0 auto;padding:24px 20px 70px;font-family:'Gotham';color:var(--ink);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px;">
          <div style="display:flex;align-items:center;gap:14px;">
            <img src="assets/logo.png" alt="" style="height:46px;" />
            <div>
              <div style="font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:var(--muted);">L'Atelier By</div>
              <div style="font-size:22px;font-weight:500;">Espace Vidéo — Agence</div>
            </div>
          </div>
          <button onClick=${this.logout} style="padding:9px 15px;font-size:12.5px;font-weight:500;color:${RUBY};background:#fff;border:1px solid rgba(141,29,44,0.3);border-radius:8px;cursor:pointer;">Se déconnecter</button>
        </div>

        <!-- Documentation -->
        <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;">
          <h3 style="margin:0 0 8px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Comment ça marche</h3>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:var(--muted-2);">
            <li><strong>Format vidéo :</strong> .mp4 ou .webm, codec H.264 (ou H.265/HEVC), 1080p ou 4K, sans son. <strong>Photo :</strong> .jpg / .png / .webp, idéalement 2000×2000 px.</li>
            <li><strong>Tags :</strong> choisis le <strong>moment</strong> (matin / midi / après-midi), le <strong>produit</strong> et la <strong>saison</strong>. Le système diffusera aléatoirement les médias tagués au bon moment et à la bonne période.</li>
            <li><strong>Nommage :</strong> à l'upload, un préfixe est ajouté automatiquement (<code>1_</code> matin, <code>2_</code> midi, <code>3_</code> après-midi).</li>
            <li><strong>Taille :</strong> jusqu'à ${st.maxMb} Mo par fichier (vidéos 4K comprises), envoyé tel quel ; la progression s'affiche pendant l'envoi.${st.storage === 's3' ? ' Les fichiers sont rangés sur le stockage OVHcloud.' : ''}</li>
          </ul>
        </div>

        <!-- Formulaire d'upload -->
        <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;">
          <h3 style="margin:0 0 14px;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Ajouter un média</h3>
          <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;">
            <div>
              <label style=${fieldLbl}>Type</label>
              <div style="display:inline-flex;background:var(--chip);border-radius:8px;padding:3px;">
                <button onClick=${() => this.setForm({ kind: 'film' })} style=${tab(f.kind === 'film')}>🎬 Vidéo</button>
                <button onClick=${() => this.setForm({ kind: 'photo' })} style=${tab(f.kind === 'photo')}>🖼 Photo</button>
              </div>
            </div>
            <div style="min-width:170px;">
              <label style=${fieldLbl}>Moment</label>
              <select value=${f.moment} onChange=${(e) => this.setForm({ moment: e.target.value })} style=${selCss}>
                ${MOMENTS.map((m) => html`<option value=${m.id}>${m.label}</option>`)}
              </select>
            </div>
            <div style="min-width:200px;flex:1 1 200px;">
              <label style=${fieldLbl}>Produit (optionnel)</label>
              <select value=${f.productId} onChange=${(e) => this.setForm({ productId: e.target.value })} style=${selCss}>
                <option value="">— aucun —</option>
                ${st.products.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
              </select>
            </div>
            <div style="min-width:180px;flex:1 1 180px;">
              <label style=${fieldLbl}>Saison (optionnel)</label>
              <select value=${f.seasonId} onChange=${(e) => this.setForm({ seasonId: e.target.value })} style=${selCss}>
                <option value="">— aucune —</option>
                ${st.seasons.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
              </select>
            </div>
          </div>
          <label style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px;padding:14px;font-size:14px;font-weight:500;color:${RUBY};border:1px dashed rgba(141,29,44,0.4);border-radius:12px;background:rgba(141,29,44,0.04);cursor:${st.busy ? 'wait' : 'pointer'};">
            <span style="font-size:18px;">⬆</span><span>${st.busy ? `Envoi en cours… ${st.pct} %` : `Choisir un fichier ${f.kind === 'photo' ? 'image' : 'vidéo'} à envoyer`}</span>
            <input type="file" accept=${f.kind === 'photo' ? 'image/*' : 'video/*'} onChange=${this.onFile} style="display:none;" />
          </label>
        </div>

        <!-- Médiathèque -->
        <div style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:15px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);">Médias sur le serveur (${st.media.length})</h3>
            <button onClick=${() => this.loadAll()} style="padding:7px 13px;font-size:12px;font-weight:500;color:var(--muted-2);background:rgba(92,88,82,0.1);border:1px solid rgba(92,88,82,0.3);border-radius:8px;cursor:pointer;">⟳ Vérifier</button>
          </div>
          ${st.media.length ? html`
            <div style="display:flex;flex-direction:column;gap:7px;">
              ${st.media.map((mm) => html`
                <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:var(--paper);border:1px solid var(--line);flex-wrap:wrap;">
                  <span style="font-size:16px;flex:0 0 auto;">${mm.kind === 'photo' ? '🖼' : '🎬'}</span>
                  <span style="flex:1 1 200px;min-width:0;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${mm.filename}</span>
                  <span style="font-size:10.5px;font-weight:500;color:${RUBY};background:rgba(141,29,44,0.08);border-radius:999px;padding:2px 9px;">${momentLabel(mm.moment)}</span>
                  ${prodName(mm.productId) ? html`<span style="font-size:11px;color:var(--muted-2);">🏷 ${prodName(mm.productId)}</span>` : ''}
                  ${seasName(mm.seasonId) ? html`<span style="font-size:11px;color:var(--muted-2);">📅 ${seasName(mm.seasonId)}</span>` : ''}
                  <span style="font-size:11px;color:var(--muted);">${fmtMo(mm.size)}</span>
                  <span title=${mm.present ? 'Présent sur le serveur' : 'Fichier manquant'} style="font-size:11.5px;font-weight:500;color:${mm.present ? '#2E6E4E' : RUBY};">${mm.present ? '✓ serveur' : '⚠ absent'}</span>
                  <button onClick=${() => this.del(mm.id, mm.filename)} title="Supprimer" style="flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:rgba(141,29,44,0.1);border:none;cursor:pointer;font-size:11px;color:${RUBY};">✕</button>
                </div>
              `)}
            </div>
          ` : html`<p style="margin:0;font-size:12.5px;color:var(--muted);">Aucun média pour l'instant. Ajoute une vidéo ou une photo ci-dessus.</p>`}
        </div>

        ${st.toast ? html`<div style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--ink);color:#fff;font-size:13px;padding:11px 18px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,0.25);z-index:50;">${st.toast}</div>` : ''}
      </div>`;
  }
}

render(h(Agence), document.getElementById('root'));
