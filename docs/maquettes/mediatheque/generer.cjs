// Maquette « Médiathèque » (17/11/2026, Sam : « la possibilité de taguer les images — 3-4 idées — et vérifier dans le
// module signage pourquoi les tags seront nécessaires » ; « lors de l'import de photos il faut un crop avec les ratios
// des templates (webshop…), un paramètre pour réduire à la bonne taille, et dans les paramètres une API vers
// Cloudflare »). Les photos sont les vraies photos du webshop (photos.json, lues dans le dashboard) ; rien n'est codé.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ICI = __dirname;
const P = JSON.parse(fs.readFileSync(path.join(ICI, 'photos.json'), 'utf8'));
const ph = n => (P.find(p => p.name.toLowerCase().includes(n.toLowerCase())) || P[0]).img;
const F = { moment: '#B0792A', saison: '#3f7a52', produit: '#8D1D2C', format: '#2F5D8A', usage: '#7A4E8C', boutique: '#5c5852', validite: '#A0522D' };
const dot = c => '<i style="background:' + c + '"></i>';
const chip = (t, c, cls = '') => '<span class="chip ' + cls + '">' + (c ? dot(c) : '') + t + '</span>';
const head = (onglet, droite = '') => '<div class="top"><div><div class="k">Vue réseau</div><h1>Médiathèque</h1></div><span class="sp"></span>' + droite
  + '<span class="btn">⇪ Importer</span><span class="btn">⚙ Réglages</span></div>'
  + '<div class="bar"><span class="seg">' + ['Fichiers', 'Photos du webshop', 'Illustrations'].map(t => '<b class="' + (t === onglet ? 'on' : '') + '">' + t + '</b>').join('') + '</span>'
  + '<span class="search">Rechercher un produit, une étiquette…</span>'
  + [['Moment', F.moment], ['Saison', F.saison], ['Produit', F.produit], ['Format', F.format], ['Usage', F.usage]].map(([t, c]) => chip(t + ' ▾', c)).join('') + '</div>';
const TAGS = {
  'Croissant': [['Matin', F.moment], ['Carré', F.format], ['Écrans', F.usage]],
  'Pain au Chocolat': [['Matin', F.moment], ['Carré', F.format]],
  'Cougnou - Sucre': [['Saint-Nicolas', F.saison], ['Carré', F.format]],
  'Club': [['Midi', F.moment], ['Écrans', F.usage]],
  'Cookie Chocolat Lait': [['Après-midi', F.moment]],
  'Cinnamon rolls': [['Matin', F.moment], ['Réseaux', F.usage]],
  'Salade Campagnarde': [['Midi', F.moment]],
  'Bouteille Coca-Cola 50cl': [['Midi', F.moment]],
};
const tile = (p, opts = {}) => '<div class="tile' + (opts.on ? ' on' : '') + (opts.sel ? ' sel' : '') + '">' + (opts.cb ? '<span class="cb"></span>' : '') + '<span class="ph"><img src="' + p.img + '"></span><span class="n">' + p.name + '</span>'
  + '<span class="t">' + ((opts.notags ? [] : (TAGS[p.name] || [])).map(([t, c]) => chip(t, c, 'sm')).join('') || '<span class="chip sm auto">sans étiquette</span>') + '</span></div>';
const idea = (n, t) => '<span class="idea"><b>' + n + '</b>' + t + '</span>';

const ECRANS = {
  '1-fiche': () => '<div class="app">' + head('Fichiers') + '<div class="two"><div class="grid">' + P.slice(0, 18).map((p, i) => tile(p, { on: i === 0 })).join('') + '</div>'
    + '<div class="card" style="display:grid;gap:10px">' + idea(1, 'Les étiquettes sur la fiche de l’image')
    + '<div style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:center"><span class="tile" style="padding:4px"><span class="ph"><img src="' + ph('Croissant') + '"></span></span><div><div style="font-size:15px">Croissant</div><div class="hint">1 200 × 1 200 · WebP · 64 Ko · versée du webshop le 17/11</div></div></div>'
    + '<div>' + [
      ['Moment', F.moment, ['Matin', 'Midi', 'Après-midi', 'Toute la journée'], ['Matin']],
      ['Saison', F.saison, ['Toute l’année', 'Noël', 'Saint-Nicolas', 'Pâques', 'Fête des mères'], ['Toute l’année']],
      ['Produit lié', F.produit, ['Croissant · ERP'], ['Croissant · ERP']],
      ['Format', F.format, ['Carré 1:1 · détecté'], ['Carré 1:1 · détecté']],
      ['Usage', F.usage, ['Écrans', 'Réseaux', 'Catalogue', 'Webshop', 'Bâche'], ['Écrans', 'Réseaux', 'Catalogue']],
      ['Boutique', F.boutique, ['Réseau', 'Halle', 'Gosselies', '…'], ['Réseau']],
      ['Fin de validité', F.validite, ['Aucune', '+ une date'], ['Aucune']],
      ['Libres', '#B8B2A8', ['#vitrine', '#fait-maison', '+ ajouter'], ['#vitrine', '#fait-maison']],
    ].map(([l, c, opts, on]) => '<div class="fam"><span class="l">' + dot(c) + l + '</span><span class="c">' + opts.map(o => chip(o, null, on.includes(o) ? 'on' : '')).join('') + '</span></div>').join('') + '</div>'
    + '<div class="why"><b>Pourquoi pour les écrans des magasins (régie d’affichage)</b> — l’élément « média ciblé » tire au sort une image dont le <b>moment</b> correspond à l’heure (matin avant 11 h, midi, après-midi après 16 h) et dont la <b>saison</b> est active ; sans moment, elle passe toute la journée. Le <b>produit lié</b> la montre avec son prix et la retire quand il est en rupture ; le <b>format</b> l’écarte d’un écran qui n’a pas le bon sens (portrait / paysage).</div></div></div></div>',

  '2-proposees': () => '<div class="app">' + head('Fichiers', '<span class="badge w">18 étiquettes proposées</span>') + '<div class="card">' + '<div class="ttl">' + idea(2, 'Les étiquettes proposées, à valider') + '<span class="sp"></span><span class="hint">tirées du webshop et du fichier — rien ne s’enregistre sans ✓</span><span class="btn pri">Tout accepter (18)</span></div>'
    + '<table><tr><th></th><th>Image</th><th>Proposé</th><th>D’après</th><th></th></tr>' + [
      ['Croissant', [['Croissant · ERP', F.produit], ['Matin', F.moment], ['Carré', F.format]], 'nom du webshop · rayon Viennoiserie → matin · 1 200 × 1 200'],
      ['Cougnou - Sucre', [['Cougnou · ERP', F.produit], ['Saint-Nicolas', F.saison], ['Matin', F.moment]], 'gamme de l’ERP (période de disponibilité) · rayon Fêtes'],
      ['Club', [['Club · ERP', F.produit], ['Midi', F.moment], ['Détourée', F.format]], 'rayon Traiteur › Sandwich → midi · fond blanc'],
      ['Cookie Chocolat Lait', [['Cookie · ERP', F.produit], ['Après-midi', F.moment]], 'rayon Biscuiterie → goûter'],
      ['Salade Campagnarde', [['Salade · ERP', F.produit], ['Midi', F.moment]], 'rayon Traiteur → midi'],
      ['Abricot', [['Tarte abricot · ERP', F.produit], ['Après-midi', F.moment], ['Été', F.saison]], 'rayon Tartes · fruit de saison'],
    ].map(([n, tags, src]) => '<tr><td style="width:56px"><img class="mini" src="' + ph(n) + '"></td><td>' + n + '</td><td>' + tags.map(([t, c]) => chip(t, c, 'auto')).join(' ') + '</td><td class="hint">' + src + '</td><td style="white-space:nowrap;text-align:right"><span class="yes g">✓</span><span class="yes">✕</span></td></tr>').join('') + '</table>'
    + '<div class="why" style="margin-top:10px"><b>Le moins de saisie possible</b> — le produit (et donc son prix et sa rupture sur les écrans), le format et souvent le moment se déduisent ; on ne fait que valider. Une règle (« rayon Viennoiserie → Matin ») se change dans les réglages.</div></div></div>',

  '3-lot': () => '<div class="app">' + head('Fichiers') + '<div style="display:grid;grid-template-columns:230px minmax(0,1fr);gap:14px;align-items:start">'
    + '<div class="card drawer">' + idea(3, 'En lot : glisser sur un tiroir') + [['Moment', F.moment, [['Matin', 12, 1], ['Midi', 5], ['Après-midi', 9]]], ['Saison', F.saison, [['Noël', 7], ['Saint-Nicolas', 4], ['Pâques', 0]]], ['Usage', F.usage, [['Écrans', 21], ['Réseaux', 30], ['Catalogue', 18]]]].map(([f, c, ds]) => '<div class="k" style="margin-top:6px">' + f + '</div>' + ds.map(([d, n, over]) => '<div class="d' + (over ? ' over' : '') + '">' + dot(c).replace('<i', '<i style="width:9px;height:9px;border-radius:50%;display:inline-block;background:' + c + '"').replace(/style="background:[^"]*"/, '') + d + '<span class="cnt">' + (over ? '+6 · lâcher ici' : n) + '</span></div>').join('')).join('') + '</div>'
    + '<div style="display:grid;gap:10px"><div class="grid">' + P.slice(0, 18).map((p, i) => tile(p, { cb: true, sel: [0, 1, 5, 7, 9, 13].includes(i), notags: [1, 9, 13].includes(i) })).join('') + '</div>'
    + '<div class="card" style="display:flex;align-items:center;gap:10px;position:sticky;bottom:0;box-shadow:0 -4px 18px rgba(0,0,0,.08)"><b style="font-weight:400">6 images sélectionnées</b><span class="sp"></span>' + chip('Moment : Matin', F.moment, 'on') + chip('Usage : Écrans', F.usage, 'on') + chip('+ Saison', F.saison) + '<span class="btn pri">Étiqueter les 6</span></div></div></div></div>',

  '4-ecran': () => '<div class="app">' + head('Fichiers') + '<div class="two" style="grid-template-columns:minmax(0,1fr) 460px"><div class="card">' + '<div class="ttl">' + idea(4, 'Ce que l’écran du magasin montrera') + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' + chip('Halle', F.boutique, 'on') + chip('Écran portrait', F.format, 'on') + chip('Mardi 8 h · matin', F.moment, 'on') + chip('Saison active : Toute l’année', F.saison, 'on') + '</div>'
    + '<div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">' + ['Croissant', 'Pain au Chocolat', 'Cinnamon rolls', 'Couque au Beurre'].map(n => tile(P.find(p => p.name.includes(n)) || P[0])).join('') + '</div>'
    + '<table style="margin-top:12px"><tr><th>Ce qui ne passera pas à cet écran</th><th style="text-align:right">images</th></tr>'
    + [['Sans moment : passent toute la journée, entre les autres', 12, 'w'], ['Paysage : jamais sur un écran portrait (recadrer en 9:16 à l’import)', 7, 'w'], ['Noël : à partir du 1/12 (période de l’ERP)', 3, ''], ['Midi et après-midi : plus tard dans la journée', 14, '']].map(([t, n, w]) => '<tr><td>' + (w ? '<span class="badge w">à revoir</span> ' : '') + t + '</td><td style="text-align:right">' + n + '</td></tr>').join('') + '</table></div>'
    + '<div class="card" style="display:grid;gap:10px;justify-items:center"><div class="k" style="justify-self:start">Simulation de la régie · média ciblé</div><div class="screen"><div style="width:200px;height:356px;border-radius:6px;background:#F3F1EE;display:grid;place-items:center;overflow:hidden"><img src="' + ph('Croissant') + '" style="width:100%;height:100%;object-fit:cover"></div></div>'
    + '<div class="hint" style="text-align:center">4 images possibles · une tirée au sort à chaque passage · la même que l’écran du magasin</div>'
    + '<div class="why"><b>Pourquoi les étiquettes</b> — la régie d’affichage (module signage) choisit seule : moment de la journée, saison active, produit (prix et rupture du magasin) ; le format évite une photo paysage étirée sur un écran portrait.</div></div></div></div>',

  '5-import': () => '<div class="app" style="background:rgba(28,26,23,.06)">' + '<div class="card" style="display:grid;gap:12px;box-shadow:0 18px 48px rgba(0,0,0,.18)"><div class="top"><div><div class="k">Importer une image</div><h1 style="font-size:18px">Brioche tressée au chocolat · 4 000 × 4 000 · JPEG · 4,8 Mo</h1></div><span class="sp"></span><span class="btn">Annuler</span><span class="btn pri">Importer · 3 formats</span></div>'
    + '<div style="display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;align-items:start"><div style="display:grid;gap:10px"><div class="crop"><img src="' + ph('Brioche') + '"><span class="win" style="left:31%;top:6%;width:38%;height:88%"></span></div>'
    + '<div class="hint">Glisser pour cadrer, la molette pour zoomer · le cadre suit le format choisi à droite · chaque format garde son propre cadrage.</div></div>'
    + '<div style="display:grid;gap:8px"><div class="k">Recadrer pour</div>' + [
      ['Webshop · carré', '1:1 · 1 200 × 1 200', 22, 22, 'done'], ['Post Instagram', '4:5 · 1 080 × 1 350', 20, 25, 'done'], ['Story · écran portrait', '9:16 · 1 080 × 1 920', 14, 25, 'on'],
      ['Écran paysage', '16:9 · 1 920 × 1 080', 25, 14, ''], ['Catalogue A5', '148:210 · 1 748 × 2 480 (300 dpi)', 17, 24, ''], ['Original', 'impression, bâche — non recadré', 24, 16, ''],
    ].map(([t, s, w, h, st]) => '<div class="ratio ' + st + '"><span class="r" style="width:' + w + 'px;height:' + h + 'px"></span><b>' + t + (st === 'done' ? ' <span class="ok">✓</span>' : '') + '</b><small>' + s + '</small></div>').join('')
    + '<div class="k" style="margin-top:6px">Réduire à la bonne taille</div><div class="card" style="padding:10px 12px;display:grid;gap:8px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>Côté long</span><b style="font-weight:400">2 048 px</b></div><div class="slider"><i style="width:45%"></i><b style="left:43%"></b></div>'
    + '<div style="display:flex;justify-content:space-between;font-size:12px"><span>Format · qualité</span><span>WebP · 82</span></div><label class="hint"><input type="checkbox" checked> garder l’original pour l’impression (rangé à part)</label></div>'
    + '<div class="kpi"><div><span>original</span><b>4,8 Mo</b><span>4 000 × 4 000</span></div><div><span>web (écrans, posts)</span><b class="ok">380 Ko</b><span>2 048 × 2 048</span></div><div><span>vignette</span><b>32 Ko</b><span>480 px</span></div></div></div></div></div></div>',

  '6-reglages': () => '<div class="app"><div class="top"><div><div class="k">Vue réseau · Médiathèque</div><h1>Réglages de la médiathèque</h1></div><span class="sp"></span><span class="btn pri">Enregistrer</span></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">'
    + '<div class="card" style="display:grid;gap:10px"><div class="ttl"><h2>Stockage · Cloudflare R2</h2><span class="sp"></span><span class="badge w">pas encore relié</span></div>'
    + '<div class="hint">Aujourd’hui les fichiers sont sur le disque du serveur. Relié, chaque image est rangée dans le bucket et servie par l’adresse publique de Cloudflare (plus rapide pour les écrans et le webshop). Les clés vont dans <b>erp_cles</b> (portail mar), jamais dans le code.</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + [['Compte Cloudflare (ID)', 'à saisir'], ['Bucket', 'atelierby-marketing'], ['Adresse publique', 'https://media.… (domaine ou r2.dev)'], ['Région', 'auto'], ['Clé d’accès', '••••••••', 1], ['Clé secrète', '••••••••', 1]].map(([l, v, m]) => '<label class="field"><span>' + l + '</span><div class="' + (m ? 'mask' : '') + '">' + v + '</div></label>').join('') + '</div>'
    + '<div style="display:flex;gap:8px"><span class="btn">Tester la connexion</span><span class="btn">Copier les fichiers existants vers R2</span></div>'
    + '<label class="hint"><input type="checkbox"> Cloudflare Images : tailles à la volée (variantes) au lieu des fichiers réduits</label></div>'
    + '<div class="card"><div class="ttl"><h2>Tailles par usage (recadrage à l’import)</h2></div><table><tr><th>Usage</th><th>Format</th><th>Taille</th><th>Fichier</th></tr>' + [
      ['Webshop', '1:1', '1 200 × 1 200', 'WebP 82 · ~120 Ko'], ['Post Instagram / Facebook', '4:5', '1 080 × 1 350', 'JPEG 85 · ~250 Ko'], ['Story · écran portrait', '9:16', '1 080 × 1 920', 'WebP 82 · ~300 Ko'],
      ['Écran paysage', '16:9', '1 920 × 1 080', 'WebP 82 · ~300 Ko'], ['Catalogue A5', '148:210', '1 748 × 2 480', 'JPEG 92 · 300 dpi'], ['Bâche, affiche', 'libre', 'original', 'non réduit']].map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="mut"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</table></div>'
    + '<div class="card"><div class="ttl"><h2>Étiquettes</h2></div>' + [
      ['Moment', F.moment, 'matin · midi · après-midi — les créneaux de la régie d’affichage (avant 11 h, 11 h-16 h, après 16 h)'],
      ['Saison', F.saison, 'les périodes de disponibilité de l’ERP (Noël, Saint-Nicolas…) — lues, pas recopiées'],
      ['Produit', F.produit, 'les produits du webshop (ERP) : prix et rupture du magasin à l’écran'],
      ['Format', F.format, 'détecté à l’import : carré · portrait · paysage'],
      ['Usage', F.usage, 'écrans · réseaux · catalogue · webshop · bâche'],
      ['Règles', '#B8B2A8', 'rayon Viennoiserie → Matin · Traiteur → Midi · Biscuiterie → Après-midi (modifiables)'],
    ].map(([l, c, t]) => '<div class="fam"><span class="l">' + dot(c) + l + '</span><span class="hint">' + t + '</span></div>').join('') + '</div>'
    + '<div class="card"><div class="ttl"><h2>Sources</h2></div><div class="fam"><span class="l">Photos du webshop</span><span class="hint">lues dans TFBuddy par le module Social (catalogue du webshop) ; elles restent chez TFBuddy et n’entrent dans la médiathèque qu’au moment où on les choisit (copie, jamais en double).</span></div>'
    + '<div class="fam"><span class="l">Illustrations</span><span class="hint">le design system de la marque, servi par Social.</span></div><div class="fam"><span class="l">Régie d’affichage</span><span class="hint">a sa propre médiathèque (agence, vidéos) avec moment · produit · saison — à relier à celle-ci par les mêmes étiquettes.</span></div></div>'
    + '</div></div>',
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const [nom, f] of Object.entries(ECRANS)) {
    if (process.env.SEUL && process.env.SEUL !== nom) { continue; }
    const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="maquette.css"></head><body>' + f() + '</body></html>';
    fs.writeFileSync(path.join(ICI, nom + '.html'), html);
    await p.goto('file://' + path.join(ICI, nom + '.html'), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
    const h = await p.evaluate(() => document.querySelector('.app').getBoundingClientRect().height);
    await p.setViewportSize({ width: 1440, height: Math.ceil(h) }); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(ICI, nom + '.png'), fullPage: true });
    console.log(nom, Math.round(h));
  }
  await b.close();
})();
