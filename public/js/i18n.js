// Internationalisation de l'interface de régie (back office).
// Quatre langues : français (source), néerlandais (magasins flamands),
// anglais, italien. Cela ne change QUE la
// langue de l'INTERFACE ; la langue affichée à l'écran par magasin reste réglée
// dans Réseau (sig_stores.lang). Choix persisté par navigateur (localStorage).

export const UI_LANGS = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'nl', label: 'Nederlands', short: 'NL' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'it', label: 'Italiano', short: 'IT' },
];

export const UI_LANG_IDS = UI_LANGS.map((l) => l.id);

// Dictionnaire { clé : { fr, nl, en, it } }. La valeur `fr` sert de repli si une
// traduction manque. Interpolation : {x} remplacé par vars.x.
export const I18N = {
  // -- chargement / erreurs / connexion --
  'app.loading': { fr: 'Chargement de la régie…', nl: 'Console laden…', en: 'Loading the console…', it: 'Caricamento della console…' },
  'app.cmsUnreachable': { fr: 'Impossible de joindre le CMS : {err}', nl: 'Kan het CMS niet bereiken: {err}', en: 'Cannot reach the CMS: {err}', it: 'Impossibile raggiungere il CMS: {err}' },
  'app.retry': { fr: 'Réessayer', nl: 'Opnieuw proberen', en: 'Retry', it: 'Riprova' },
  'login.title': { fr: 'Régie d\'affichage', nl: 'Schermbeheer', en: 'Signage console', it: 'Console di gestione' },
  'login.subtitle': { fr: 'Connexion requise pour piloter le réseau', nl: 'Meld je aan om het netwerk te beheren', en: 'Sign in to manage the network', it: 'Accedi per gestire la rete' },
  'login.user': { fr: 'Utilisateur', nl: 'Gebruiker', en: 'Username', it: 'Utente' },
  'login.password': { fr: 'Mot de passe', nl: 'Wachtwoord', en: 'Password', it: 'Password' },
  'login.signIn': { fr: 'Se connecter', nl: 'Aanmelden', en: 'Sign in', it: 'Accedi' },
  'login.signingIn': { fr: 'Connexion…', nl: 'Aanmelden…', en: 'Signing in…', it: 'Accesso…' },
  'login.viewFilm': { fr: '▶ Visualiser le film (sans connexion)', nl: '▶ Film bekijken (zonder aanmelding)', en: '▶ View the film (no sign-in)', it: '▶ Guarda il film (senza accesso)' },

  // -- en-tête / navigation --
  'header.console': { fr: 'Régie d\'affichage', nl: 'Schermbeheer', en: 'Signage console', it: 'Console di gestione' },
  'nav.home': { fr: 'Accueil', nl: 'Start', en: 'Home', it: 'Home' },
  'nav.composer': { fr: 'Compositeur', nl: 'Samensteller', en: 'Composer', it: 'Compositore' },
  'nav.products': { fr: 'Produits', nl: 'Producten', en: 'Products', it: 'Prodotti' },
  'nav.promotions': { fr: 'Promotions', nl: 'Promoties', en: 'Promotions', it: 'Promozioni' },
  'nav.campaigns': { fr: 'Campagnes', nl: 'Campagnes', en: 'Campaigns', it: 'Campagne' },
  'nav.seasons': { fr: 'Périodes', nl: 'Periodes', en: 'Periods', it: 'Periodi' },
  'nav.planning': { fr: 'Planning', nl: 'Planning', en: 'Schedule', it: 'Pianificazione' },
  'nav.fleet': { fr: 'Réseau & supervision', nl: 'Netwerk & toezicht', en: 'Network & monitoring', it: 'Rete e supervisione' },
  'nav.seeFilm': { fr: '▶ Voir le film', nl: '▶ Film bekijken', en: '▶ View film', it: '▶ Vedi film' },
  'nav.uiLang': { fr: 'Langue de l\'interface', nl: 'Taal van de interface', en: 'Interface language', it: 'Lingua dell\'interfaccia' },

  // -- boutons d'en-tête (info-bulles) --
  'hdr.undo': { fr: 'Annuler (⌘Z)', nl: 'Ongedaan maken (⌘Z)', en: 'Undo (⌘Z)', it: 'Annulla (⌘Z)' },
  'hdr.redo': { fr: 'Rétablir (⌘⇧Z)', nl: 'Opnieuw (⌘⇧Z)', en: 'Redo (⌘⇧Z)', it: 'Ripristina (⌘⇧Z)' },
  'hdr.pushPrices': { fr: 'Pousser les prix — sync légère, sans re-télécharger les médias', nl: 'Prijzen doorsturen — lichte sync, zonder de media opnieuw te downloaden', en: 'Push prices — light sync, no media re-download', it: 'Invia i prezzi — sync leggera, senza riscaricare i media' },
  'hdr.publish': { fr: 'Publier sur le réseau — déploie le film choisi', nl: 'Publiceren op het netwerk — zet de gekozen film live', en: 'Publish to the network — deploy the chosen film', it: 'Pubblica in rete — distribuisce il film scelto' },
  'hdr.broadcast': { fr: '🎬 Diffuser', nl: '🎬 Uitzenden', en: '🎬 Broadcast', it: '🎬 Trasmetti' },
  'hdr.broadcastTip': { fr: 'Assistant de diffusion — créer un film et le publier de bout en bout (avec le rapport)', nl: 'Uitzendassistent — een film maken en van begin tot eind publiceren (met het rapport)', en: 'Broadcast wizard — create a film and publish it end to end (with the report)', it: 'Assistente di trasmissione — crea un film e pubblicalo dall\'inizio alla fine (con il report)' },
  'hdr.report': { fr: 'Rapport de diffusion — lien partageable (bibliothèque, planning, écrans)', nl: 'Uitzendrapport — deelbare link (bibliotheek, planning, schermen)', en: 'Broadcast report — shareable link (library, schedule, screens)', it: 'Report di trasmissione — link condivisibile (libreria, pianificazione, schermi)' },
  'hdr.onboarding': { fr: 'Mise en route — configurer chaque magasin', nl: 'Opstarten — elke winkel instellen', en: 'Getting started — set up each store', it: 'Avvio — configura ogni negozio' },
  'hdr.settings': { fr: 'Paramètres — serveur, import PWA & liens', nl: 'Instellingen — server, PWA-import & links', en: 'Settings — server, PWA import & links', it: 'Impostazioni — server, import PWA e link' },

  // -- actions communes --
  'common.save': { fr: 'Enregistrer', nl: 'Opslaan', en: 'Save', it: 'Salva' },
  'common.saving': { fr: 'Enregistrement…', nl: 'Opslaan…', en: 'Saving…', it: 'Salvataggio…' },
  'common.saved': { fr: '✓ Enregistré', nl: '✓ Opgeslagen', en: '✓ Saved', it: '✓ Salvato' },
  'common.add': { fr: 'Ajouter', nl: 'Toevoegen', en: 'Add', it: 'Aggiungi' },
  'common.delete': { fr: 'Supprimer', nl: 'Verwijderen', en: 'Delete', it: 'Elimina' },
  'common.cancel': { fr: 'Annuler', nl: 'Annuleren', en: 'Cancel', it: 'Annulla' },
  'common.close': { fr: 'Fermer', nl: 'Sluiten', en: 'Close', it: 'Chiudi' },
  'common.refresh': { fr: '⟳ Rafraîchir', nl: '⟳ Vernieuwen', en: '⟳ Refresh', it: '⟳ Aggiorna' },
  'common.next': { fr: 'Suivant →', nl: 'Volgende →', en: 'Next →', it: 'Avanti →' },
  'common.back': { fr: '← Retour', nl: '← Terug', en: '← Back', it: '← Indietro' },
  'common.up': { fr: 'Monter', nl: 'Omhoog', en: 'Move up', it: 'Sposta su' },
  'common.down': { fr: 'Descendre', nl: 'Omlaag', en: 'Move down', it: 'Sposta giù' },
  'common.active': { fr: 'actif', nl: 'actief', en: 'active', it: 'attivo' },
  'common.inactive': { fr: 'inactif', nl: 'inactief', en: 'inactive', it: 'inattivo' },
  'common.unsaved': { fr: 'non enregistrée', nl: 'niet opgeslagen', en: 'unsaved', it: 'non salvato' },
  'common.color': { fr: 'Couleur', nl: 'Kleur', en: 'Color', it: 'Colore' },
  'common.unused': { fr: 'non utilisé', nl: 'niet gebruikt', en: 'unused', it: 'non usato' },
  'common.usedBy': { fr: "{n} élément(s) l'utilisent", nl: '{n} element(en) gebruiken dit', en: 'used by {n} element(s)', it: 'usato da {n} elemento/i' },
  'promo.newName': { fr: 'Nouvelle promotion', nl: 'Nieuwe promotie', en: 'New promotion', it: 'Nuova promozione' },
  'campaign.newName': { fr: 'Nouvelle campagne', nl: 'Nieuwe campagne', en: 'New campaign', it: 'Nuova campagna' },

  // -- Accueil (tableau de bord) --
  'home.welcome': { fr: 'Bienvenue dans la régie 👋', nl: 'Welkom in het schermbeheer 👋', en: 'Welcome to the console 👋', it: 'Benvenuto nella console 👋' },
  'home.allReady': { fr: 'Tout est prêt 🎉', nl: 'Alles is klaar 🎉', en: 'Everything is ready 🎉', it: 'Tutto è pronto 🎉' },
  'home.stepsReady': { fr: '{n}/{total} étapes prêtes.', nl: '{n}/{total} stappen klaar.', en: '{n}/{total} steps ready.', it: '{n}/{total} passaggi pronti.' },
  'home.intro': { fr: 'Voici où tu en es et ce qu\'il te reste pour diffuser.', nl: 'Hier zie je waar je staat en wat er nog moet gebeuren om uit te zenden.', en: 'Here is where you stand and what\'s left to broadcast.', it: 'Ecco a che punto sei e cosa manca per trasmettere.' },
  'home.nowPlaying': { fr: 'Ce qui passe maintenant', nl: 'Nu op het scherm', en: 'Now playing', it: 'In onda ora' },
  'home.noFilm': { fr: 'Aucun film', nl: 'Geen film', en: 'No film', it: 'Nessun film' },
  'home.moment': { fr: 'Moment', nl: 'Moment', en: 'Time of day', it: 'Momento' },
  'home.activeWeek': { fr: 'Semaine active', nl: 'Actieve week', en: 'Active week', it: 'Settimana attiva' },
  'home.screens': { fr: 'Écrans', nl: 'Schermen', en: 'Screens', it: 'Schermi' },
  'home.online': { fr: 'en ligne', nl: 'online', en: 'online', it: 'online' },
  'home.readyToBroadcast': { fr: 'Prêt à diffuser', nl: 'Klaar om uit te zenden', en: 'Ready to broadcast', it: 'Pronto a trasmettere' },
  'home.openWizard': { fr: '🎬 Assistant de diffusion', nl: '🎬 Uitzendassistent', en: '🎬 Broadcast wizard', it: '🎬 Assistente di trasmissione' },

  // -- moments de la journée --
  'moment.matin': { fr: 'Matin', nl: 'Ochtend', en: 'Morning', it: 'Mattina' },
  'moment.midi': { fr: 'Midi', nl: 'Middag', en: 'Midday', it: 'Mezzogiorno' },
  'moment.aprem': { fr: 'Après-midi', nl: 'Namiddag', en: 'Afternoon', it: 'Pomeriggio' },

  // -- Produits --
  'products.title': { fr: 'Table produits', nl: 'Productentabel', en: 'Product table', it: 'Tabella prodotti' },
  'products.addCategory': { fr: 'Ajouter une catégorie', nl: 'Categorie toevoegen', en: 'Add a category', it: 'Aggiungi una categoria' },
  'products.addProduct': { fr: '+ Ajouter un produit', nl: '+ Product toevoegen', en: '+ Add a product', it: '+ Aggiungi un prodotto' },

  // -- Promotions --
  'promo.title': { fr: 'Promotions', nl: 'Promoties', en: 'Promotions', it: 'Promozioni' },
  'promo.subtitle': { fr: 'Les sous-types de promotion (happy hour, vente flash, bundle, achetez X obtenez Y, remise planifiée, bon d\'achat…) sont gérés ici, pas codés en dur. Chaque type porte une icône, une couleur et un libellé qui composent le badge affiché à l\'écran.', nl: 'De soorten promoties (happy hour, flashverkoop, bundel, koop X krijg Y, geplande korting, waardebon…) worden hier beheerd, niet in de code. Elk type heeft een icoon, een kleur en een label die samen de badge op het scherm vormen.', en: 'Promotion subtypes (happy hour, flash sale, bundle, buy X get Y, scheduled discount, voucher…) are managed here, not hard-coded. Each type carries an icon, a color and a label that make up the badge shown on screen.', it: 'I sottotipi di promozione (happy hour, vendita flash, bundle, compra X ricevi Y, sconto pianificato, buono…) si gestiscono qui, non sono fissi nel codice. Ogni tipo ha un\'icona, un colore e un\'etichetta che compongono il badge mostrato sullo schermo.' },
  'promo.addType': { fr: '+ Ajouter une promotion', nl: '+ Promotie toevoegen', en: '+ Add a promotion', it: '+ Aggiungi una promozione' },
  'promo.count': { fr: '{n} sous-type(s) de promotion', nl: '{n} soort(en) promotie', en: '{n} promotion subtype(s)', it: '{n} sottotipo/i di promozione' },
  'promo.manage': { fr: '🏷️ Gérer les promotions', nl: '🏷️ Promoties beheren', en: '🏷️ Manage promotions', it: '🏷️ Gestisci le promozioni' },

  // -- Campagnes --
  'campaign.title': { fr: 'Campagnes marketing', nl: 'Marketingcampagnes', en: 'Marketing campaigns', it: 'Campagne marketing' },
  'campaign.subtitle': { fr: 'La liste des campagnes à diffuser (portée produit ou gamme thématique). Tu n\'as ensuite qu\'à en déposer une comme item dans un film.', nl: 'De lijst van uit te zenden campagnes (voor een product of een thematisch gamma). Daarna hoef je er alleen nog één als item in een film te zetten.', en: 'The list of campaigns to broadcast (product or themed-range scope). You then just drop one as an item into a film.', it: 'L\'elenco delle campagne da trasmettere (ambito prodotto o gamma tematica). Poi basta inserirne una come elemento in un film.' },
  'campaign.add': { fr: '+ Ajouter une campagne', nl: '+ Campagne toevoegen', en: '+ Add a campaign', it: '+ Aggiungi una campagna' },
  'campaign.count': { fr: '{n} campagne(s)', nl: '{n} campagne(s)', en: '{n} campaign(s)', it: '{n} campagna/e' },
  'campaign.manage': { fr: '📣 Gérer les campagnes', nl: '📣 Campagnes beheren', en: '📣 Manage campaigns', it: '📣 Gestisci le campagne' },
  'campaign.scopeProduct': { fr: '📣 Produit', nl: '📣 Product', en: '📣 Product', it: '📣 Prodotto' },
  'campaign.scopeRange': { fr: '🗂 Gamme thématique', nl: '🗂 Thematisch gamma', en: '🗂 Themed range', it: '🗂 Gamma tematica' },

  // -- Périodes (saisons) --
  'seasons.title': { fr: 'Périodes de l\'année', nl: 'Periodes van het jaar', en: 'Periods of the year', it: 'Periodi dell\'anno' },
  'seasons.add': { fr: '+ Ajouter une période', nl: '+ Periode toevoegen', en: '+ Add a period', it: '+ Aggiungi un periodo' },
  'seasons.import': { fr: '⟳ Importer', nl: '⟳ Importeren', en: '⟳ Import', it: '⟳ Importa' },
  'seasons.diagnostic': { fr: '🔍 Diagnostic', nl: '🔍 Diagnose', en: '🔍 Diagnostics', it: '🔍 Diagnostica' },

  // -- Planning --
  'planning.title': { fr: 'Planning hebdomadaire', nl: 'Weekplanning', en: 'Weekly schedule', it: 'Pianificazione settimanale' },

  // -- Réseau & supervision --
  'fleet.title': { fr: 'Réseau & supervision', nl: 'Netwerk & toezicht', en: 'Network & monitoring', it: 'Rete e supervisione' },

  // -- Paramètres --
  'settings.title': { fr: 'Paramètres', nl: 'Instellingen', en: 'Settings', it: 'Impostazioni' },
  'settings.subtitle': { fr: 'Point d\'accès au CMS et test de connexion live d\'un player. Les tests s\'exécutent aussi automatiquement à chaque déploiement.', nl: 'Toegangspunt van het CMS en live verbindingstest van een speler. De tests lopen ook automatisch bij elke uitrol.', en: 'CMS endpoint and live connection test for a player. Tests also run automatically on every deployment.', it: 'Endpoint del CMS e test di connessione live di un player. I test vengono eseguiti anche automaticamente a ogni distribuzione.' },
  'settings.serverConn': { fr: 'Serveur & connexion', nl: 'Server & verbinding', en: 'Server & connection', it: 'Server e connessione' },

  // -- Compositeur --
  'composer.library': { fr: 'Bibliothèque', nl: 'Bibliotheek', en: 'Library', it: 'Libreria' },
  'composer.timeline': { fr: 'ligne du temps', nl: 'tijdlijn', en: 'timeline', it: 'timeline' },
  'composer.playlist': { fr: '▤ Playlist', nl: '▤ Playlist', en: '▤ Playlist', it: '▤ Playlist' },
  'composer.addElement': { fr: '＋ Élément', nl: '＋ Element', en: '＋ Element', it: '＋ Elemento' },
  'composer.paste': { fr: 'Coller', nl: 'Plakken', en: 'Paste', it: 'Incolla' },
  'composer.selectedModule': { fr: 'Module sélectionné', nl: 'Geselecteerde module', en: 'Selected module', it: 'Modulo selezionato' },
  'composer.broadcastNetwork': { fr: '🚀 Diffuser sur le réseau ↗', nl: '🚀 Uitzenden op het netwerk ↗', en: '🚀 Broadcast to the network ↗', it: '🚀 Trasmetti alla rete ↗' },

  // -- fil d'Ariane (crumbs) --
  'crumb.screensStores': { fr: '{s} écrans · {m} magasins', nl: '{s} schermen · {m} winkels', en: '{s} screens · {m} stores', it: '{s} schermi · {m} negozi' },
  'crumb.catsProducts': { fr: '{c} catégorie(s) · {p} produit(s)', nl: '{c} categorie(ën) · {p} product(en)', en: '{c} category(ies) · {p} product(s)', it: '{c} categoria/e · {p} prodotto/i' },
  'crumb.periods': { fr: '{n} période(s)', nl: '{n} periode(s)', en: '{n} period(s)', it: '{n} periodo/i' },
  'crumb.promoTypes': { fr: '{n} type(s)', nl: '{n} soort(en)', en: '{n} type(s)', it: '{n} tipo/i' },
  'crumb.campaigns': { fr: '{n} campagne(s)', nl: '{n} campagne(s)', en: '{n} campaign(s)', it: '{n} campagna/e' },
  'crumb.weekStores': { fr: 'Semaine {w} · {m} magasin(s)', nl: 'Week {w} · {m} winkel(s)', en: 'Week {w} · {m} store(s)', it: 'Settimana {w} · {m} negozio/i' },
  'crumb.film': { fr: 'Film : {name}', nl: 'Film: {name}', en: 'Film: {name}', it: 'Film: {name}' },
  'crumb.liaison': { fr: ' (liaison)', nl: ' (overgang)', en: ' (bridge)', it: ' (transizione)' },
  'products.tableCrumb': { fr: 'Table produits', nl: 'Productentabel', en: 'Product table', it: 'Tabella prodotti' },
  'planning.weekCrumb': { fr: 'Planning hebdo', nl: 'Weekplanning', en: 'Weekly schedule', it: 'Pianif. settimanale' },

  // -- vues : titres + sous-titres --
  'products.subtitle': { fr: 'Catégories et produits (prix par magasin, langues, rupture). Importable depuis la base PWA.', nl: 'Categorieën en producten (prijs per winkel, talen, uitverkocht). Te importeren uit de PWA-database.', en: 'Categories and products (per-store prices, languages, out-of-stock). Importable from the PWA database.', it: 'Categorie e prodotti (prezzi per negozio, lingue, esaurito). Importabile dal database PWA.' },
  'seasons.subtitle': { fr: 'Définis les saisons et fêtes (du → au) et les produits liés. Sert à cibler automatiquement les vidéos et animations de saison.', nl: 'Bepaal de seizoenen en feestdagen (van → tot) en de gekoppelde producten. Zo worden seizoensvideo\'s en -animaties automatisch gericht ingezet.', en: 'Define seasons and holidays (from → to) and their linked products. Used to automatically target seasonal videos and animations.', it: 'Definisci stagioni e festività (dal → al) e i prodotti collegati. Serve a mirare automaticamente video e animazioni stagionali.' },
  'planning.subtitle': { fr: '5 modèles de semaine réutilisables (A–E). Choisis les magasins, remplis chaque jour (matin / midi / après-midi), puis active la semaine à diffuser.', nl: '5 herbruikbare weekmodellen (A–E). Kies de winkels, vul elke dag in (ochtend / middag / namiddag) en activeer dan de week die uitgezonden moet worden.', en: '5 reusable week templates (A–E). Pick the stores, fill in each day (morning / midday / afternoon), then activate the week to broadcast.', it: '5 modelli di settimana riutilizzabili (A–E). Scegli i negozi, compila ogni giorno (mattina / mezzogiorno / pomeriggio), poi attiva la settimana da trasmettere.' },
  'fleet.subtitle': { fr: 'État en direct des écrans, coordonnées et zones par magasin.', nl: 'Live status van de schermen, gegevens en zones per winkel.', en: 'Live status of screens, contact details and zones per store.', it: 'Stato in tempo reale degli schermi, recapiti e zone per negozio.' },

  // -- Accueil : préparation --
  'home.readyChecklist': { fr: 'Prêt à diffuser ?', nl: 'Klaar om uit te zenden?', en: 'Ready to broadcast?', it: 'Pronto a trasmettere?' },
  'home.stepScreen': { fr: 'Écran connecté', nl: 'Scherm verbonden', en: 'Screen connected', it: 'Schermo connesso' },
  'home.stepCatalog': { fr: 'Catalogue importé', nl: 'Catalogus geïmporteerd', en: 'Catalog imported', it: 'Catalogo importato' },
  'home.stepFilm': { fr: 'Au moins un film prêt', nl: 'Minstens één film klaar', en: 'At least one film ready', it: 'Almeno un film pronto' },
  'home.stepData': { fr: 'Données du mode continu', nl: 'Gegevens voor de doorlopende modus', en: 'Continuous-mode data', it: 'Dati modalità continua' },

  // -- diffusion flash (override) --
  'override.flash': { fr: 'Diffusion flash', nl: 'Flash-uitzending', en: 'Flash broadcast', it: 'Trasmissione flash' },
  'override.resume': { fr: 'Reprendre les playlists', nl: 'Playlists hervatten', en: 'Resume playlists', it: 'Riprendi le playlist' },
  'override.tipOn': { fr: 'Diffusion flash active — les playlists normales sont suspendues. Clique pour reprendre.', nl: 'Flash-uitzending actief — de gewone playlists zijn onderbroken. Klik om te hervatten.', en: 'Flash broadcast on — normal playlists are paused. Click to resume.', it: 'Trasmissione flash attiva — le playlist normali sono sospese. Clicca per riprendere.' },
  'override.tipOff': { fr: 'Diffusion flash — pousser un seul film sur tout le réseau, immédiatement.', nl: 'Flash-uitzending — één film meteen op het hele netwerk zetten.', en: 'Flash broadcast — push a single film to the whole network, immediately.', it: 'Trasmissione flash — invia un solo film a tutta la rete, subito.' },

  // -- info-bulle enregistrement --
  'save.dirty': { fr: 'Enregistrer (⌘S)', nl: 'Opslaan (⌘S)', en: 'Save (⌘S)', it: 'Salva (⌘S)' },
  'save.clean': { fr: 'Tout est enregistré', nl: 'Alles is opgeslagen', en: 'Everything is saved', it: 'Tutto è salvato' },

  // -- assistant de diffusion (étapes) --
  'wiz.step.type': { fr: 'Type', nl: 'Type', en: 'Type', it: 'Tipo' },
  'wiz.step.content': { fr: 'Contenu', nl: 'Inhoud', en: 'Content', it: 'Contenuto' },
  'wiz.step.screens': { fr: 'Écrans', nl: 'Schermen', en: 'Screens', it: 'Schermi' },
  'wiz.step.preview': { fr: 'Aperçu', nl: 'Voorbeeld', en: 'Preview', it: 'Anteprima' },
  'wiz.step.broadcast': { fr: 'Diffusion', nl: 'Uitzending', en: 'Broadcast', it: 'Trasmissione' },
  'wiz.title': { fr: '🎬 Assistant de diffusion', nl: '🎬 Uitzendassistent', en: '🎬 Broadcast wizard', it: '🎬 Assistente di trasmissione' },
  'wiz.close': { fr: '✕ Fermer', nl: '✕ Sluiten', en: '✕ Close', it: '✕ Chiudi' },

  // -- secteurs d'écrans (zones d'un magasin) --
  'sector.plural': { fr: 'Secteurs d\'écrans', nl: 'Schermsectoren', en: 'Screen sectors', it: 'Settori di schermi' },
  'sector.add': { fr: '+ Ajouter un secteur', nl: '+ Sector toevoegen', en: '+ Add a sector', it: '+ Aggiungi un settore' },
  'sector.namePlaceholder': { fr: 'Nom du secteur', nl: 'Naam van de sector', en: 'Sector name', it: 'Nome del settore' },
  'sector.newName': { fr: 'Nouveau secteur', nl: 'Nieuwe sector', en: 'New sector', it: 'Nuovo settore' },
  'sector.screens': { fr: 'Écrans', nl: 'Schermen', en: 'Screens', it: 'Schermi' },
  'sector.screenCount': { fr: 'Nombre d\'écrans du secteur', nl: 'Aantal schermen van de sector', en: 'Number of screens in the sector', it: 'Numero di schermi del settore' },
  'sector.screenSize': { fr: 'Diagonale d\'une dalle', nl: 'Diagonaal van één paneel', en: 'Diagonal of one panel', it: 'Diagonale di un pannello' },
  'sector.orient': { fr: 'Position des écrans', nl: 'Stand van de schermen', en: 'Screen orientation', it: 'Orientamento degli schermi' },
  'sector.portrait': { fr: 'Portrait', nl: 'Staand', en: 'Portrait', it: 'Verticale' },
  'sector.landscape': { fr: 'Paysage', nl: 'Liggend', en: 'Landscape', it: 'Orizzontale' },
  'sector.categories': { fr: 'Catégories :', nl: 'Categorieën:', en: 'Categories:', it: 'Categorie:' },
  'sector.noCatFollows': { fr: 'aucune = suit le film du magasin', nl: 'geen = volgt de film van de winkel', en: 'none = follows the store film', it: 'nessuna = segue il film del negozio' },
  'sector.addCat': { fr: '+ catégorie…', nl: '+ categorie…', en: '+ category…', it: '+ categoria…' },
  'sector.filters': { fr: 'Ce secteur filtre :', nl: 'Deze sector filtert:', en: 'This sector filters:', it: 'Questo settore filtra:' },
  'sector.filterMoments': { fr: 'Les périodes', nl: 'De periodes', en: 'Sale periods', it: 'Le fasce orarie' },
  'sector.filterCats': { fr: 'Les catégories', nl: 'De categorieën', en: 'Categories', it: 'Le categorie' },
  'sector.filterMomentsHelp': {
    fr: 'Oui : le secteur ne montre que les produits vendus au moment courant (matin / midi / après-midi), selon les tags de période. Non : il diffuse toute la journée sans tenir compte des périodes.', nl: 'Ja: de sector toont alleen de producten die op het huidige moment verkocht worden (ochtend / middag / namiddag), volgens de periodetags. Nee: hij zendt de hele dag uit, ongeacht de periodes.',
    en: 'On: the sector only shows products sold at the current moment (morning / noon / afternoon), per the period tags. Off: it plays all day regardless of periods.',
    it: 'Sì: il settore mostra solo i prodotti venduti nel momento corrente (mattina / mezzogiorno / pomeriggio), secondo i tag di fascia. No: trasmette tutto il giorno senza tenere conto delle fasce.',
  },
  'sector.filterCatsHelp': {
    fr: 'Oui : seules les catégories choisies ci-dessous passent sur ce secteur. Non : tout le catalogue passe (les catégories choisies sont gardées en mémoire).', nl: 'Ja: alleen de hieronder gekozen categorieën komen op deze sector. Nee: de hele catalogus komt aan bod (de gekozen categorieën blijven bewaard).',
    en: 'On: only the categories chosen below play on this sector. Off: the whole catalogue plays (the chosen categories are kept in memory).',
    it: 'Sì: solo le categorie scelte qui sotto passano su questo settore. No: passa tutto il catalogo (le categorie scelte restano in memoria).',
  },
  'sector.noFilter': { fr: 'aucun filtre = suit le film du magasin', nl: 'geen filter = volgt de film van de winkel', en: 'no filter = follows the store film', it: 'nessun filtro = segue il film del negozio' },
  'sector.preview': { fr: '↗ Aperçu', nl: '↗ Voorbeeld', en: '↗ Preview', it: '↗ Anteprima' },
  'sector.delete': { fr: 'Supprimer le secteur', nl: 'Sector verwijderen', en: 'Delete the sector', it: 'Elimina il settore' },
  'sector.storeFilm': { fr: '🏬 Film du magasin', nl: '🏬 Film van de winkel', en: '🏬 Store film', it: '🏬 Film del negozio' },
  'sector.playerPick': { fr: 'Secteur d\'écrans de ce magasin, ou film du magasin', nl: 'Schermsector van deze winkel, of film van de winkel', en: 'Screen sector of this store, or the store film', it: 'Settore di schermi di questo negozio, o film del negozio' },
  'sector.added': { fr: 'Secteur d\'écrans ajouté ✓', nl: 'Schermsector toegevoegd ✓', en: 'Screen sector added ✓', it: 'Settore di schermi aggiunto ✓' },
  'sector.deleted': { fr: 'Secteur supprimé ✓', nl: 'Sector verwijderd ✓', en: 'Sector deleted ✓', it: 'Settore eliminato ✓' },
  'sector.delConfirm': { fr: 'Supprimer ce secteur ? Les écrans rattachés repassent au film du magasin.', nl: 'Deze sector verwijderen? De gekoppelde schermen gaan terug naar de film van de winkel.', en: 'Delete this sector? Attached screens go back to the store film.', it: 'Eliminare questo settore? Gli schermi collegati tornano al film del negozio.' },
  'sector.help': { fr: 'Un magasin peut avoir plusieurs SECTEURS d\'écrans, chacun avec SA position (portrait ou paysage), SON nombre d\'écrans et SES filtres — configuration totalement indépendante d\'un secteur à l\'autre. Chaque secteur dit ce qu\'il filtre : les PÉRIODES (n\'afficher que ce qui se vend au moment courant) et/ou les CATÉGORIES (n\'afficher que celles choisies). Un secteur qui ne filtre rien suit le film du magasin. Rattache un écran à un secteur dans sa ligne.', nl: 'Een winkel kan meerdere SECTOREN van schermen hebben, elk met ZIJN EIGEN stand (staand of liggend), ZIJN EIGEN aantal schermen en ZIJN EIGEN filters — volledig onafhankelijk van sector tot sector. Elke sector bepaalt wat hij filtert: de PERIODES (alleen tonen wat op het huidige moment verkocht wordt) en/of de CATEGORIEËN (alleen de gekozen tonen). Een sector die niets filtert, volgt de film van de winkel. Koppel een scherm aan een sector in zijn rij.', en: 'A store can have several screen SECTORS, each with ITS OWN orientation (portrait or landscape), ITS OWN screen count and ITS OWN filters — fully independent from one sector to the next. Each sector states what it filters: the PERIODS (only show what sells at the current moment) and/or the CATEGORIES (only show the chosen ones). A sector that filters nothing follows the store film. Attach a screen to a sector in its row.', it: 'Un negozio può avere più SETTORI di schermi, ognuno con IL SUO orientamento (verticale o orizzontale), IL SUO numero di schermi e I SUOI filtri — configurazione totalmente indipendente da un settore all\'altro. Ogni settore dichiara cosa filtra: le FASCE ORARIE (mostrare solo ciò che si vende nel momento corrente) e/o le CATEGORIE (mostrare solo quelle scelte). Un settore che non filtra nulla segue il film del negozio. Collega uno schermo a un settore nella sua riga.' },

  // -- bundles TFBuddy (page Promotions, éditeur d'élément) --
  'bundles.days': { fr: 'Lun,Mar,Mer,Jeu,Ven,Sam,Dim', nl: 'Ma,Di,Wo,Do,Vr,Za,Zo', en: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', it: 'Lun,Mar,Mer,Gio,Ven,Sab,Dom' },
  'bundles.always': { fr: 'tous les jours, à toute heure', nl: 'elke dag, op elk uur', en: 'every day, at any time', it: 'tutti i giorni, a ogni ora' },
  'bundles.everyDay': { fr: 'Tous les jours', nl: 'Elke dag', en: 'Every day', it: 'Tutti i giorni' },
  'bundles.allDay': { fr: 'toute la journée', nl: 'de hele dag', en: 'all day', it: 'tutto il giorno' },
  'bundles.synced': { fr: 'Bundles TFBuddy synchronisés ✓ ({n})', nl: 'TFBuddy-bundels gesynchroniseerd ✓ ({n})', en: 'TFBuddy bundles synced ✓ ({n})', it: 'Bundle TFBuddy sincronizzati ✓ ({n})' },
  'bundles.noType': { fr: 'Type d\'élément « bundle » absent — relancer le serveur', nl: 'Elementtype « bundle » ontbreekt — herstart de server', en: 'Element type « bundle » missing — restart the server', it: 'Tipo di elemento « bundle » assente — riavviare il server' },
  'bundles.toPick': { fr: 'à choisir', nl: 'te kiezen', en: 'to choose', it: 'da scegliere' },
  'bundles.allShops': { fr: 'Tous les magasins', nl: 'Alle winkels', en: 'All stores', it: 'Tutti i negozi' },
  'bundles.shopsUnmapped': { fr: '{n} magasin(s) TFBuddy non relié(s)', nl: '{n} TFBuddy-winkel(s) niet gekoppeld', en: '{n} TFBuddy store(s) not linked', it: '{n} negozio/i TFBuddy non collegato/i' },
  'bundles.justNow': { fr: 'à l\'instant', nl: 'zonet', en: 'just now', it: 'proprio ora' },
  'bundles.minAgo': { fr: 'il y a {n} min', nl: '{n} min geleden', en: '{n} min ago', it: '{n} min fa' },
  'bundles.hAgo': { fr: 'il y a {n} h', nl: '{n} u geleden', en: '{n} h ago', it: '{n} h fa' },
  'bundles.notConfigured': { fr: 'Compte TFBuddy non configuré : ajoute les secrets GitHub TFBUDDY_PHONE et TFBUDDY_PASSWORD (un compte qui a le droit MENU.BUNDLE.MANAGE), puis relance la livraison.', nl: 'TFBuddy-account niet ingesteld: voeg de GitHub-secrets TFBUDDY_PHONE en TFBUDDY_PASSWORD toe (een account met het recht MENU.BUNDLE.MANAGE) en start de levering opnieuw.', en: 'TFBuddy account not configured: add the GitHub secrets TFBUDDY_PHONE and TFBUDDY_PASSWORD (an account with the MENU.BUNDLE.MANAGE right), then run the delivery again.', it: 'Account TFBuddy non configurato: aggiungi i secret GitHub TFBUDDY_PHONE e TFBUDDY_PASSWORD (un account con il diritto MENU.BUNDLE.MANAGE), poi rilancia la consegna.' },
  'bundles.lastOk': { fr: 'dernière synchro réussie : {at}', nl: 'laatste geslaagde synchronisatie: {at}', en: 'last successful sync: {at}', it: 'ultima sincronizzazione riuscita: {at}' },
  'bundles.syncedAgo': { fr: 'Synchronisé {ago} · {n} bundle(s), {a} actif(s) · compte TFBuddy « {account} »', nl: 'Gesynchroniseerd {ago} · {n} bundel(s), {a} actief · TFBuddy-account « {account} »', en: 'Synced {ago} · {n} bundle(s), {a} active · TFBuddy account « {account} »', it: 'Sincronizzato {ago} · {n} bundle, {a} attivo/i · account TFBuddy « {account} »' },
  'bundles.never': { fr: 'Pas encore synchronisé — « Synchroniser » pour lire TFBuddy maintenant.', nl: 'Nog niet gesynchroniseerd — « Synchroniseren » om TFBuddy nu te lezen.', en: 'Not synced yet — « Sync » reads TFBuddy now.', it: 'Non ancora sincronizzato — « Sincronizza » per leggere TFBuddy ora.' },
  'bundles.warnShops': { fr: 'Magasins TFBuddy non reliés à la régie : {ids} — leurs bundles n\'y passent pas (relier via l\'import PWA, Réglages avancés).', nl: 'TFBuddy-winkels niet gekoppeld aan de console: {ids} — hun bundels worden daar niet getoond (koppelen via de PWA-import, Geavanceerde instellingen).', en: 'TFBuddy stores not linked to the console: {ids} — their bundles do not play there (link them in the PWA import, Advanced settings).', it: 'Negozi TFBuddy non collegati alla console: {ids} — i loro bundle non passano lì (collegarli nell\'import PWA, Impostazioni avanzate).' },
  'bundles.warnProducts': { fr: 'Produits TFBuddy absents du catalogue : {ids} — relancer l\'import PWA pour les avoir avec photo et prix.', nl: 'TFBuddy-producten ontbreken in de catalogus: {ids} — start de PWA-import opnieuw om ze met foto en prijs te krijgen.', en: 'TFBuddy products missing from the catalogue: {ids} — run the PWA import again to get them with photo and price.', it: 'Prodotti TFBuddy assenti dal catalogo: {ids} — rilancia l\'import PWA per averli con foto e prezzo.' },
  'bundles.editorTitle': { fr: 'Bundle à diffuser', nl: 'Te tonen bundel', en: 'Bundle to show', it: 'Bundle da trasmettere' },
  'bundles.editorHelp': { fr: 'Choisis un bundle TFBuddy : son nom, son prix, ses produits et ses créneaux viennent de TFBuddy. À l\'écran, il ne passe qu\'à ses jours et heures, dans ses magasins, et disparaît si un de ses produits est épuisé.', nl: 'Kies een TFBuddy-bundel: naam, prijs, producten en tijdvakken komen uit TFBuddy. Op het scherm verschijnt hij alleen op zijn dagen en uren, in zijn winkels, en verdwijnt hij als een van zijn producten uitverkocht is.', en: 'Pick a TFBuddy bundle: its name, price, products and time slots come from TFBuddy. On screen it only plays on its days and hours, in its stores, and disappears if one of its products is sold out.', it: 'Scegli un bundle TFBuddy: nome, prezzo, prodotti e fasce orarie vengono da TFBuddy. Sullo schermo passa solo nei suoi giorni e orari, nei suoi negozi, e scompare se uno dei suoi prodotti è esaurito.' },
  'bundles.manage': { fr: '🎁 Voir les bundles', nl: '🎁 Bundels bekijken', en: '🎁 See the bundles', it: '🎁 Vedi i bundle' },
  'bundles.pick': { fr: '— Choisir un bundle —', nl: '— Kies een bundel —', en: '— Choose a bundle —', it: '— Scegli un bundle —' },
  'bundles.inactiveNote': { fr: 'Ce bundle n\'est pas actif dans TFBuddy : il ne passe pas à l\'écran.', nl: 'Deze bundel is niet actief in TFBuddy: hij verschijnt niet op het scherm.', en: 'This bundle is not active in TFBuddy: it does not play on screen.', it: 'Questo bundle non è attivo in TFBuddy: non passa sullo schermo.' },
  'bundles.noneYet': { fr: 'Aucun bundle TFBuddy synchronisé.', nl: 'Geen TFBuddy-bundel gesynchroniseerd.', en: 'No TFBuddy bundle synced.', it: 'Nessun bundle TFBuddy sincronizzato.' },
  'bundles.goSync': { fr: 'Synchroniser les bundles →', nl: 'Bundels synchroniseren →', en: 'Sync the bundles →', it: 'Sincronizza i bundle →' },
  'bundles.title': { fr: '🎁 Bundles TFBuddy · {n}', nl: '🎁 TFBuddy-bundels · {n}', en: '🎁 TFBuddy bundles · {n}', it: '🎁 Bundle TFBuddy · {n}' },
  'bundles.subtitle': { fr: 'Tes bundles, lus sur l\'API TFBuddy (comme le cockpit consultant) : prix du bundle, produits et quantités, magasins, jours et heures. Ils se modifient dans TFBuddy ; ici, tu choisis lesquels diffuser.', nl: 'Je bundels, gelezen via de TFBuddy-API (zoals de consultant-cockpit): bundelprijs, producten en aantallen, winkels, dagen en uren. Je wijzigt ze in TFBuddy; hier kies je welke je toont.', en: 'Your bundles, read from the TFBuddy API (like the consultant cockpit): bundle price, products and quantities, stores, days and hours. You edit them in TFBuddy; here you pick which ones to show.', it: 'I tuoi bundle, letti dall\'API TFBuddy (come il cockpit consulente): prezzo del bundle, prodotti e quantità, negozi, giorni e orari. Si modificano in TFBuddy; qui scegli quali trasmettere.' },
  'bundles.sync': { fr: '⟳ Synchroniser', nl: '⟳ Synchroniseren', en: '⟳ Sync', it: '⟳ Sincronizza' },
  'bundles.syncing': { fr: 'Synchronisation…', nl: 'Synchroniseren…', en: 'Syncing…', it: 'Sincronizzazione…' },
  'bundles.voucher': { fr: 'sur bon d\'achat', nl: 'met waardebon', en: 'voucher only', it: 'solo con buono' },
  'bundles.missingProduct': { fr: 'Produit absent du catalogue de la régie', nl: 'Product ontbreekt in de catalogus van de console', en: 'Product missing from the console catalogue', it: 'Prodotto assente dal catalogo della console' },
  'bundles.imgPlaceholder': { fr: 'Visuel (optionnel) : URL ou chemin, ex. media/petit-dej.jpg', nl: 'Beeld (optioneel): URL of pad, bv. media/ontbijt.jpg', en: 'Visual (optional): URL or path, e.g. media/breakfast.jpg', it: 'Immagine (facoltativa): URL o percorso, es. media/colazione.jpg' },
  'bundles.create': { fr: '＋ Créer l\'élément', nl: '＋ Element maken', en: '＋ Create the element', it: '＋ Crea l\'elemento' },
  'bundles.emptyOff': { fr: 'Rien à afficher tant que le compte TFBuddy n\'est pas configuré.', nl: 'Niets te tonen zolang het TFBuddy-account niet is ingesteld.', en: 'Nothing to show until the TFBuddy account is configured.', it: 'Niente da mostrare finché l\'account TFBuddy non è configurato.' },
  'bundles.empty': { fr: 'Aucun bundle dans TFBuddy.', nl: 'Geen bundels in TFBuddy.', en: 'No bundles in TFBuddy.', it: 'Nessun bundle in TFBuddy.' },
  'bundles.footer': { fr: 'Synchro automatique toutes les 30 minutes. Un changement dans TFBuddy (prix, produits, créneaux) arrive sur les écrans sans republier ; un bundle n\'y passe que s\'il est ACTIF.', nl: 'Automatische synchronisatie elke 30 minuten. Een wijziging in TFBuddy (prijs, producten, tijdvakken) komt op de schermen zonder opnieuw te publiceren; een bundel verschijnt alleen als hij ACTIEF is.', en: 'Automatic sync every 30 minutes. A change in TFBuddy (price, products, time slots) reaches the screens without republishing; a bundle only plays when it is ACTIVE.', it: 'Sincronizzazione automatica ogni 30 minuti. Una modifica in TFBuddy (prezzo, prodotti, fasce orarie) arriva sugli schermi senza ripubblicare; un bundle passa solo se è ATTIVO.' },
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
