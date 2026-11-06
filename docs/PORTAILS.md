# Les quatre portails — registre de la réorganisation

Décision du 06/11/2026 : il ne reste que **quatre portails et quatre dépôts**, chacun avec **son préfixe de
tables**, tous dans la base de l'ERP, chacun exportable seul vers l'ERP à la fin du bac à sable.

| Portail | Préfixe | Dépôt | Ce qu'il absorbe |
|---|---|---|---|
| **Recrutement & développement** | `rec_` | `atelier-espace-candidat` → renommé `recrutement` | CRM candidats, espace candidat, page franchise, agences, expansion, réseau, guides, newsletters du réseau, **scouting** (dépôt `scouting`, vide, archivé) |
| **Marketing** | `mar_` | `marketing` | **Social** (`mar_sa_`), les tables `mar_` du cockpit (newsletter clients, avis, contrôle des posts, campagnes), MétaDonnée, fidélité, **signage** (`sig_` → `mar_sig_`) |
| **Pilotage réseau** | `pil_` | `consultant_BO` → renommé `pilotage-reseau` | cockpit CEO (`ceo_`), visites (`con_`), **PWA consultant** (`mac_`), dashboard magasin, contrôles, suivi, **planogramme** (`pla_`), **app employés et primes** (`mot_`) |
| **Formations** | `frm_` | nouveau dépôt `formations` | module Formation et livret des vendeuses du cockpit, manuel opératoire (`crm_mo_`) et formateurs (`crm_fmt_`) du CRM |

Restent hors des portails : l'ERP lui-même (sa copie `/production`, tables `n_` / `tfb_`, sort du cockpit
pour vivre avec l'ERP), le site public `landing` (`lp_`, **à décider**), et les dépôts sans rapport
(webshop, kitchen, msc…).

## Règles communes (ce qui rend un portail exportable)

1. **Une base** : celle de l'ERP. Un portail ne crée, ne modifie et ne supprime **que** ses tables
   `préfixe_`. Les tables de l'ERP sont en lecture ; celles d'un **autre portail ne sont jamais lues** :
   on passe par son API.
2. **Réglages et secrets** : `préfixe_variable` (réglages) et `préfixe_keys` (secrets chiffrés), lus par
   `Config::get` / `Keys::get`. Dans l'environnement : l'accès à la base, la clé maîtresse et
   l'identité de développement, rien d'autre.
3. **Migrations** : `db/migrations/`, rejouables deux fois ; une vue n'a qu'une définition, dans un
   fichier `_vues`. Pendant une bascule de nom, une vue `ancien_nom` → `nouveau_nom` garde l'ancien
   code en vie ; elle est supprimée quand plus rien ne la lit.
4. **Connexion commune** : identifiants de l'ERP, cookie de session signé partagé par les quatre
   portails ; jeton de service entre portails. Même rail, même design system
   (`docs/DESIGN_SYSTEM.md`).
5. **Kit d'export** : chaque dépôt a un `bin/export.sh` qui sort ses tables `préfixe_%` (structure et
   données), ses migrations et la liste des réglages et clés à reporter. Installé dans l'ERP, il
   n'a besoin d'aucun autre portail.

## Les API

- **Écrans** : `/api/v1/{app}/{portail}/{ressource}` — `app` ∈ `admin | consultant | franchise | public
  | pwa`, portail ∈ `recrutement | marketing | pilotage | formations`. Exemple :
  `/api/v1/public/recrutement/candidatures`, `/api/v1/consultant/pilotage/visites`.
- **Entre portails** : `/api/v1/integration/{portail}/{ressource}`, jeton de service. Exemples :
  Pilotage lit les campagnes de Marketing ; Recrutement pousse un franchisé signé vers Pilotage ;
  Recrutement lit les chiffres des magasins chez Pilotage (déjà le cas, `GET /stores`) ; Social lit
  les avis et la réputation des boutiques chez Pilotage au lieu de `ceo_shop_review`.
- **TFBuddy (`atelierby.tfbuddy.com/api/v1`)** : **un seul client HTTP par portail** ; adresse dans
  `préfixe_variable` (`tfbuddy.baseUrl`), jeton dans `préfixe_keys`. Les appels dispersés (cockpit,
  Formation, app employés, CRM, Social) passent par ce client.
- C'est la **bascule v2** décidée explicitement : les anciens chemins restent servis pendant la
  fenêtre de dépréciation, le temps de basculer les écrans ; chaque route est notée dans
  `docs/API_REGISTRY.md` de son portail.

## Ordre de mise en place

Chaque étape est mise en ligne séparément, après accord.

1. Ce registre.
2. **Marketing** : Social versé dans le dépôt (servi à la même adresse `/marketing/social/`) ; les
   tables `mar_` du cockpit reprises par Marketing (un seul propriétaire) ; design system sur Social ;
   signage versé (`mar_sig_`, SQLite → MySQL).
3. **Formations** : module extrait du cockpit, `crm_mo_` / `crm_fmt_` repris du CRM.
4. **Pilotage** : `ceo_` / `con_` / `pla_` / `mot_` / `mac_` → `pil_` (vues de bascule), PWA consultant
   versée.
5. **Recrutement** : `atelierby_db` déplacée dans la base de l'ERP sous `rec_`, scouting versé.
6. API v2 et client TFBuddy unique dans chaque portail.
7. Kits d'export, répétition d'un export sur une base vierge.

## Avancement

| Étape | État |
|---|---|
| 1. Registre | fait (ce document) |
| 2a. Social versé dans `marketing/social/` | fait — déploiement `.github/workflows/social.yml`, adresses inchangées |
| 2b. Design system sur Social | fait — `social/public/_ds/marketing.css` + styles en ligne |
| 2c. Tables `mar_` du cockpit | **définitions** reprises par la migration `045_tables_reprises_du_cockpit.sql` (23 tables, sans clé étrangère vers `ceo_shop`). **Reste** : le code du cockpit qui les lit et les écrit (voir l'écart ci-dessous) |
| 2e. Social n'existe plus seul : `/marketing/social/` ouvert seul renvoie au même écran dans le rail du Marketing (`?ecran=social-…`) | fait |
| 2f. Écrans de Social réécrits dans le Marketing, un par un, puis `social/` effacé (renvois gardés pour Meta, QR codes, ERP) | en cours |
| 2d. Signage | à faire |
| 3 à 7 | à faire |

### Écart ouvert : le cockpit écrit encore dans les tables du Marketing

Le cockpit lit et écrit des tables `mar_` dans ~40 000 lignes : une ancienne copie de l'API du
module (`public/api/marketing/`), la mesure des campagnes (`src/mesure.php`), le contrôle des posts
(`src/brand_guard.php`, `src/fbcontrole.php`), les posts sociaux (`src/social_publication.php`), la
newsletter clients (`src/newsletter*.php`), les objectifs produits, le brief (`src/mkt_brief.php`) et
des lectures dans `src/endpoints.php` / `src/writes.php`. Chaque bloc passe dans le Marketing (écran +
API) ; le cockpit garde, au besoin, une lecture par `/api/v1/integration/marketing/…`. Jusque-là, le
cockpit ne crée plus ces tables : c'est la migration 045 du Marketing qui les définit.

## À faire hors du code

- Renommer sur GitHub `consultant_BO` → `pilotage-reseau` et `atelier-espace-candidat` → `recrutement`
  (Settings › Repository name ; GitHub garde une redirection), créer `formations`, puis archiver
  `social`, `signage`, `pwa_consultant`, `scouting` une fois versés.

## Registre des tables

Inventaire du 06/11/2026, tiré des `CREATE TABLE` des sept dépôts. « = » : le nom ne change pas. Une
même table déclarée par deux dépôts apparaît deux fois : le portail cible en devient le seul
propriétaire. `ceo_app_setting` et `crm_settings` du CRM se fondent dans `rec_variable`.

### Recrutement — 122 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| atelier-espace-candidat | `ceo_app_setting` | `rec_variable` | réglages → table _variable du portail |
| atelier-espace-candidat | `ceo_scouting_candidate` | `rec_scouting_candidate` |  |
| atelier-espace-candidat | `ceo_scouting_competitor` | `rec_scouting_competitor` |  |
| atelier-espace-candidat | `ceo_scouting_etude` | `rec_scouting_etude` |  |
| atelier-espace-candidat | `ceo_scouting_population` | `rec_scouting_population` |  |
| atelier-espace-candidat | `ceo_scouting_tile` | `rec_scouting_tile` |  |
| atelier-espace-candidat | `crm_agence_biens` | `rec_agence_biens` |  |
| atelier-espace-candidat | `crm_agence_contacts` | `rec_agence_contacts` |  |
| atelier-espace-candidat | `crm_agence_pistes` | `rec_agence_pistes` |  |
| atelier-espace-candidat | `crm_agence_recherches` | `rec_agence_recherches` |  |
| atelier-espace-candidat | `crm_agences` | `rec_agences` |  |
| atelier-espace-candidat | `crm_appointments` | `rec_appointments` |  |
| atelier-espace-candidat | `crm_audit_log` | `rec_audit_log` |  |
| atelier-espace-candidat | `crm_campaign_emplacements` | `rec_campaign_emplacements` |  |
| atelier-espace-candidat | `crm_campaigns` | `rec_campaigns` |  |
| atelier-espace-candidat | `crm_cand_photos` | `rec_cand_photos` |  |
| atelier-espace-candidat | `crm_candidate_docs` | `rec_candidate_docs` |  |
| atelier-espace-candidat | `crm_candidates` | `rec_candidates` |  |
| atelier-espace-candidat | `crm_cd_agenda_slots` | `rec_cd_agenda_slots` |  |
| atelier-espace-candidat | `crm_cd_applications` | `rec_cd_applications` |  |
| atelier-espace-candidat | `crm_cd_appointments` | `rec_cd_appointments` |  |
| atelier-espace-candidat | `crm_cd_badges` | `rec_cd_badges` |  |
| atelier-espace-candidat | `crm_cd_candidate_badges` | `rec_cd_candidate_badges` |  |
| atelier-espace-candidat | `crm_cd_candidate_steps` | `rec_cd_candidate_steps` |  |
| atelier-espace-candidat | `crm_cd_candidates` | `rec_cd_candidates` |  |
| atelier-espace-candidat | `crm_cd_documents` | `rec_cd_documents` |  |
| atelier-espace-candidat | `crm_cd_investors` | `rec_cd_investors` |  |
| atelier-espace-candidat | `crm_cd_journey_steps` | `rec_cd_journey_steps` |  |
| atelier-espace-candidat | `crm_cd_locations` | `rec_cd_locations` |  |
| atelier-espace-candidat | `crm_cd_opportunities` | `rec_cd_opportunities` |  |
| atelier-espace-candidat | `crm_cd_password_resets` | `rec_cd_password_resets` |  |
| atelier-espace-candidat | `crm_cd_video_progress` | `rec_cd_video_progress` |  |
| atelier-espace-candidat | `crm_cd_videos` | `rec_cd_videos` |  |
| atelier-espace-candidat | `crm_cdn_acces` | `rec_cdn_acces` |  |
| atelier-espace-candidat | `crm_cdn_events` | `rec_cdn_events` |  |
| atelier-espace-candidat | `crm_cdn_modele` | `rec_cdn_modele` |  |
| atelier-espace-candidat | `crm_cdn_notifs` | `rec_cdn_notifs` |  |
| atelier-espace-candidat | `crm_cdn_pieces` | `rec_cdn_pieces` |  |
| atelier-espace-candidat | `crm_cdn_pin_essais` | `rec_cdn_pin_essais` |  |
| atelier-espace-candidat | `crm_cdn_points` | `rec_cdn_points` |  |
| atelier-espace-candidat | `crm_cdn_projets` | `rec_cdn_projets` |  |
| atelier-espace-candidat | `crm_cdn_push` | `rec_cdn_push` |  |
| atelier-espace-candidat | `crm_chat_messages` | `rec_chat_messages` |  |
| atelier-espace-candidat | `crm_chat_stage_questions` | `rec_chat_stage_questions` |  |
| atelier-espace-candidat | `crm_doc_pdf` | `rec_doc_pdf` |  |
| atelier-espace-candidat | `crm_doc_template_stages` | `rec_doc_template_stages` |  |
| atelier-espace-candidat | `crm_doc_templates` | `rec_doc_templates` |  |
| atelier-espace-candidat | `crm_doc_termes` | `rec_doc_termes` |  |
| atelier-espace-candidat | `crm_doc_types` | `rec_doc_types` |  |
| atelier-espace-candidat | `crm_doc_valeurs` | `rec_doc_valeurs` |  |
| atelier-espace-candidat | `crm_doc_variables` | `rec_doc_variables` |  |
| atelier-espace-candidat | `crm_documents` | `rec_documents` |  |
| atelier-espace-candidat | `crm_erased` | `rec_erased` |  |
| atelier-espace-candidat | `crm_expansion_agences` | `rec_expansion_agences` |  |
| atelier-espace-candidat | `crm_expansions` | `rec_expansions` |  |
| atelier-espace-candidat | `crm_fl_geo_cache` | `rec_fl_geo_cache` |  |
| atelier-espace-candidat | `crm_fl_leads` | `rec_fl_leads` |  |
| atelier-espace-candidat | `crm_fl_meta_leads` | `rec_fl_meta_leads` |  |
| atelier-espace-candidat | `crm_fl_photos` | `rec_fl_photos` |  |
| atelier-espace-candidat | `crm_fl_videos` | `rec_fl_videos` |  |
| atelier-espace-candidat | `crm_followup_logs` | `rec_followup_logs` |  |
| atelier-espace-candidat | `crm_form_answers` | `rec_form_answers` |  |
| atelier-espace-candidat | `crm_form_fields` | `rec_form_fields` |  |
| atelier-espace-candidat | `crm_form_score_queue` | `rec_form_score_queue` |  |
| atelier-espace-candidat | `crm_form_tokens` | `rec_form_tokens` |  |
| atelier-espace-candidat | `crm_forms` | `rec_forms` |  |
| atelier-espace-candidat | `crm_gd_equipe` | `rec_gd_equipe` |  |
| atelier-espace-candidat | `crm_gd_rappels` | `rec_gd_rappels` |  |
| atelier-espace-candidat | `crm_gd_recyclages` | `rec_gd_recyclages` |  |
| atelier-espace-candidat | `crm_geo_cache` | `rec_geo_cache` |  |
| atelier-espace-candidat | `crm_immersion_days` | `rec_immersion_days` |  |
| atelier-espace-candidat | `crm_immersion_evals` | `rec_immersion_evals` |  |
| atelier-espace-candidat | `crm_keys` | `rec_keys` |  |
| atelier-espace-candidat | `crm_legal_docs` | `rec_legal_docs` |  |
| atelier-espace-candidat | `crm_loc` | `rec_loc` |  |
| atelier-espace-candidat | `crm_loc_files` | `rec_loc_files` |  |
| atelier-espace-candidat | `crm_loc_fournisseurs` | `rec_loc_fournisseurs` |  |
| atelier-espace-candidat | `crm_loc_overrides` | `rec_loc_overrides` |  |
| atelier-espace-candidat | `crm_loc_ref` | `rec_loc_ref` |  |
| atelier-espace-candidat | `crm_loc_ref_four_choix` | `rec_loc_ref_four_choix` |  |
| atelier-espace-candidat | `crm_loc_ref_fournisseurs` | `rec_loc_ref_fournisseurs` |  |
| atelier-espace-candidat | `crm_loc_ref_lignes` | `rec_loc_ref_lignes` |  |
| atelier-espace-candidat | `crm_loc_ref_postes` | `rec_loc_ref_postes` |  |
| atelier-espace-candidat | `crm_loc_ref_prix_m2` | `rec_loc_ref_prix_m2` |  |
| atelier-espace-candidat | `crm_login_log` | `rec_login_log` |  |
| atelier-espace-candidat | `crm_messages` | `rec_messages` |  |
| atelier-espace-candidat | `crm_meta_connexion` | `rec_meta_connexion` |  |
| atelier-espace-candidat | `crm_meta_resultat` | `rec_meta_resultat` |  |
| atelier-espace-candidat | `crm_msg_templates` | `rec_msg_templates` |  |
| atelier-espace-candidat | `crm_nl_cache` | `rec_nl_cache` |  |
| atelier-espace-candidat | `crm_nl_docs` | `rec_nl_docs` |  |
| atelier-espace-candidat | `crm_nl_editions` | `rec_nl_editions` |  |
| atelier-espace-candidat | `crm_nl_images` | `rec_nl_images` |  |
| atelier-espace-candidat | `crm_nl_interets` | `rec_nl_interets` |  |
| atelier-espace-candidat | `crm_nl_types` | `rec_nl_types` |  |
| atelier-espace-candidat | `crm_notes` | `rec_notes` |  |
| atelier-espace-candidat | `crm_opp_zone` | `rec_opp_zone` |  |
| atelier-espace-candidat | `crm_opp_zone_cp` | `rec_opp_zone_cp` |  |
| atelier-espace-candidat | `crm_password_resets` | `rec_password_resets` |  |
| atelier-espace-candidat | `crm_proj_files` | `rec_proj_files` |  |
| atelier-espace-candidat | `crm_proj_meta` | `rec_proj_meta` |  |
| atelier-espace-candidat | `crm_proj_vues` | `rec_proj_vues` |  |
| atelier-espace-candidat | `crm_push_subs` | `rec_push_subs` |  |
| atelier-espace-candidat | `crm_reminders` | `rec_reminders` |  |
| atelier-espace-candidat | `crm_reseau_clients` | `rec_reseau_clients` |  |
| atelier-espace-candidat | `crm_reseau_contact` | `rec_reseau_contact` |  |
| atelier-espace-candidat | `crm_reseau_statut` | `rec_reseau_statut` |  |
| atelier-espace-candidat | `crm_reseau_valid` | `rec_reseau_valid` |  |
| atelier-espace-candidat | `crm_settings` | `rec_variable` |  |
| atelier-espace-candidat | `crm_stage_docs` | `rec_stage_docs` |  |
| atelier-espace-candidat | `crm_stage_files` | `rec_stage_files` |  |
| atelier-espace-candidat | `crm_stage_modules` | `rec_stage_modules` |  |
| atelier-espace-candidat | `crm_stages` | `rec_stages` |  |
| atelier-espace-candidat | `crm_template_files` | `rec_template_files` |  |
| atelier-espace-candidat | `crm_translations` | `rec_translations` |  |
| atelier-espace-candidat | `crm_users` | `rec_users` |  |
| atelier-espace-candidat | `crm_zones` | `rec_zones` |  |
| consultant_BO | `ceo_scouting_candidate` | `rec_scouting_candidate` |  |
| consultant_BO | `ceo_scouting_competitor` | `rec_scouting_competitor` |  |
| consultant_BO | `ceo_scouting_etude` | `rec_scouting_etude` |  |
| consultant_BO | `ceo_scouting_population` | `rec_scouting_population` |  |
| consultant_BO | `ceo_scouting_tile` | `rec_scouting_tile` |  |

### Marketing — 218 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| consultant_BO | `ceo_fid_regle` | `mar_fid_regle` | fidélité |
| consultant_BO | `ceo_fid_visite` | `mar_fid_visite` | fidélité |
| consultant_BO | `ceo_md_form` | `mar_md_form` | MétaDonnée (formulaires de prospects Meta) |
| consultant_BO | `ceo_md_journal` | `mar_md_journal` | MétaDonnée (formulaires de prospects Meta) |
| consultant_BO | `ceo_md_lead` | `mar_md_lead` | MétaDonnée (formulaires de prospects Meta) |
| consultant_BO | `ceo_md_shop` | `mar_md_shop` | MétaDonnée (formulaires de prospects Meta) |
| consultant_BO | `ceo_promo` | `mar_promo` | à fondre dans mar_promotion |
| consultant_BO | `ceo_promo_mecanique` | `mar_promo_mecanique` | à fondre dans mar_promotion |
| consultant_BO | `mar_agency` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_agency_ask` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_agency_campaign` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_asset_render` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_avis` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_avis_fiche` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_b2b_option` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_b2b_prospect` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_b2b_prospect_sector` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_b2b_sector` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_bg_controle` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_bg_page` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_bg_regle` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_annexe` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_annexe_type` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_mesure` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_objectif` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_objectif_produit` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_produit` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_releve` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_campagne_snapshot` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_channel` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_client_target` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_cost_kind` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_crm_lead` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_crm_lead_event` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_crm_segment` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_format` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_lead_status` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_campagne` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_contact` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_envoi` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_magasin` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_segment` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_source` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_nl_voucher` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_offer_item` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_offer_item_season` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_offer_template` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_offer_template_item` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_pos_answer_type` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_position` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_promotion_mechanic` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_retroplanning_default` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_retroplanning_step` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_review_platform` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_sales_channel` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_shop_revenue` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_shop_user` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_social_ecart` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_social_post` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_social_publication` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_tone` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_uniform` | = | propriétaire unique : Marketing |
| consultant_BO | `mar_voucher` | = | propriétaire unique : Marketing |
| marketing | `mar_agency` | = |  |
| marketing | `mar_agency_ask` | = |  |
| marketing | `mar_agency_campaign` | = |  |
| marketing | `mar_approval_request` | = |  |
| marketing | `mar_asset_render` | = |  |
| marketing | `mar_b2b_option` | = |  |
| marketing | `mar_b2b_prospect` | = |  |
| marketing | `mar_b2b_prospect_sector` | = |  |
| marketing | `mar_b2b_sector` | = |  |
| marketing | `mar_brand` | = |  |
| marketing | `mar_bundle` | = |  |
| marketing | `mar_bundle_item` | = |  |
| marketing | `mar_campaign` | = |  |
| marketing | `mar_campaign_agency_ask` | = |  |
| marketing | `mar_campaign_asset` | = |  |
| marketing | `mar_campaign_b2b_option` | = |  |
| marketing | `mar_campaign_b2b_sector` | = |  |
| marketing | `mar_campaign_brochure` | = |  |
| marketing | `mar_campaign_challenge_prize` | = |  |
| marketing | `mar_campaign_channel` | = |  |
| marketing | `mar_campaign_erp_voucher` | = |  |
| marketing | `mar_campaign_kit` | = |  |
| marketing | `mar_campaign_kit_link` | = |  |
| marketing | `mar_campaign_kit_shop` | = |  |
| marketing | `mar_campaign_kpi_snapshot` | = |  |
| marketing | `mar_campaign_lever_target` | = |  |
| marketing | `mar_campaign_message` | = |  |
| marketing | `mar_campaign_offer` | = |  |
| marketing | `mar_campaign_offer_item` | = |  |
| marketing | `mar_campaign_pos_question` | = |  |
| marketing | `mar_campaign_production` | = |  |
| marketing | `mar_campaign_production_shop` | = |  |
| marketing | `mar_campaign_shop` | = |  |
| marketing | `mar_campaign_shop_item_target` | = |  |
| marketing | `mar_campaign_status` | = |  |
| marketing | `mar_campaign_type` | = |  |
| marketing | `mar_campaign_uniform` | = |  |
| marketing | `mar_channel` | = |  |
| marketing | `mar_client_target` | = |  |
| marketing | `mar_consultant` | = |  |
| marketing | `mar_cost_kind` | = |  |
| marketing | `mar_crm_campaign_target` | = |  |
| marketing | `mar_crm_customer` | = |  |
| marketing | `mar_crm_customer_segment` | = |  |
| marketing | `mar_crm_lead` | = |  |
| marketing | `mar_crm_lead_event` | = |  |
| marketing | `mar_crm_segment` | = |  |
| marketing | `mar_format` | = |  |
| marketing | `mar_fund_movement` | = |  |
| marketing | `mar_fund_recurrence` | = |  |
| marketing | `mar_fund_source` | = |  |
| marketing | `mar_keys` | = |  |
| marketing | `mar_kit` | = |  |
| marketing | `mar_kit_activation` | = |  |
| marketing | `mar_kit_asset` | = |  |
| marketing | `mar_lead_status` | = |  |
| marketing | `mar_lever` | = |  |
| marketing | `mar_local_budget` | = |  |
| marketing | `mar_media` | = |  |
| marketing | `mar_media_category` | = |  |
| marketing | `mar_media_season` | = |  |
| marketing | `mar_offer_item` | = |  |
| marketing | `mar_offer_item_season` | = |  |
| marketing | `mar_offer_template` | = |  |
| marketing | `mar_offer_template_item` | = |  |
| marketing | `mar_pos_answer_type` | = |  |
| marketing | `mar_position` | = |  |
| marketing | `mar_promotion` | = |  |
| marketing | `mar_promotion_mechanic` | = |  |
| marketing | `mar_retroplanning_default` | = |  |
| marketing | `mar_retroplanning_step` | = |  |
| marketing | `mar_review` | = |  |
| marketing | `mar_review_platform` | = |  |
| marketing | `mar_review_reply` | = |  |
| marketing | `mar_review_template` | = |  |
| marketing | `mar_roi_cost` | = |  |
| marketing | `mar_royalty_rate` | = |  |
| marketing | `mar_sales_channel` | = |  |
| marketing | `mar_schema_migration` | = |  |
| marketing | `mar_shop` | = |  |
| marketing | `mar_shop_presence` | = |  |
| marketing | `mar_shop_revenue` | = |  |
| marketing | `mar_shop_support` | = |  |
| marketing | `mar_shop_user` | = |  |
| marketing | `mar_tone` | = |  |
| marketing | `mar_tracking_action` | = |  |
| marketing | `mar_uniform` | = |  |
| marketing | `mar_variable` | = |  |
| marketing | `mar_voucher` | = |  |
| marketing | `mar_voucher_channel` | = |  |
| marketing | `mar_voucher_redemption` | = |  |
| signage | `sig_aliases` | `mar_sig_aliases` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_bundles` | `mar_sig_bundles` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_campaigns` | `mar_sig_campaigns` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_dayplans` | `mar_sig_dayplans` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_dayplans_new` | `mar_sig_dayplans_new` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_element_types` | `mar_sig_element_types` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_heartbeats` | `mar_sig_heartbeats` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_ingredients` | `mar_sig_ingredients` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_langs` | `mar_sig_langs` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_lib_categories` | `mar_sig_lib_categories` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_media` | `mar_sig_media` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_module_items` | `mar_sig_module_items` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_modules` | `mar_sig_modules` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_modules_new` | `mar_sig_modules_new` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_players` | `mar_sig_players` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_playlist` | `mar_sig_playlist` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_playlist_items` | `mar_sig_playlist_items` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_playlists` | `mar_sig_playlists` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_product_categories` | `mar_sig_product_categories` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_product_moments` | `mar_sig_product_moments` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_product_prices` | `mar_sig_product_prices` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_products` | `mar_sig_products` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_promo_types` | `mar_sig_promo_types` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_publications` | `mar_sig_publications` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_screen_groups` | `mar_sig_screen_groups` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_seasons` | `mar_sig_seasons` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_sequence_items` | `mar_sig_sequence_items` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_sequences` | `mar_sig_sequences` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_sessions` | `mar_sig_sessions` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_settings` | `mar_sig_settings` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_snapshots` | `mar_sig_snapshots` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_store_unavailable` | `mar_sig_store_unavailable` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_stores` | `mar_sig_stores` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_tfb_promos` | `mar_sig_tfb_promos` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_translations` | `mar_sig_translations` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_users` | `mar_sig_users` | régie d’affichage ; SQLite → MySQL |
| signage | `sig_weekplans` | `mar_sig_weekplans` | régie d’affichage ; SQLite → MySQL |
| social | `mar_keys` | = |  |
| social | `mar_sa_activite` | = |  |
| social | `mar_sa_api_audit` | = |  |
| social | `mar_sa_avis_scan` | = |  |
| social | `mar_sa_boost_demande` | = |  |
| social | `mar_sa_boutique` | = |  |
| social | `mar_sa_campagne` | = |  |
| social | `mar_sa_commentaire` | = |  |
| social | `mar_sa_content` | = |  |
| social | `mar_sa_conversation` | = |  |
| social | `mar_sa_formulaire` | = |  |
| social | `mar_sa_google_suivi` | = |  |
| social | `mar_sa_groupe` | = |  |
| social | `mar_sa_instagram_media` | = |  |
| social | `mar_sa_lead` | = |  |
| social | `mar_sa_message` | = |  |
| social | `mar_sa_meta_objet` | = |  |
| social | `mar_sa_modele` | = |  |
| social | `mar_sa_modele_franchise` | = |  |
| social | `mar_sa_parametre` | = |  |
| social | `mar_sa_publication` | = |  |
| social | `mar_sa_publicite` | = |  |
| social | `mar_sa_rattachement` | = |  |
| social | `mar_sa_repost` | = |  |
| social | `mar_sa_repost_cible` | = |  |
| social | `mar_sa_resultat` | = |  |
| social | `mar_variable` | = |  |

### Pilotage — 112 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| consultant_BO | `ceo_action_usage` | `pil_action_usage` |  |
| consultant_BO | `ceo_alert_rule` | `pil_alert_rule` |  |
| consultant_BO | `ceo_app_setting` | `pil_variable` | réglages → table _variable du portail |
| consultant_BO | `ceo_ca_demande` | `pil_ca_demande` |  |
| consultant_BO | `ceo_combo` | `pil_combo` |  |
| consultant_BO | `ceo_connecteur` | `pil_connecteur` |  |
| consultant_BO | `ceo_crois_cache` | `pil_crois_cache` |  |
| consultant_BO | `ceo_doc` | `pil_doc` |  |
| consultant_BO | `ceo_ecran_vue` | `pil_ecran_vue` |  |
| consultant_BO | `ceo_email_template` | `pil_email_template` |  |
| consultant_BO | `ceo_journal_entry` | `pil_journal_entry` |  |
| consultant_BO | `ceo_kpi_def` | `pil_kpi_def` |  |
| consultant_BO | `ceo_kpi_valeur` | `pil_kpi_valeur` |  |
| consultant_BO | `ceo_magasin_fiche` | `pil_magasin_fiche` |  |
| consultant_BO | `ceo_matiere_code` | `pil_matiere_code` |  |
| consultant_BO | `ceo_network_target` | `pil_network_target` |  |
| consultant_BO | `ceo_operateur_remarque` | `pil_operateur_remarque` |  |
| consultant_BO | `ceo_parcours` | `pil_parcours` |  |
| consultant_BO | `ceo_parcours_etape` | `pil_parcours_etape` |  |
| consultant_BO | `ceo_person` | `pil_person` |  |
| consultant_BO | `ceo_plan_action` | `pil_plan_action` |  |
| consultant_BO | `ceo_plan_engagement` | `pil_plan_engagement` |  |
| consultant_BO | `ceo_plan_revue` | `pil_plan_revue` |  |
| consultant_BO | `ceo_plan_trimestre` | `pil_plan_trimestre` |  |
| consultant_BO | `ceo_plano_photo` | `pil_plano_photo` |  |
| consultant_BO | `ceo_plano_std_emplacement` | `pil_plano_std_emplacement` |  |
| consultant_BO | `ceo_plano_std_montage` | `pil_plano_std_montage` |  |
| consultant_BO | `ceo_plano_std_photo` | `pil_plano_std_photo` |  |
| consultant_BO | `ceo_plano_std_zone` | `pil_plano_std_zone` |  |
| consultant_BO | `ceo_prod_fin` | `pil_prod_fin` |  |
| consultant_BO | `ceo_prod_product` | `pil_prod_product` |  |
| consultant_BO | `ceo_prod_revue` | `pil_prod_revue` |  |
| consultant_BO | `ceo_product` | `pil_product` |  |
| consultant_BO | `ceo_product_month_sales` | `pil_product_month_sales` |  |
| consultant_BO | `ceo_project` | `pil_project` |  |
| consultant_BO | `ceo_project_cost` | `pil_project_cost` |  |
| consultant_BO | `ceo_project_crm` | `pil_project_crm` |  |
| consultant_BO | `ceo_project_levid` | `pil_project_levid` |  |
| consultant_BO | `ceo_project_milestone` | `pil_project_milestone` |  |
| consultant_BO | `ceo_project_task` | `pil_project_task` |  |
| consultant_BO | `ceo_project_template` | `pil_project_template` |  |
| consultant_BO | `ceo_prospect` | `pil_prospect` |  |
| consultant_BO | `ceo_push_abonnement` | `pil_push_abonnement` |  |
| consultant_BO | `ceo_pwa_client` | `pil_pwa_client` |  |
| consultant_BO | `ceo_pwa_jour` | `pil_pwa_jour` |  |
| consultant_BO | `ceo_pwa_visite` | `pil_pwa_visite` |  |
| consultant_BO | `ceo_rapport` | `pil_rapport` |  |
| consultant_BO | `ceo_rapport_run` | `pil_rapport_run` |  |
| consultant_BO | `ceo_reclamation_photo` | `pil_reclamation_photo` |  |
| consultant_BO | `ceo_report_schedule` | `pil_report_schedule` |  |
| consultant_BO | `ceo_shop` | `pil_shop` |  |
| consultant_BO | `ceo_shop_budget` | `pil_shop_budget` |  |
| consultant_BO | `ceo_shop_budget_line` | `pil_shop_budget_line` |  |
| consultant_BO | `ceo_shop_budget_month` | `pil_shop_budget_month` |  |
| consultant_BO | `ceo_shop_charge_month` | `pil_shop_charge_month` |  |
| consultant_BO | `ceo_shop_day_note` | `pil_shop_day_note` |  |
| consultant_BO | `ceo_shop_month_note` | `pil_shop_month_note` |  |
| consultant_BO | `ceo_shop_month_perf` | `pil_shop_month_perf` |  |
| consultant_BO | `ceo_shop_profil_heure` | `pil_shop_profil_heure` |  |
| consultant_BO | `ceo_shop_profil_jour` | `pil_shop_profil_jour` |  |
| consultant_BO | `ceo_stock_evenement` | `pil_stock_evenement` |  |
| consultant_BO | `ceo_stock_releve` | `pil_stock_releve` |  |
| consultant_BO | `ceo_supplier` | `pil_supplier` |  |
| consultant_BO | `ceo_tablette_remarque` | `pil_tablette_remarque` |  |
| consultant_BO | `ceo_task_annotation` | `pil_task_annotation` |  |
| consultant_BO | `ceo_task_issue` | `pil_task_issue` |  |
| consultant_BO | `ceo_x` | `pil_x` |  |
| consultant_BO | `con_consultant` | `pil_con_consultant` | visites consultants |
| consultant_BO | `con_consultant_checklist` | `pil_con_consultant_checklist` | visites consultants |
| consultant_BO | `con_consultant_tache` | `pil_con_consultant_tache` | visites consultants |
| consultant_BO | `con_consultant_visit` | `pil_con_consultant_visit` | visites consultants |
| consultant_BO | `con_equipe_releve` | `pil_con_equipe_releve` | visites consultants |
| consultant_BO | `con_franchise_meteo` | `pil_con_franchise_meteo` | visites consultants |
| consultant_BO | `con_msp` | `pil_con_msp` | visites consultants |
| consultant_BO | `con_rayon_photo` | `pil_con_rayon_photo` | visites consultants |
| consultant_BO | `con_scoring_google` | `pil_con_scoring_google` | visites consultants |
| consultant_BO | `con_scoring_msp` | `pil_con_scoring_msp` | visites consultants |
| consultant_BO | `con_tache_jour` | `pil_con_tache_jour` | visites consultants |
| consultant_BO | `con_tache_jour_etat` | `pil_con_tache_jour_etat` | visites consultants |
| consultant_BO | `con_visite` | `pil_con_visite` | visites consultants |
| consultant_BO | `con_visite_action` | `pil_con_visite_action` | visites consultants |
| consultant_BO | `con_visite_action_evt` | `pil_con_visite_action_evt` | visites consultants |
| consultant_BO | `con_visite_photo` | `pil_con_visite_photo` | visites consultants |
| consultant_BO | `con_visite_point` | `pil_con_visite_point` | visites consultants |
| consultant_BO | `mac_report_share` | `pil_mac_report_share` | PWA consultant |
| consultant_BO | `mot_grand_prix` | `pil_mot_grand_prix` | primes |
| consultant_BO | `mot_profil` | `pil_mot_profil` | primes |
| consultant_BO | `pla_contenant` | `pil_pla_contenant` | planogramme |
| consultant_BO | `pla_format` | `pil_pla_format` | planogramme |
| consultant_BO | `pla_meuble` | `pil_pla_meuble` | planogramme |
| consultant_BO | `pla_montage` | `pil_pla_montage` | planogramme |
| consultant_BO | `pla_niveau` | `pil_pla_niveau` | planogramme |
| consultant_BO | `pla_note` | `pil_pla_note` | planogramme |
| consultant_BO | `pla_placement` | `pil_pla_placement` | planogramme |
| consultant_BO | `pla_slot` | `pil_pla_slot` | planogramme |
| consultant_BO | `pla_zone` | `pil_pla_zone` | planogramme |
| pwa_consultant | `mac_checklist_day_snapshot` | `pil_mac_checklist_day_snapshot` | PWA consultant |
| pwa_consultant | `mac_consultant_lever_action` | `pil_mac_consultant_lever_action` | PWA consultant |
| pwa_consultant | `mac_consultant_param` | `pil_mac_consultant_param` | PWA consultant |
| pwa_consultant | `mac_consultant_perf` | `pil_mac_consultant_perf` | PWA consultant |
| pwa_consultant | `mac_consultant_visit` | `pil_mac_consultant_visit` | PWA consultant |
| pwa_consultant | `mac_google_rating_snapshot` | `pil_mac_google_rating_snapshot` | PWA consultant |
| pwa_consultant | `mac_kpi_threshold` | `pil_mac_kpi_threshold` | PWA consultant |
| pwa_consultant | `mac_network_day` | `pil_mac_network_day` | PWA consultant |
| pwa_consultant | `mac_report_share` | `pil_mac_report_share` | PWA consultant |
| pwa_consultant | `mac_shop_monthly_pnl` | `pil_mac_shop_monthly_pnl` | PWA consultant |
| pwa_consultant | `mac_task_review` | `pil_mac_task_review` | PWA consultant |
| social | `ceo_app_setting` | `pil_variable` | réglages → table _variable du portail |
| social | `ceo_journal_entry` | `pil_journal_entry` | lue par Social : passer par l’API Pilotage |
| social | `ceo_shop` | `pil_shop` | lue par Social : passer par l’API Pilotage |
| social | `ceo_shop_reputation` | `pil_shop_reputation` | lue par Social : passer par l’API Pilotage |
| social | `ceo_shop_review` | `pil_shop_review` | lue par Social : passer par l’API Pilotage |

### Formations — 11 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| atelier-espace-candidat | `crm_fmt_formateurs` | `frm_fmt_formateurs` | formateurs du nouveau franchisé |
| atelier-espace-candidat | `crm_fmt_photos` | `frm_fmt_photos` | formateurs du nouveau franchisé |
| atelier-espace-candidat | `crm_fmt_suivis` | `frm_fmt_suivis` | formateurs du nouveau franchisé |
| atelier-espace-candidat | `crm_fmt_validations` | `frm_fmt_validations` | formateurs du nouveau franchisé |
| atelier-espace-candidat | `crm_mo_acces` | `frm_mo_acces` | manuel opératoire (à fusionner avec le module Formation) |
| atelier-espace-candidat | `crm_mo_chapitres` | `frm_mo_chapitres` | manuel opératoire (à fusionner avec le module Formation) |
| atelier-espace-candidat | `crm_mo_execs` | `frm_mo_execs` | manuel opératoire (à fusionner avec le module Formation) |
| atelier-espace-candidat | `crm_mo_magasins` | `frm_mo_magasins` | manuel opératoire (à fusionner avec le module Formation) |
| atelier-espace-candidat | `crm_mo_medias` | `frm_mo_medias` | manuel opératoire (à fusionner avec le module Formation) |
| atelier-espace-candidat | `crm_mo_pin_essais` | `frm_mo_pin_essais` | manuel opératoire (à fusionner avec le module Formation) |
| atelier-espace-candidat | `crm_mo_procedures` | `frm_mo_procedures` | manuel opératoire (à fusionner avec le module Formation) |

### ERP (lecture) — 8 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| consultant_BO | `kpi` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| consultant_BO | `of_tag` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| consultant_BO | `position` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| consultant_BO | `shops` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| social | `product` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| social | `shops` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| social | `transaction` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |
| social | `transaction_product` | = | table de l’ERP recréée seulement dans un test : jamais par un portail |

### À décider — 70 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| landing | `lp_app_section` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_candidates` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_collaborations` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_audit` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_campaigns` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_collectibles` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_collections` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_consents` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_customer_collectibles` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_customers` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_events` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_fraud_events` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_hits` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_idempotency` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_plays` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_redemptions` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_ref_friends` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_refs` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_rewards` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_rules` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_tokens` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_transactions` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_fd_vouchers` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_footer_links` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_franchise_i18n` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_franchise_photos` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_franchise_zones` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_codes` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_gifts` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_i18n` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_mails` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_order` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_photos` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_rois` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_galette_sections` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_hero_slides` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_highlights` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_i18n` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_legal` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_mail_log` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_mail_params` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_nav_items` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_faqs` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_form_fields` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_i18n` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_list` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_offers` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_photos` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_products` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_rollout` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_shops` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_specs` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_steps` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_testimonials` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_usecases` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_od_zones` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_offers` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_offers_section` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_office_lead_log` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_params` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_product_families` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_products` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_season_photos` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_seasonal_items` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_seasons` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_sections` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_seo` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_services` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_shop_info` | = | site public (landing) — hors des 4 portails pour l’instant |
| landing | `lp_shop_photos` | = | site public (landing) — hors des 4 portails pour l’instant |

### Hérité — 4 table(s)

| Dépôt actuel | Table actuelle | Nom cible | Note |
|---|---|---|---|
| social | `brand_guard_pages` | = | nom sans préfixe : à vérifier puis supprimer ou préfixer |
| social | `meta_connexion` | = | nom sans préfixe : à vérifier puis supprimer ou préfixer |
| social | `social_lead` | = | nom sans préfixe : à vérifier puis supprimer ou préfixer |
| social | `social_parametre` | = | nom sans préfixe : à vérifier puis supprimer ou préfixer |
