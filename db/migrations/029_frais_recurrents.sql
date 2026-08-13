-- Charset explicite : le client mysql par défaut est souvent en latin1,
-- ce qui double-encode les accents de ce fichier au chargement.
SET NAMES utf8mb4;

-- =============================================================================
-- 029 — Frais récurrents du fonds
--
-- L'essentiel de ce que dépense le fonds ne se saisit pas une fois : l'agence
-- tous les mois, la redevance tous les trimestres, l'hébergement tous les ans.
-- Ressaisir douze fois la même ligne, c'est douze occasions de se tromper de
-- montant, et la treizième qu'on oublie.
--
-- Un frais récurrent est donc un modèle, et rien de plus : il engendre à la
-- création de vraies écritures dans `mar_fund_movement`, une par échéance,
-- chacune avec sa propre période. Le grand livre reste la seule source du
-- solde — on n'y ajoute pas de lignes fantômes calculées à la lecture, qui
-- changeraient de valeur selon le jour où on l'ouvre.
--
-- Ces écritures restent modifiables une à une : une facture d'agence arrive
-- rarement à l'euro près sur douze mois, et corriger mars ne doit pas
-- redéfinir l'abonnement.
-- =============================================================================

CREATE TABLE mar_fund_recurrence (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  direction     CHAR(3)         NOT NULL COMMENT 'IN | OUT, comme le mouvement',
  frequency     VARCHAR(10)     NOT NULL COMMENT 'month | quarter | year',
  label         VARCHAR(300)    NOT NULL,
  amount        DECIMAL(12,2)   NOT NULL COMMENT 'Montant d''une échéance, pas du total',
  starts_on     DATE            NOT NULL,
  ends_on       DATE            NOT NULL COMMENT 'Bornée : un frais sans fin ne se budgète pas',
  shop_id       BIGINT UNSIGNED     NULL COMMENT 'NULL = tout le réseau',
  campaign_id   BIGINT UNSIGNED     NULL,
  lever_id      BIGINT UNSIGNED     NULL,
  source        VARCHAR(30)     NOT NULL DEFAULT 'AUTRE',
  supplier_name VARCHAR(160)        NULL,
  document_ref  VARCHAR(120)        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED     NULL,
  PRIMARY KEY (id),
  KEY ix_mar_fr_shop (shop_id),
  KEY ix_mar_fr_periode (starts_on, ends_on),
  CONSTRAINT fk_mar_fr_shop     FOREIGN KEY (shop_id)     REFERENCES mar_shop (id)     ON DELETE CASCADE,
  CONSTRAINT fk_mar_fr_campaign FOREIGN KEY (campaign_id) REFERENCES mar_campaign (id) ON DELETE SET NULL,
  CONSTRAINT fk_mar_fr_lever    FOREIGN KEY (lever_id)    REFERENCES mar_lever (id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Le lien de l'écriture vers son modèle. En CASCADE : supprimer un frais
-- récurrent doit emporter les échéances qu'il a lui-même écrites, sans quoi le
-- solde continuerait de porter un abonnement résilié — et il faudrait retrouver
-- ses douze lignes à la main pour s'en débarrasser. L'écran annonce le nombre
-- de lignes avant de le faire.
ALTER TABLE mar_fund_movement
  ADD COLUMN recurrence_id BIGINT UNSIGNED NULL
    COMMENT 'Échéance engendrée par un frais récurrent ; NULL = écriture isolée'
    AFTER lever_id,
  ADD KEY ix_mar_fm_recurrence (recurrence_id),
  ADD CONSTRAINT fk_mar_fm_recurrence
    FOREIGN KEY (recurrence_id) REFERENCES mar_fund_recurrence (id) ON DELETE CASCADE;

-- La vue `mar_v_fund_ledger_by_period` n'est pas redéfinie ici, pour la même
-- raison qu'en 028 : `migrate.php` rejoue les fichiers `_vues` à chaque passage
-- et écraserait toute définition posée ailleurs. Le grand livre lit
-- `recurrence_id` sur la table, qu'il joint déjà à la vue par son identifiant.
