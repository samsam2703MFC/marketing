-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 014 — Les dernières correspondances code → libellé
--
-- Cinq écrans traduisaient encore un code en libellé dans le front, avec une
-- table de correspondance écrite en dur : canaux de bon, natures de coût,
-- plateformes d'avis, cibles client, mécaniques de promotion. Une sixième
-- passait sans traduction du tout — le grand livre affichait « ROYALTY » tel
-- quel dans la colonne source.
--
-- Toutes retombaient proprement sur le code brut, donc rien ne cassait ; c'est
-- la cohérence qui manquait. Ajouter une valeur imposait un déploiement du
-- front, là où le reste du module se règle en base.
--
-- Sur les clés étrangères : elles ne sont posées que là où le module est le
-- seul à écrire la colonne. Les mécaniques de promotion, les plateformes
-- d'avis et les canaux de bon proviennent d'imports qui ne sont pas encore
-- raccordés ; poser une contrainte sur des données qu'on n'a jamais vues ferait
-- échouer le premier import en bloc, sans qu'on sache dire si le fautif est le
-- fichier ou la liste. Ces trois-là restent en texte libre, avec un référentiel
-- pour les libellés — et le code brut s'affiche si la valeur est inconnue.
-- =============================================================================

CREATE TABLE mar_client_target (
  code       VARCHAR(10)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_cost_kind (
  code       VARCHAR(20)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_fund_source (
  code       VARCHAR(20)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_review_platform (
  code       VARCHAR(20)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canaux de distribution d'un bon : web-shop, caisse, office, B2B.
CREATE TABLE mar_sales_channel (
  code       VARCHAR(10)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mar_promotion_mechanic (
  code       VARCHAR(20)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  sort_order SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mar_client_target (code, label, sort_order) VALUES
  ('b2c',   'B2C — particuliers',    1),
  ('b2b',   'B2B — professionnels',  2),
  ('mixte', 'Mixte B2C + B2B',       3);

INSERT INTO mar_cost_kind (code, label, sort_order) VALUES
  ('MEDIA',      'Achat média',             1),
  ('PRODUCTION', 'Production & impression', 2),
  ('AGENCE',     'Honoraires agence',       3),
  ('REMISE',     'Remises accordées',       4),
  ('LOGISTIQUE', 'Logistique',              5),
  ('AUTRE',      'Autres',                  6);

INSERT INTO mar_fund_source (code, label, sort_order) VALUES
  ('ROYALTY',      'Royalties',            1),
  ('AGENCE',       'Honoraires agence',    2),
  ('FOURNISSEUR',  'Fournisseur',          3),
  ('REMBOURSEMENT','Remboursement',        4),
  ('AUTRE',        'Autre',                5);

INSERT INTO mar_review_platform (code, label, sort_order) VALUES
  ('GOOGLE',      'Google Business', 1),
  ('FACEBOOK',    'Facebook',        2),
  ('INSTAGRAM',   'Instagram',       3),
  ('TRIPADVISOR', 'Tripadvisor',     4),
  ('DELIVEROO',   'Deliveroo',       5),
  ('UBEREATS',    'Uber Eats',       6);

INSERT INTO mar_sales_channel (code, label, sort_order) VALUES
  ('WS',  'Web shop', 1),
  ('POS', 'Caisse',   2),
  ('OFF', 'Office',   3),
  ('B2B', 'B2B',      4);

INSERT INTO mar_promotion_mechanic (code, label, sort_order) VALUES
  ('PERCENT',       'Pourcentage',        1),
  ('BUNDLE_FIXED',  'Prix de formule',    2),
  ('BUY_X_GET_Y',   'Offre liée',         3),
  ('CROSSED_PRICE', 'Prix barré',         4),
  ('FREE_DELIVERY', 'Livraison offerte',  5);

-- Reprise de l'existant avant la contrainte.
--
-- Ces bases tournent déjà : une valeur présente en production et absente de la
-- liste ci-dessus ferait échouer l'ALTER, et la migration s'arrêterait à
-- mi-parcours. On l'ajoute au référentiel avec son code pour libellé — visible,
-- corrigeable, plutôt que bloquante.
INSERT INTO mar_client_target (code, label, sort_order)
SELECT DISTINCT c.client_target, c.client_target, 99
  FROM mar_campaign c
 WHERE c.client_target NOT IN (SELECT code FROM mar_client_target);

INSERT INTO mar_fund_source (code, label, sort_order)
SELECT DISTINCT fm.source, fm.source, 99
  FROM mar_fund_movement fm
 WHERE fm.source IS NOT NULL
   AND fm.source NOT IN (SELECT code FROM mar_fund_source);

ALTER TABLE mar_campaign
  ADD CONSTRAINT fk_mar_campaign_client_target
    FOREIGN KEY (client_target) REFERENCES mar_client_target (code) ON UPDATE CASCADE;

ALTER TABLE mar_fund_movement
  ADD CONSTRAINT fk_mar_fund_movement_source
    FOREIGN KEY (source) REFERENCES mar_fund_source (code) ON UPDATE CASCADE;
