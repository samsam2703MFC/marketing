-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 032 — Campagne visible sur la boutique en ligne
--
-- Une campagne se décide en interne, mais toutes ne se montrent pas au client :
-- une opération réservée au comptoir, un test sur trois magasins, une offre B2B
-- négociée n'ont rien à faire en vitrine du site. L'inverse est vrai aussi, et
-- c'est le cas courant — une campagne saisonnière veut y être.
--
-- Rien ne portait cette distinction : la boutique en ligne n'avait aucun moyen
-- de savoir quelles campagnes publier, et les publier toutes aurait exposé des
-- offres que personne n'avait décidé de rendre publiques.
--
-- Le défaut est « non » : publier vers l'extérieur se demande, ne se suppose
-- pas. Une campagne oubliée qui ne s'affiche pas se corrige d'une case cochée ;
-- une offre interne parue en vitrine se corrige beaucoup moins bien.
-- =============================================================================

-- À ne pas confondre avec `b2b_webshop_enabled`, posée en 002 : celle-là ouvre
-- la commande en ligne aux professionnels sur une opération B2B. Celle-ci dit
-- si la campagne se montre en vitrine. Une opération B2B peut très bien rester
-- invisible du grand public, et une campagne grand public n'ouvre aucun compte
-- professionnel.
ALTER TABLE mar_campaign
  ADD COLUMN show_web_shop TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = la campagne est publiée sur la boutique en ligne'
    AFTER status_code;
