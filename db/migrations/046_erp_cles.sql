-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 046 — Les secrets du Marketing dans erp_cles, la table des clés commune à l'ERP
--
-- Décision du 7 nov. 2026 : « les clés sont dans une table commune pour tout l'ERP ;
-- à part les clés, tous les portails sont indépendants ». Une ligne par clé :
--   cle         nom unique — pour le Marketing `mar.{module}.{nom}`
--               (mar.marketing.MAR_SESSION_SECRET, mar.social.meta_system_token) ;
--   valeur      la clé ; pour le Marketing, CHIFFRÉE comme avant (même format,
--               mêmes données associées « mar_keys:{module}:{nom} ») ;
--   secret      1 = jamais au navigateur ; 0 = identifiant d'une intégration partagée ;
--   indice      quatre derniers caractères ; portail : commun | rec | mar | pil | frm ;
--   integration libellé ; maj_le / maj_par.
-- Les clés `commun` (Meta, e-mail, SMS, IA, Google, TF Buddy, jeton de service
-- entre portails) sont tenues par le portail qui les saisit, en clair, et lues
-- par les autres sous leur nom (meta_app_secret, meta_system_token, …).
--
-- Même définition dans les quatre portails (CREATE TABLE IF NOT EXISTS). Les
-- lignes de mar_keys y sont versées (rien n'est écrasé) ; mar_keys reste en
-- repli le temps de la mise en ligne, puis sera supprimée.
-- =============================================================================

CREATE TABLE IF NOT EXISTS erp_cles (
  cle         VARCHAR(80)  NOT NULL PRIMARY KEY,
  valeur      MEDIUMTEXT       NULL,
  secret      TINYINT(1)   NOT NULL DEFAULT 1,
  indice      VARCHAR(12)      NULL,
  portail     VARCHAR(20)  NOT NULL DEFAULT 'commun',
  integration VARCHAR(60)      NULL,
  maj_le      DATETIME     NOT NULL,
  maj_par     VARCHAR(160)     NULL,
  INDEX idx_erp_cles_portail (portail)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO erp_cles (cle, valeur, secret, indice, portail, integration, maj_le, maj_par)
SELECT CONCAT('mar.', module, '.', name), ciphertext, 1, hint, 'mar',
       LEFT(COALESCE(description, IF(module = 'social', 'Social', 'Marketing')), 60),
       updated_at, IF(updated_by IS NULL, NULL, CAST(updated_by AS CHAR))
FROM mar_keys;
