// Rapport de diffusion — page publique (lecture seule), partageable par lien.
// Montre ce qui va être diffusé : bibliothèque de films (avec miniatures),
// planning par moment, et écrans. Réutilise le moteur de rendu des écrans
// (renderer.js) pour produire de vraies miniatures.
import { html, h, render, Component } from './vendor/preact-htm.js';
import { W, H, FUI, RUBY, INK, renderModule, moduleDur, playable, activeItems } from './renderer.js';

const apiUrl = (p) => new URL('api/v1' + p, location.href).toString();
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Catégories de films (mêmes couleurs que la régie).
const FILM_CATS = [
  { id: 'standard', label: 'Standard', color: '#8D1D2C' },
  { id: 'saison', label: 'Saison', color: '#C97B4A' },
  { id: 'promo', label: 'Promo', color: '#2E6E4E' },
  { id: 'evenement', label: 'Événement', color: '#6E4A2B' },
  { id: 'archive', label: 'Archive', color: '#8A847C' },
];
const filmCatOf = (p) => FILM_CATS.find((c) => c.id === (p && p.cat)) || FILM_CATS[0];

const fmtDur = (s) => {
  const t = Math.round(s || 0);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  } catch { return iso; }
};

// Miniature d'un élément : la scène 6480×3840 mise à l'échelle.
function thumb(m, secPerLine, wPx = 248) {
  const scale = wPx / W;
  const hPx = Math.round(H * scale);
  if (m.type === 'film') {
    // Vidéo : on n'embarque pas le flux dans le rapport → vignette repère.
    const label = m.surprise ? `Vidéo surprise · ${m.surpriseCount || (m.surpriseVideos || []).length} vidéo(s)` : 'Vidéo';
    return h('div', {
      style: {
        width: wPx + 'px', height: hPx + 'px', borderRadius: '8px', background: '#141414',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
        color: '#fff', flex: '0 0 auto', textAlign: 'center', padding: '0 10px',
      },
    },
    h('span', { style: { fontSize: '26px' } }, m.surprise ? '🎲' : '🎬'),
    h('span', { style: { fontSize: '11px', opacity: 0.8 } }, label));
  }
  // Frame « posé » : entrée terminée, contenu lisible.
  const lt = Math.min(1.1, moduleDur(m, secPerLine) * 0.45);
  const stage = h('div', {
    style: {
      position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px',
      background: '#F5EFE4', transform: `scale(${scale})`, transformOrigin: 'top left',
    },
  }, renderModule(h, m, lt, { secPerLine }));
  return h('div', {
    style: { position: 'relative', width: wPx + 'px', height: hPx + 'px', borderRadius: '8px', overflow: 'hidden', flex: '0 0 auto', border: '1px solid rgba(35,34,32,0.10)' },
  }, stage);
}

const card = (kids, extra = '') => html`<div style="background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:16px;padding:20px 22px;${extra}">${kids}</div>`;
const h3 = (t) => html`<h3 style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#8D1D2C;">${t}</h3>`;

class Report extends Component {
  state = { data: null, error: '' };

  async componentDidMount() {
    try {
      const r = await fetch(apiUrl('/report'));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.setState({ data: await r.json() });
    } catch (e) {
      this.setState({ error: String(e.message || e) });
    }
  }

  modulesById() {
    const map = new Map();
    for (const m of (this.state.data.modules || [])) map.set(m.id, m);
    return map;
  }

  render(_, st) {
    if (st.error) return html`<div style="max-width:720px;margin:80px auto;padding:24px;text-align:center;color:#8D1D2C;font-family:${FUI};">Rapport indisponible — ${st.error}</div>`;
    if (!st.data) return html`<div style="max-width:720px;margin:120px auto;text-align:center;color:#8A847C;font-family:${FUI};">Chargement du rapport…</div>`;

    const d = st.data;
    const spl = d.secPerLine || 4;
    const byId = this.modulesById();
    const filmMods = (f) => (f.items || []).map((id) => byId.get(id)).filter(Boolean);
    const filmDur = (f) => filmMods(f).filter(playable).reduce((s, m) => s + moduleDur(m, spl), 0);
    const storeName = (id) => (d.stores.find((s) => s.id === id) || {}).name || id;

    // Où chaque film est-il programmé dans la semaine active ? (jours concernés)
    const activeWeek = (d.plan && d.plan.activeWeek) || 'A';
    const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const filmUsage = (fid) => {
      const byStore = (d.plan && d.plan.byStore) || {};
      const set = new Set();
      for (const [sid, weeks] of Object.entries(byStore)) {
        const wk = (weeks || {})[activeWeek] || {};
        for (const [day, moments] of Object.entries(wk)) {
          for (const films of Object.values(moments || {})) {
            if ((films || []).includes(fid)) set.add(`${DAY_LONG[day]} · ${storeName(sid)}`);
          }
        }
      }
      return [...set];
    };

    const chip = (txt, color) => html`<span style="font-size:11px;font-weight:700;letter-spacing:0.04em;color:${color};background:${color}18;border:1px solid ${color}55;border-radius:999px;padding:2px 10px;">${txt}</span>`;

    const films = d.playlists || [];

    return html`
      <div style="max-width:1120px;margin:0 auto;padding:26px 20px 80px;font-family:${FUI};color:${INK};">

        <!-- En-tête -->
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:20px;">
          <div style="display:flex;align-items:center;gap:16px;">
            <img src="assets/logo.png" alt="" style="height:52px;width:auto;" />
            <div>
              <div style="font-size:12px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#8A847C;">${d.meta.brand} — Régie d'affichage</div>
              <div style="font-size:26px;font-weight:700;letter-spacing:-0.01em;">Rapport de diffusion</div>
              <div style="font-size:12px;color:#8A847C;margin-top:2px;">Généré le ${fmtDate(d.meta.generatedAt)} · version v${d.meta.version} · prix d${d.meta.dataVer}</div>
            </div>
          </div>
          <div class="no-print" style="display:flex;gap:8px;">
            <button onClick=${() => window.print()} style="padding:10px 16px;border-radius:999px;border:1px solid rgba(35,34,32,0.18);background:#fff;color:${INK};font-size:13px;font-weight:600;cursor:pointer;">🖨 Imprimer / PDF</button>
          </div>
        </div>

        <!-- Intro / explication -->
        ${card(html`
          ${h3('À propos de ce rapport')}
          <p style="margin:6px 0 0;font-size:13.5px;line-height:1.6;color:#4A4640;">
            Ce document récapitule <strong>tout ce qui est prêt à être diffusé</strong> sur les écrans de ${d.meta.brand} :
            la <strong>bibliothèque de films</strong> (chaque film est une suite d'éléments : catégories de produits avec prix,
            liaisons, animations, vidéos), le <strong>planning</strong> qui décide quel film passe à quel moment de la journée,
            et les <strong>écrans</strong> raccordés avec leur format. Chaque film est illustré par des miniatures fidèles à ce
            qui s'affiche réellement. Lien en lecture seule, à partager librement.
          </p>
        `, 'margin-bottom:20px;')}

        <!-- Bibliothèque de films -->
        <div style="display:flex;align-items:center;gap:10px;margin:0 2px 12px;">
          <span style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${INK};">1 · Bibliothèque de films</span>
          <span style="font-size:12px;color:#8A847C;">${films.length} film(s)</span>
        </div>

        ${films.length ? films.map((f) => {
          const cat = filmCatOf(f);
          const mods = filmMods(f);
          const usage = filmUsage(f.id);
          const days = (f.schedule && f.schedule.days) || [true, true, true, true, true, true, true];
          const everyDay = days.every(Boolean);
          return card(html`
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};"></span>
                <span style="font-size:18px;font-weight:700;">${f.name}</span>
                ${chip(cat.label, cat.color)}
                ${(f.tags || []).map((t) => html`<span style="font-size:11px;font-weight:600;color:${cat.color};">#${t}</span>`)}
                ${f.id === d.activePlaylistId ? chip('▶ Actif', '#2E6E4E') : ''}
              </div>
              <div style="font-size:12.5px;color:#8A847C;text-align:right;">
                ${mods.length} élément(s) · durée ${fmtDur(filmDur(f))}
              </div>
            </div>
            <div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:6px;">
              ${mods.length ? mods.map((m) => html`
                <div style="flex:0 0 auto;display:flex;flex-direction:column;gap:5px;width:248px;">
                  ${thumb(m, spl)}
                  <div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px;">
                    <span style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.name || m.type}</span>
                    <span style="font-size:10.5px;color:#8A847C;flex:0 0 auto;">${fmtDur(moduleDur(m, spl))}</span>
                  </div>
                  ${m.type === 'category' && m.items ? html`<span style="font-size:10.5px;color:#8A847C;">${activeItems(m).length} produit(s)</span>` : ''}
                </div>
              `) : html`<span style="font-size:12.5px;color:#8A847C;padding:14px 0;">Film vide (aucun élément).</span>`}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(35,34,32,0.07);font-size:12px;color:#6A655E;">
              <span><strong>Jours :</strong> ${everyDay ? 'tous les jours' : DAYS.filter((_, i) => days[i]).join(' · ') || '—'}</span>
              <span><strong>Diffusion :</strong> ${usage.length ? usage.join(' · ') : 'via l\'assignation par défaut de l\'écran'}</span>
            </div>
          `, 'margin-bottom:14px;');
        }) : card(html`<p style="margin:0;font-size:13px;color:#8A847C;">Aucun film pour l'instant.</p>`, 'margin-bottom:14px;')}

        <!-- Planning -->
        <div style="display:flex;align-items:center;gap:10px;margin:26px 2px 12px;">
          <span style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${INK};">2 · Planning — moments de la journée</span>
        </div>
        ${this.renderPlanning(d, byId)}

        <!-- Écrans -->
        <div style="display:flex;align-items:center;gap:10px;margin:26px 2px 12px;">
          <span style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${INK};">3 · Écrans</span>
          <span style="font-size:12px;color:#8A847C;">${d.stores.length} magasin(s)</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
          ${d.stores.map((s) => html`
            <div style="background:#fff;border:1px solid rgba(35,34,32,0.08);border-radius:14px;padding:15px 17px;opacity:${s.active ? 1 : 0.55};">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:15px;font-weight:700;">${s.name}</span>
                ${s.active ? '' : html`<span style="font-size:10.5px;color:#8A847C;">inactif</span>`}
              </div>
              <div style="font-size:12px;color:#8A847C;margin:3px 0 8px;">${s.group || ''}</div>
              <div style="font-size:12.5px;color:#4A4640;">📐 ${s.format.label} — <strong>${s.format.px}</strong></div>
              <div style="font-size:12.5px;color:#4A4640;margin-top:2px;">🗣 Langue : ${(s.lang || 'fr').toUpperCase()}</div>
              <a class="no-print" href=${`film?store=${encodeURIComponent(s.id)}`} target="_blank" style="display:inline-block;margin-top:9px;font-size:12.5px;font-weight:600;color:#8D1D2C;">↗ Voir l'écran en direct</a>
            </div>
          `)}
        </div>

        <div style="margin-top:34px;text-align:center;font-size:11.5px;color:#B8B2A8;">
          ${d.meta.brand} · Régie d'affichage — rapport généré automatiquement.
        </div>
      </div>
    `;
  }

  renderPlanning(d, byId) {
    const windows = (d.plan && d.plan.windows) || [];
    const byStore = (d.plan && d.plan.byStore) || {};
    const activeWeek = (d.plan && d.plan.activeWeek) || 'A';
    const DAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const filmName = (fid) => (d.playlists.find((p) => p.id === fid) || {}).name || '(film supprimé)';
    const filmCat = (fid) => filmCatOf(d.playlists.find((p) => p.id === fid));
    const filled = (cell) => windows.some((w) => ((cell || {})[w.id] || []).length);

    const windowsRow = html`
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:700;color:#2E6E4E;background:rgba(46,110,78,0.1);border:1px solid rgba(46,110,78,0.35);border-radius:999px;padding:4px 12px;">Semaine diffusée : ${activeWeek}</span>
        ${windows.map((w) => html`<span style="font-size:12px;color:#4A4640;background:#F5EFE4;border-radius:999px;padding:4px 12px;"><strong>${w.label}</strong> ${w.from} → ${w.to}</span>`)}
      </div>`;

    // Seuls les magasins qui ont du contenu dans la semaine active, par jour.
    const planned = d.stores.map((s) => {
      const week = (byStore[s.id] || {})[activeWeek] || {};
      const days = [0, 1, 2, 3, 4, 5, 6].filter((day) => filled(week[day]));
      return { store: s, week, days };
    }).filter((x) => x.days.length);

    if (!planned.length) {
      return card(html`
        ${windowsRow}
        <p style="margin:6px 0 0;font-size:13px;color:#8A847C;line-height:1.6;">
          Aucun créneau programmé dans la semaine active (${activeWeek}). Hors planning, chaque écran diffuse le film qui lui est assigné par défaut.
          Les fenêtres horaires ci-dessus sont communes à tous les magasins.
        </p>
      `);
    }

    return card(html`
      ${windowsRow}
      <p style="margin:0 0 14px;font-size:12.5px;color:#8A847C;line-height:1.55;">
        Planning de la semaine active (${activeWeek}) : pour chaque magasin et chaque jour, le(s) film(s) joué(s) à chaque moment
        (plusieurs films s'enchaînent en boucle). Hors créneau, l'écran reprend son film habituel.
      </p>
      <div style="display:flex;flex-direction:column;gap:16px;">
        ${planned.map(({ store, week, days }) => html`
          <div>
            <div style="font-size:14px;font-weight:700;margin-bottom:8px;">${store.name}</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${days.map((day) => html`
                <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
                  <span style="flex:0 0 92px;font-size:12.5px;font-weight:700;color:#6E4A2B;padding-top:3px;">${DAY_LONG[day]}</span>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;flex:1 1 auto;">
                    ${windows.map((w) => {
                      const fids = (week[day] && week[day][w.id]) || [];
                      if (!fids.length) return '';
                      return html`
                        <div style="border:1px solid rgba(35,34,32,0.1);border-radius:10px;padding:8px 11px;background:#FBF8F2;min-width:150px;">
                          <div style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#8A847C;">${w.label}</div>
                          ${fids.map((fid, i) => html`<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                            <span style="font-size:9px;font-weight:700;color:${filmCat(fid).color};opacity:0.7;">${i + 1}</span>
                            <span style="font-size:12.5px;font-weight:600;color:${filmCat(fid).color};">${filmName(fid)}</span>
                          </div>`)}
                        </div>`;
                    })}
                  </div>
                </div>
              `)}
            </div>
          </div>
        `)}
      </div>
    `);
  }
}

render(h(Report), document.getElementById('root'));
