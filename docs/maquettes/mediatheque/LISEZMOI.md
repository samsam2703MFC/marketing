# Maquette — la médiathèque du module (17/11/2026)

Demandes de Sam :
- « une seule médiathèque pour tout le module » (fait : le choix d'image des catalogues prend le sélecteur commun,
  fichiers · photos du webshop · illustrations) ;
- « la possibilité de taguer les images — 3-4 idées — et vérifier dans le module signage pourquoi les tags seront
  nécessaires » ;
- « à l'import, un recadrage avec les ratios des templates (webshop…), un paramètre pour réduire à la bonne taille,
  et dans les réglages une API vers Cloudflare ».

| Écran | Idée |
| --- | --- |
| `1-fiche.png` | **1 · Les étiquettes sur la fiche** : moment, saison, produit lié, format (détecté), usage, boutique, fin de validité, libres. |
| `2-proposees.png` | **2 · Proposées, à valider** : tirées du webshop (produit, rayon → moment, gamme → saison) et du fichier (format, détourée). |
| `3-lot.png` | **3 · En lot** : sélectionner, glisser sur un tiroir (Matin, Noël, Écrans…), ou « Étiqueter les 6 ». |
| `4-ecran.png` | **4 · Ce que l'écran montrera** : la simulation de la régie (magasin, sens de l'écran, heure, saison) et ce qui ne passera pas. |
| `5-import.png` | Import : recadrage par usage (webshop 1:1, post 4:5, story/écran portrait 9:16, écran paysage 16:9, catalogue A5, original) et réduction (côté long, WebP, poids). |
| `6-reglages.png` | Réglages : stockage Cloudflare R2 (clés dans `erp_cles`), tailles par usage, familles d'étiquettes et règles, sources. |

**Pourquoi la régie d'affichage (dépôt `signage`) en a besoin** : sa médiathèque agence porte déjà moment
(matin · midi · après-midi), produit et saison (`sig_media`) ; l'élément « média ciblé » tire au sort une image du
moment courant et d'une saison active (`resolveMediaElements`, `server/api.js`), le film continu se compose avec les
saisons, les moments et les tags. Les créneaux par défaut : matin avant 11 h, midi 11 h-16 h, après-midi après 16 h
(`currentMoment`, `server/db.js`). Les écrans ont un sens (portrait / paysage). Sans ces étiquettes dans la médiathèque
du Marketing, ses images ne peuvent pas servir aux écrans.

**Les photos du webshop** : lues dans TFBuddy par le module Social (`GET …/social/catalogue/nav`), hébergées chez
TFBuddy (Cloudflare R2 public) ; elles entrent dans la médiathèque (copie dans le dossier des envois du serveur, une
vignette de 480 px et une version web de 2 048 px) seulement quand on les choisit.

Photos : les vraies photos du webshop (`photos.json`). `node generer.cjs` (`SEUL=1-fiche` pour un écran). Rien n'est codé.
