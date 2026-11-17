-- Charset explicite : le client mysql par défaut est souvent en latin1.
SET NAMES utf8mb4;

-- =============================================================================
-- 051 — Les coordonnées de chaque boutique à la dernière page du catalogue (17/11/2026)
--
-- Client : « rajouter mail, téléphone 2, QR code de l'adresse directe du webshop, la possibilité de mettre un
-- logo (différent par magasin) ».
--
-- L'e-mail vient de l'ERP (fiche publique de la boutique, `email`), comme l'adresse et le téléphone : il n'est pas
-- recopié ici. Ce que l'ERP ne porte pas se saisit dans l'assistant de la charte, boutique par boutique : un second
-- téléphone, l'adresse directe de son webshop (le QR de la dernière page ; sinon celle du réseau, `webshop_url`) et
-- son logo (une image de la médiathèque, à la place de celui de la charte dans les catalogues de cette boutique).
-- Une ligne par boutique ; rien n'est inventé : un champ vide n'imprime rien.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mar_catalogue_shop_contact (
  shop_id        BIGINT UNSIGNED NOT NULL COMMENT 'mar_shop.id',
  phone2         VARCHAR(40)         NULL COMMENT 'Second téléphone, tel qu''il s''imprime',
  webshop_url    VARCHAR(300)        NULL COMMENT 'Adresse directe du webshop de la boutique (http/https) : le QR de la dernière page',
  logo_media_id  BIGINT UNSIGNED     NULL COMMENT 'mar_media.id : le logo de la boutique dans ses catalogues',
  updated_by     BIGINT UNSIGNED     NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id),
  KEY ix_mar_catalogue_shop_contact_logo (logo_media_id),
  CONSTRAINT fk_mar_catalogue_shop_contact_shop FOREIGN KEY (shop_id) REFERENCES mar_shop (id) ON DELETE CASCADE,
  CONSTRAINT fk_mar_catalogue_shop_contact_logo FOREIGN KEY (logo_media_id) REFERENCES mar_media (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
