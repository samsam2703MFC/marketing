// Internationalisation de l'interface de régie (back office).
// Trois langues : français (source), anglais, italien. Cela ne change QUE la
// langue de l'INTERFACE ; la langue affichée à l'écran par magasin reste réglée
// dans Réseau (sig_stores.lang). Choix persisté par navigateur (localStorage).

export const UI_LANGS = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'it', label: 'Italiano', short: 'IT' },
];

export const UI_LANG_IDS = UI_LANGS.map((l) => l.id);

// Dictionnaire { clé : { fr, en, it } }. La valeur `fr` sert de repli si une
// traduction manque. Interpolation : {x} remplacé par vars.x.
export const I18N = {
  // -- chargement / erreurs / connexion --
  'app.loading': { fr: 'Chargement de la régie…', en: 'Loading the console…', it: 'Caricamento della console…' },
  'app.cmsUnreachable': { fr: 'Impossible de joindre le CMS : {err}', en: 'Cannot reach the CMS: {err}', it: 'Impossibile raggiungere il CMS: {err}' },
  'app.retry': { fr: 'Réessayer', en: 'Retry', it: 'Riprova' },
  'login.title': { fr: 'Régie d\'affichage', en: 'Signage console', it: 'Console di gestione' },
  'login.subtitle': { fr: 'Connexion requise pour piloter le réseau', en: 'Sign in to manage the network', it: 'Accedi per gestire la rete' },
  'login.user': { fr: 'Utilisateur', en: 'Username', it: 'Utente' },
  'login.password': { fr: 'Mot de passe', en: 'Password', it: 'Password' },
  'login.signIn': { fr: 'Se connecter', en: 'Sign in', it: 'Accedi' },
  'login.signingIn': { fr: 'Connexion…', en: 'Signing in…', it: 'Accesso…' },
  'login.viewFilm': { fr: '▶ Visualiser le film (sans connexion)', en: '▶ View the film (no sign-in)', it: '▶ Guarda il film (senza accesso)' },

  // -- en-tête / navigation --
  'header.console': { fr: 'Régie d\'affichage', en: 'Signage console', it: 'Console di gestione' },
  'nav.home': { fr: 'Accueil', en: 'Home', it: 'Home' },
  'nav.composer': { fr: 'Compositeur', en: 'Composer', it: 'Compositore' },
  'nav.products': { fr: 'Produits', en: 'Products', it: 'Prodotti' },
  'nav.promotions': { fr: 'Promotions', en: 'Promotions', it: 'Promozioni' },
  'nav.campaigns': { fr: 'Campagnes', en: 'Campaigns', it: 'Campagne' },
  'nav.seasons': { fr: 'Périodes', en: 'Periods', it: 'Periodi' },
  'nav.planning': { fr: 'Planning', en: 'Schedule', it: 'Pianificazione' },
  'nav.fleet': { fr: 'Réseau & supervision', en: 'Network & monitoring', it: 'Rete e supervisione' },
  'nav.seeFilm': { fr: '▶ Voir le film', en: '▶ View film', it: '▶ Vedi film' },
  'nav.uiLang': { fr: 'Langue de l\'interface', en: 'Interface language', it: 'Lingua dell\'interfaccia' },

  // -- boutons d'en-tête (info-bulles) --
  'hdr.undo': { fr: 'Annuler (⌘Z)', en: 'Undo (⌘Z)', it: 'Annulla (⌘Z)' },
  'hdr.redo': { fr: 'Rétablir (⌘⇧Z)', en: 'Redo (⌘⇧Z)', it: 'Ripristina (⌘⇧Z)' },
  'hdr.pushPrices': { fr: 'Pousser les prix — sync légère, sans re-télécharger les médias', en: 'Push prices — light sync, no media re-download', it: 'Invia i prezzi — sync leggera, senza riscaricare i media' },
  'hdr.publish': { fr: 'Publier sur le réseau — déploie le film choisi', en: 'Publish to the network — deploy the chosen film', it: 'Pubblica in rete — distribuisce il film scelto' },
  'hdr.broadcast': { fr: '🎬 Diffuser', en: '🎬 Broadcast', it: '🎬 Trasmetti' },
  'hdr.broadcastTip': { fr: 'Assistant de diffusion — créer un film et le publier de bout en bout (avec le rapport)', en: 'Broadcast wizard — create a film and publish it end to end (with the report)', it: 'Assistente di trasmissione — crea un film e pubblicalo dall\'inizio alla fine (con il report)' },
  'hdr.report': { fr: 'Rapport de diffusion — lien partageable (bibliothèque, planning, écrans)', en: 'Broadcast report — shareable link (library, schedule, screens)', it: 'Report di trasmissione — link condivisibile (libreria, pianificazione, schermi)' },
  'hdr.onboarding': { fr: 'Mise en route — configurer chaque magasin', en: 'Getting started — set up each store', it: 'Avvio — configura ogni negozio' },
  'hdr.settings': { fr: 'Paramètres — serveur, import PWA & liens', en: 'Settings — server, PWA import & links', it: 'Impostazioni — server, import PWA e link' },

  // -- actions communes --
  'common.save': { fr: 'Enregistrer', en: 'Save', it: 'Salva' },
  'common.saving': { fr: 'Enregistrement…', en: 'Saving…', it: 'Salvataggio…' },
  'common.saved': { fr: '✓ Enregistré', en: '✓ Saved', it: '✓ Salvato' },
  'common.add': { fr: 'Ajouter', en: 'Add', it: 'Aggiungi' },
  'common.delete': { fr: 'Supprimer', en: 'Delete', it: 'Elimina' },
  'common.cancel': { fr: 'Annuler', en: 'Cancel', it: 'Annulla' },
  'common.close': { fr: 'Fermer', en: 'Close', it: 'Chiudi' },
  'common.refresh': { fr: '⟳ Rafraîchir', en: '⟳ Refresh', it: '⟳ Aggiorna' },
  'common.next': { fr: 'Suivant →', en: 'Next →', it: 'Avanti →' },
  'common.back': { fr: '← Retour', en: '← Back', it: '← Indietro' },
  'common.up': { fr: 'Monter', en: 'Move up', it: 'Sposta su' },
  'common.down': { fr: 'Descendre', en: 'Move down', it: 'Sposta giù' },
  'common.active': { fr: 'actif', en: 'active', it: 'attivo' },
  'common.inactive': { fr: 'inactif', en: 'inactive', it: 'inattivo' },
  'common.unsaved': { fr: 'non enregistrée', en: 'unsaved', it: 'non salvato' },

  // -- Accueil (tableau de bord) --
  'home.welcome': { fr: 'Bienvenue dans la régie 👋', en: 'Welcome to the console 👋', it: 'Benvenuto nella console 👋' },
  'home.allReady': { fr: 'Tout est prêt 🎉', en: 'Everything is ready 🎉', it: 'Tutto è pronto 🎉' },
  'home.stepsReady': { fr: '{n}/{total} étapes prêtes.', en: '{n}/{total} steps ready.', it: '{n}/{total} passaggi pronti.' },
  'home.intro': { fr: 'Voici où tu en es et ce qu\'il te reste pour diffuser.', en: 'Here is where you stand and what\'s left to broadcast.', it: 'Ecco a che punto sei e cosa manca per trasmettere.' },
  'home.nowPlaying': { fr: 'Ce qui passe maintenant', en: 'Now playing', it: 'In onda ora' },
  'home.noFilm': { fr: 'Aucun film', en: 'No film', it: 'Nessun film' },
  'home.moment': { fr: 'Moment', en: 'Time of day', it: 'Momento' },
  'home.activeWeek': { fr: 'Semaine active', en: 'Active week', it: 'Settimana attiva' },
  'home.screens': { fr: 'Écrans', en: 'Screens', it: 'Schermi' },
  'home.online': { fr: 'en ligne', en: 'online', it: 'online' },
  'home.readyToBroadcast': { fr: 'Prêt à diffuser', en: 'Ready to broadcast', it: 'Pronto a trasmettere' },
  'home.openWizard': { fr: '🎬 Assistant de diffusion', en: '🎬 Broadcast wizard', it: '🎬 Assistente di trasmissione' },

  // -- moments de la journée --
  'moment.matin': { fr: 'Matin', en: 'Morning', it: 'Mattina' },
  'moment.midi': { fr: 'Midi', en: 'Midday', it: 'Mezzogiorno' },
  'moment.aprem': { fr: 'Après-midi', en: 'Afternoon', it: 'Pomeriggio' },

  // -- Produits --
  'products.title': { fr: 'Table produits', en: 'Product table', it: 'Tabella prodotti' },
  'products.addCategory': { fr: 'Ajouter une catégorie', en: 'Add a category', it: 'Aggiungi una categoria' },
  'products.addProduct': { fr: '+ Ajouter un produit', en: '+ Add a product', it: '+ Aggiungi un prodotto' },

  // -- Promotions --
  'promo.title': { fr: 'Promotions', en: 'Promotions', it: 'Promozioni' },
  'promo.subtitle': { fr: 'Les sous-types de promotion (happy hour, vente flash, bundle, achetez X obtenez Y, remise planifiée, bon d\'achat…) sont gérés ici, pas codés en dur. Chaque type porte une icône, une couleur et un libellé qui composent le badge affiché à l\'écran.', en: 'Promotion subtypes (happy hour, flash sale, bundle, buy X get Y, scheduled discount, voucher…) are managed here, not hard-coded. Each type carries an icon, a color and a label that make up the badge shown on screen.', it: 'I sottotipi di promozione (happy hour, vendita flash, bundle, compra X ricevi Y, sconto pianificato, buono…) si gestiscono qui, non sono fissi nel codice. Ogni tipo ha un\'icona, un colore e un\'etichetta che compongono il badge mostrato sullo schermo.' },
  'promo.addType': { fr: '+ Ajouter une promotion', en: '+ Add a promotion', it: '+ Aggiungi una promozione' },
  'promo.count': { fr: '{n} sous-type(s) de promotion', en: '{n} promotion subtype(s)', it: '{n} sottotipo/i di promozione' },
  'promo.manage': { fr: '🏷️ Gérer les promotions', en: '🏷️ Manage promotions', it: '🏷️ Gestisci le promozioni' },

  // -- Campagnes --
  'campaign.title': { fr: 'Campagnes marketing', en: 'Marketing campaigns', it: 'Campagne marketing' },
  'campaign.subtitle': { fr: 'La liste des campagnes à diffuser (portée produit ou gamme thématique). Tu n\'as ensuite qu\'à en déposer une comme item dans un film.', en: 'The list of campaigns to broadcast (product or themed-range scope). You then just drop one as an item into a film.', it: 'L\'elenco delle campagne da trasmettere (ambito prodotto o gamma tematica). Poi basta inserirne una come elemento in un film.' },
  'campaign.add': { fr: '+ Ajouter une campagne', en: '+ Add a campaign', it: '+ Aggiungi una campagna' },
  'campaign.count': { fr: '{n} campagne(s)', en: '{n} campaign(s)', it: '{n} campagna/e' },
  'campaign.manage': { fr: '📣 Gérer les campagnes', en: '📣 Manage campaigns', it: '📣 Gestisci le campagne' },
  'campaign.scopeProduct': { fr: '📣 Produit', en: '📣 Product', it: '📣 Prodotto' },
  'campaign.scopeRange': { fr: '🗂 Gamme thématique', en: '🗂 Themed range', it: '🗂 Gamma tematica' },

  // -- Périodes (saisons) --
  'seasons.title': { fr: 'Périodes de l\'année', en: 'Periods of the year', it: 'Periodi dell\'anno' },
  'seasons.add': { fr: '+ Ajouter une période', en: '+ Add a period', it: '+ Aggiungi un periodo' },
  'seasons.import': { fr: '⟳ Importer', en: '⟳ Import', it: '⟳ Importa' },
  'seasons.diagnostic': { fr: '🔍 Diagnostic', en: '🔍 Diagnostics', it: '🔍 Diagnostica' },

  // -- Planning --
  'planning.title': { fr: 'Planning hebdomadaire', en: 'Weekly schedule', it: 'Pianificazione settimanale' },

  // -- Réseau & supervision --
  'fleet.title': { fr: 'Réseau & supervision', en: 'Network & monitoring', it: 'Rete e supervisione' },

  // -- Paramètres --
  'settings.title': { fr: 'Paramètres', en: 'Settings', it: 'Impostazioni' },
  'settings.subtitle': { fr: 'Point d\'accès au CMS et test de connexion live d\'un player. Les tests s\'exécutent aussi automatiquement à chaque déploiement.', en: 'CMS endpoint and live connection test for a player. Tests also run automatically on every deployment.', it: 'Endpoint del CMS e test di connessione live di un player. I test vengono eseguiti anche automaticamente a ogni distribuzione.' },
  'settings.serverConn': { fr: 'Serveur & connexion', en: 'Server & connection', it: 'Server e connessione' },

  // -- Compositeur --
  'composer.library': { fr: 'Bibliothèque', en: 'Library', it: 'Libreria' },
  'composer.timeline': { fr: 'ligne du temps', en: 'timeline', it: 'timeline' },
  'composer.playlist': { fr: '▤ Playlist', en: '▤ Playlist', it: '▤ Playlist' },
  'composer.addElement': { fr: '＋ Élément', en: '＋ Element', it: '＋ Elemento' },
  'composer.paste': { fr: 'Coller', en: 'Paste', it: 'Incolla' },
  'composer.selectedModule': { fr: 'Module sélectionné', en: 'Selected module', it: 'Modulo selezionato' },
  'composer.broadcastNetwork': { fr: '🚀 Diffuser sur le réseau ↗', en: '🚀 Broadcast to the network ↗', it: '🚀 Trasmetti alla rete ↗' },

  // -- fil d'Ariane (crumbs) --
  'crumb.screensStores': { fr: '{s} écrans · {m} magasins', en: '{s} screens · {m} stores', it: '{s} schermi · {m} negozi' },
  'crumb.catsProducts': { fr: '{c} catégorie(s) · {p} produit(s)', en: '{c} category(ies) · {p} product(s)', it: '{c} categoria/e · {p} prodotto/i' },
  'crumb.periods': { fr: '{n} période(s)', en: '{n} period(s)', it: '{n} periodo/i' },
  'crumb.promoTypes': { fr: '{n} type(s)', en: '{n} type(s)', it: '{n} tipo/i' },
  'crumb.campaigns': { fr: '{n} campagne(s)', en: '{n} campaign(s)', it: '{n} campagna/e' },
  'crumb.weekStores': { fr: 'Semaine {w} · {m} magasin(s)', en: 'Week {w} · {m} store(s)', it: 'Settimana {w} · {m} negozio/i' },
  'crumb.film': { fr: 'Film : {name}', en: 'Film: {name}', it: 'Film: {name}' },
  'crumb.liaison': { fr: ' (liaison)', en: ' (bridge)', it: ' (transizione)' },
  'products.tableCrumb': { fr: 'Table produits', en: 'Product table', it: 'Tabella prodotti' },
  'planning.weekCrumb': { fr: 'Planning hebdo', en: 'Weekly schedule', it: 'Pianif. settimanale' },

  // -- vues : titres + sous-titres --
  'products.subtitle': { fr: 'Catégories et produits (prix par magasin, langues, rupture). Importable depuis la base PWA.', en: 'Categories and products (per-store prices, languages, out-of-stock). Importable from the PWA database.', it: 'Categorie e prodotti (prezzi per negozio, lingue, esaurito). Importabile dal database PWA.' },
  'seasons.subtitle': { fr: 'Définis les saisons et fêtes (du → au) et les produits liés. Sert à cibler automatiquement les vidéos et animations de saison.', en: 'Define seasons and holidays (from → to) and their linked products. Used to automatically target seasonal videos and animations.', it: 'Definisci stagioni e festività (dal → al) e i prodotti collegati. Serve a mirare automaticamente video e animazioni stagionali.' },
  'planning.subtitle': { fr: '5 modèles de semaine réutilisables (A–E). Choisis les magasins, remplis chaque jour (matin / midi / après-midi), puis active la semaine à diffuser.', en: '5 reusable week templates (A–E). Pick the stores, fill in each day (morning / midday / afternoon), then activate the week to broadcast.', it: '5 modelli di settimana riutilizzabili (A–E). Scegli i negozi, compila ogni giorno (mattina / mezzogiorno / pomeriggio), poi attiva la settimana da trasmettere.' },
  'fleet.subtitle': { fr: 'État en direct des écrans, coordonnées et zones par magasin.', en: 'Live status of screens, contact details and zones per store.', it: 'Stato in tempo reale degli schermi, recapiti e zone per negozio.' },

  // -- Accueil : préparation --
  'home.readyChecklist': { fr: 'Prêt à diffuser ?', en: 'Ready to broadcast?', it: 'Pronto a trasmettere?' },
  'home.stepScreen': { fr: 'Écran connecté', en: 'Screen connected', it: 'Schermo connesso' },
  'home.stepCatalog': { fr: 'Catalogue importé', en: 'Catalog imported', it: 'Catalogo importato' },
  'home.stepFilm': { fr: 'Au moins un film prêt', en: 'At least one film ready', it: 'Almeno un film pronto' },
  'home.stepData': { fr: 'Données du mode continu', en: 'Continuous-mode data', it: 'Dati modalità continua' },

  // -- diffusion flash (override) --
  'override.flash': { fr: 'Diffusion flash', en: 'Flash broadcast', it: 'Trasmissione flash' },
  'override.resume': { fr: 'Reprendre les playlists', en: 'Resume playlists', it: 'Riprendi le playlist' },
  'override.tipOn': { fr: 'Diffusion flash active — les playlists normales sont suspendues. Clique pour reprendre.', en: 'Flash broadcast on — normal playlists are paused. Click to resume.', it: 'Trasmissione flash attiva — le playlist normali sono sospese. Clicca per riprendere.' },
  'override.tipOff': { fr: 'Diffusion flash — pousser un seul film sur tout le réseau, immédiatement.', en: 'Flash broadcast — push a single film to the whole network, immediately.', it: 'Trasmissione flash — invia un solo film a tutta la rete, subito.' },

  // -- info-bulle enregistrement --
  'save.dirty': { fr: 'Enregistrer (⌘S)', en: 'Save (⌘S)', it: 'Salva (⌘S)' },
  'save.clean': { fr: 'Tout est enregistré', en: 'Everything is saved', it: 'Tutto è salvato' },

  // -- assistant de diffusion (étapes) --
  'wiz.step.type': { fr: 'Type', en: 'Type', it: 'Tipo' },
  'wiz.step.content': { fr: 'Contenu', en: 'Content', it: 'Contenuto' },
  'wiz.step.screens': { fr: 'Écrans', en: 'Screens', it: 'Schermi' },
  'wiz.step.preview': { fr: 'Aperçu', en: 'Preview', it: 'Anteprima' },
  'wiz.step.broadcast': { fr: 'Diffusion', en: 'Broadcast', it: 'Trasmissione' },
  'wiz.title': { fr: '🎬 Assistant de diffusion', en: '🎬 Broadcast wizard', it: '🎬 Assistente di trasmissione' },
  'wiz.close': { fr: '✕ Fermer', en: '✕ Close', it: '✕ Chiudi' },
};

// Étapes de l'assistant, dans l'ordre (clés vers I18N).
export const WIZ_STEP_KEYS = ['wiz.step.type', 'wiz.step.content', 'wiz.step.screens', 'wiz.step.preview', 'wiz.step.broadcast'];

// Renvoie la traduction d'une clé pour la langue donnée, avec repli sur le
// français puis sur la clé brute. `vars` remplace les jetons {x}.
export function tr(lang, key, vars) {
  const entry = I18N[key];
  let s = entry ? (entry[lang] != null ? entry[lang] : entry.fr) : key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
