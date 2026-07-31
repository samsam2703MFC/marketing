// Gabarits HTML — presets de format et exemple prêt à coller.
// Le code collé en régie peut être un document complet ou un fragment ; il est
// mis à l'échelle sur l'écran (voir splitHtmlDoc dans renderer.js).

// Formats source proposés à l'import du code (ratio de la maquette).
export const HTML_PRESETS = [
  { id: '16:9', label: '16:9 — paysage', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16 — portrait', w: 1080, h: 1920 },
  { id: 'a1-p', label: 'A1 portrait', w: 840, h: 1189 },
  { id: 'a1-l', label: 'A1 paysage', w: 1189, h: 840 },
];

// Variables disponibles dans le code : remplacées PAR MAGASIN à la diffusion
// (mêmes jetons que les titres/sous-titres — cf. applyStoreTokens côté serveur).
export const HTML_TOKENS = [
  { token: '{{magasin}}', label: 'Nom du magasin' },
  { token: '{{adresse}}', label: 'Adresse' },
  { token: '{{horaires}}', label: 'Horaires' },
  { token: '{{tel}}', label: 'Téléphone' },
  { token: '{{date}}', label: 'Date du jour' },
  { token: '{{saison}}', label: 'Période active' },
  { token: '{{moment}}', label: 'Matin / midi / après-midi' },
];

// Variables toujours identiques (identité de marque) : résolues d'office côté
// serveur, sans liaison. Miroir de HTML_BRAND_VARS dans db.js.
export const HTML_BRAND_VARS = {
  logo: 'assets/logo.png',
  logoblanc: 'assets/logo-white.png',
  'logo-blanc': 'assets/logo-white.png',
  logowhite: 'assets/logo-white.png',
};
// Images livrées avec l'application (miroir de HTML_ASSETS dans db.js).
export const HTML_ASSETS = [
  { id: 'assets/logo.png', label: 'Logo' },
  { id: 'assets/logo-white.png', label: 'Logo blanc' },
  { id: 'assets/sweet-tart-big.png', label: 'Tarte (grande)' },
  { id: 'assets/sweet-tart-small.png', label: 'Tarte (petite)' },
  { id: 'assets/cake.png', label: 'Gâteau' },
  { id: 'assets/cake-slice.png', label: 'Part de gâteau' },
  { id: 'assets/cookies.png', label: 'Cookie' },
  { id: 'assets/cherry.png', label: 'Cerise' },
  { id: 'assets/apple.png', label: 'Pomme' },
  { id: 'assets/rhubarb.png', label: 'Rhubarbe' },
];
export const HTML_VAR_SOURCES = [
  { id: 'literal', label: 'Valeur libre', fields: [] },
  { id: 'image', label: 'Image / marque', fields: [] },
  { id: 'produit', label: 'Produit', fields: [
    { id: 'nom', label: 'Nom' }, { id: 'prix', label: 'Prix' },
    { id: 'image', label: 'Photo / illustration' }, { id: 'categorie', label: 'Catégorie' },
  ] },
  { id: 'promotion', label: 'Promotion', fields: [
    { id: 'nom', label: 'Nom du type' }, { id: 'icone', label: 'Icône' },
    { id: 'couleur', label: 'Couleur' }, { id: 'description', label: 'Description' },
  ] },
  { id: 'campagne', label: 'Campagne', fields: [
    { id: 'nom', label: 'Nom' }, { id: 'message', label: 'Accroche' },
    { id: 'theme', label: 'Thème / gamme' }, { id: 'image', label: 'Visuel' },
    { id: 'couleur', label: 'Couleur' }, { id: 'du', label: 'Date de début' }, { id: 'au', label: 'Date de fin' },
  ] },
  { id: 'magasin', label: 'Magasin / contexte', fields: [
    { id: 'nom', label: 'Nom du magasin' }, { id: 'adresse', label: 'Adresse' },
    { id: 'horaires', label: 'Horaires' }, { id: 'tel', label: 'Téléphone' },
    { id: 'date', label: 'Date du jour' }, { id: 'saison', label: 'Période active' },
    { id: 'moment', label: 'Moment' },
  ] },
];

// Noms des variables présentes dans un code : {{ titre }}, {{titreAccent}}…
// (même extraction que côté serveur, insensible aux espaces).
export function htmlVarNames(code) {
  const out = [];
  const seen = new Set();
  String(code || '').replace(/\{\{([^{}]+)\}\}/g, (m0, raw) => {
    const name = String(raw).trim();
    const k = name.toLowerCase();
    if (name && !seen.has(k)) { seen.add(k); out.push(name); }
    return m0;
  });
  return out;
}

// Exemple : affiche A1 (840 × 1189, ratio √2) aux couleurs de la marque, avec
// les variables en place. Les polices Gotham/Vank sont déjà chargées par
// l'application — inutile de redéclarer @font-face. Les illustrations viennent
// du dossier public/assets/.
export const HTML_EXAMPLE_A1 = {
  id: 'a1',
  label: 'Affiche A1 (exemple)',
  w: 840,
  h: 1189,
  html: `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Affiche A1 — L'Atelier By</title>
<style>
  .a1-wrap{width:840px;height:1189px;box-sizing:border-box;background:#F5EFE4;
    padding:66px 70px 54px;position:relative;overflow:hidden;
    font-family:'Gotham';color:#232220;}
  .a1-mark{position:absolute;width:620px;height:auto;top:-70px;right:-160px;
    opacity:0.06;z-index:0;pointer-events:none;}
  .a1-in{position:relative;z-index:1;width:100%;height:100%;display:flex;
    flex-direction:column;align-items:center;text-align:center;}
  .a1-rule{width:52px;height:1px;background:#E8964B;display:block;}
</style>
</head>
<body>
<article class="a1-wrap">
  <img class="a1-mark" src="assets/sweet-tart-big.png" alt="" aria-hidden="true">
  <div class="a1-in">

    <!-- 1 · logo -->
    <img src="assets/logo.png" alt="L'Atelier By" style="height:30px;width:auto;flex:0 0 auto;">

    <!-- 2 · eyebrow — la période active du jour -->
    <div style="display:flex;align-items:center;justify-content:center;gap:22px;margin-top:30px;flex:0 0 auto;">
      <span class="a1-rule"></span>
      <span style="font-weight:500;font-size:27px;letter-spacing:0.20em;text-transform:uppercase;color:#8D1D2C;white-space:nowrap;">{{saison}}</span>
      <span class="a1-rule"></span>
    </div>

    <!-- 3 · titre -->
    <h1 style="font-family:'Vank','Gotham';font-weight:400;font-size:96px;line-height:0.96;letter-spacing:0.004em;text-transform:uppercase;margin:22px 0 0;max-width:14ch;">
      Fait <span style="color:#E8964B;">maison</span>
    </h1>

    <!-- 4 · accroche -->
    <p style="font-weight:300;font-size:31px;line-height:1.4;color:#8A847C;margin:14px 0 0;max-width:34ch;">
      chaque matin à {{magasin}}
    </p>

    <!-- 5 · illustration : zone élastique -->
    <div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;width:100%;min-height:0;margin:6px 0;">
      <img src="assets/sweet-tart-small.png" alt="" style="max-width:62%;max-height:92%;width:auto;height:auto;object-fit:contain;">
    </div>

    <!-- 6 · bloc offre, ancré en bas -->
    <div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:11px;padding:0 38px;">
      <div style="font-weight:300;font-size:118px;line-height:1;letter-spacing:-0.012em;color:#E8964B;">
        <span style="font-size:0.6em;font-weight:400;vertical-align:0.1em;margin-right:5px;">+</span>1/4
      </div>
      <div style="font-weight:400;font-size:22px;letter-spacing:0.14em;text-transform:uppercase;color:#8A847C;">offert sur les tartes</div>
      <div style="font-weight:400;font-size:17px;letter-spacing:0.12em;text-transform:uppercase;color:#B8B2A8;">{{adresse}} · {{horaires}}</div>
    </div>

  </div>
</article>
</body>
</html>`,
};

// Une variable peut être décalée à l'écran (x/y en px de la maquette) : sa
// valeur est alors enrobée dans un span translaté. On ne le fait QUE si la
// variable est en position de texte — à l'intérieur d'une balise (ex.
// src="{{ logo }}"), enrober casserait le HTML.
export function insideTag(html, index) {
  const lt = html.lastIndexOf('<', index);
  const gt = html.lastIndexOf('>', index);
  return lt > gt;
}
export function wrapHtmlVarPos(value, bind, fullHtml, index) {
  const x = (bind && bind.x) || 0;
  const y = (bind && bind.y) || 0;
  if ((!x && !y) || insideTag(fullHtml, index)) return value;
  return `<span style="display:inline-block;transform:translate(${x}px, ${y}px);">${value}</span>`;
}

// Placement d'une variable qui vit DANS une balise (ex. src="{{ illustration }}") :
// on ne peut pas enrober sa valeur sans casser le HTML, alors on applique la
// translation à la balise elle-même, en complétant son style. Passe faite AVANT
// la substitution, tant que les {{ … }} permettent encore de situer la balise.
export function applyHtmlVarPositions(code, binds) {
  let s = String(code || '');
  const map = new Map();
  for (const k of Object.keys(binds || {})) map.set(String(k).trim().toLowerCase(), binds[k]);
  if (!map.size) return s;
  // Chaque injection décale les positions : on relance le balayage après coup,
  // les balises déjà traitées étant marquées (data-sigpos).
  for (let guard = 0; guard < 200; guard++) {
    const re = /\{\{([^{}]+)\}\}/g;
    let hit = null, m;
    while ((m = re.exec(s))) {
      const b = map.get(String(m[1]).trim().toLowerCase());
      if (!b || (!b.x && !b.y)) continue;
      if (!insideTag(s, m.index)) continue;           // texte : enrobage suffit
      const lt = s.lastIndexOf('<', m.index);
      const gt = s.indexOf('>', m.index);
      if (lt < 0 || gt < 0) continue;
      const tag = s.slice(lt, gt + 1);
      if (tag.indexOf('data-sigpos') !== -1) continue; // déjà placée
      hit = { lt, gt, tag, x: b.x || 0, y: b.y || 0 };
      break;
    }
    if (!hit) break;
    // La déclaration ajoutée en dernier l'emporte sur un transform existant.
    const decl = `transform:translate(${hit.x}px, ${hit.y}px);`;
    let tag = hit.tag;
    const sm = /\sstyle\s*=\s*"([^"]*)"/i.exec(tag);
    if (sm) {
      const merged = sm[1].replace(/;\s*$/, '') + ';' + decl;
      tag = tag.slice(0, sm.index) + ` style="${merged}"` + tag.slice(sm.index + sm[0].length);
    } else {
      tag = tag.replace(/\s*\/?>$/, (end) => ` style="${decl}"${end}`);
    }
    tag = tag.replace(/\s*\/?>$/, (end) => ` data-sigpos="1"${end}`);
    s = s.slice(0, hit.lt) + tag + s.slice(hit.gt + 1);
  }
  return s;
}
