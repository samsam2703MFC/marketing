<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Le catalogue des réglages et des secrets du module Marketing : ce que l'écran
 * « Variables et clés » propose, et ce que l'import du `.env` verse en base.
 *
 * Une variable du code qui n'est pas ici se lit quand même (par `Config::get`) ;
 * le catalogue sert à la nommer, la décrire et la regrouper.
 */
final class Settings
{
    /** @var array<string, array{group:string, label:string, help:string}> */
    public const VARIABLES = [
        'MAR_ERP_AUTH_BASE'       => ['group' => 'ERP', 'label' => 'Adresse de connexion de l\'ERP', 'help' => 'Où les identifiants réseau sont vérifiés (POST …/admin/auth/login). Par défaut : MAR_ERP_API_BASE.'],
        'MAR_ERP_API_BASE'        => ['group' => 'ERP', 'label' => 'Adresse de l\'API de l\'ERP', 'help' => 'Tarifs des boutiques, promotions, bons de campagne (créés dans TFBuddy). Vide : aucun appel, les prix viennent du catalogue.'],
        'MAR_ERP_API_PHONE'       => ['group' => 'ERP', 'label' => 'Compte de service de l\'ERP (téléphone)', 'help' => 'Compte du réalm admin, droit MENU.BUNDLE.MANAGE, quand aucun jeton fixe n\'est posé. Pour créer les bons, il doit aussi pouvoir écrire les promotions et les campagnes de bons.'],
        'MAR_ERP_API_TIMEOUT'     => ['group' => 'ERP', 'label' => 'Délai des appels à l\'ERP (s)', 'help' => '5 par défaut.'],
        'MAR_ERP_PRICE_LIST_PATH' => ['group' => 'ERP', 'label' => 'Chemin du tarif d\'une boutique', 'help' => '/api/v1/shops/{shop}/products/price-list/document par défaut.'],
        'MAR_ERP_BRANDS_TABLE'    => ['group' => 'ERP', 'label' => 'Table des marques de l\'ERP', 'help' => 'À renseigner seulement si la reprise ne la trouve pas seule.'],
        'MAR_WEBSHOP_API_BASE'    => ['group' => 'Webshop', 'label' => 'Adresse de l\'API du webshop', 'help' => 'Rayons, et relecture des anciens bons du webshop (les nouveaux se créent dans TFBuddy).'],
        'MAR_WEBSHOP_API_TIMEOUT' => ['group' => 'Webshop', 'label' => 'Délai des appels au webshop (s)', 'help' => ''],
        'MAR_PUBLIC_BASE_URL'     => ['group' => 'Module', 'label' => 'Adresse publique du module', 'help' => 'https://<hôte>/marketing — pour les adresses absolues de la médiathèque. Vide : l\'hôte de la requête.'],
        'MAR_UPLOAD_DIR'          => ['group' => 'Module', 'label' => 'Dossier des fichiers envoyés', 'help' => 'Chemin sur le serveur. Vide : uploads/ à la racine du module.'],
        'MAR_UPLOAD_FOLDER'       => ['group' => 'Module', 'label' => 'Nom public du dossier des envois', 'help' => 'uploads par défaut.'],
    ];

    /**
     * `deploy` : tirée et entretenue par le déploiement (le module Social et le cockpit
     * reçoivent la même valeur par le fichier service-token) — elle ne se change pas
     * depuis l'écran, sous peine de couper Social ou de déconnecter tout le monde.
     *
     * @var array<string, array{group:string, label:string, help:string, deploy:bool}>
     */
    public const KEYS = [
        'MAR_SESSION_SECRET'    => ['group' => 'Module', 'label' => 'Secret des sessions', 'help' => 'Signe les cookies de connexion. Le changer déconnecte tout le monde.', 'deploy' => true],
        'MAR_SERVICE_TOKEN'     => ['group' => 'Module', 'label' => 'Jeton de service', 'help' => 'Présenté par Social et le cockpit (X-Marketing-Service).', 'deploy' => true],
        'MAR_ERP_API_TOKEN'     => ['group' => 'ERP', 'label' => 'Jeton fixe de l\'ERP', 'help' => 'Facultatif : sans lui, le module se connecte avec le compte de service.', 'deploy' => false],
        'MAR_ERP_API_PASSWORD'  => ['group' => 'ERP', 'label' => 'Mot de passe du compte de service de l\'ERP', 'help' => '', 'deploy' => false],
        'MAR_WEBSHOP_API_TOKEN' => ['group' => 'Webshop', 'label' => 'Jeton d\'administration du webshop', 'help' => 'En-tête X-Admin-Token.', 'deploy' => false],
    ];

    /**
     * Verse en base ce que l'environnement porte encore, sans rien écraser : une valeur
     * déjà en base l'emporte. Rend ce qui a été versé.
     *
     * @return array{variables:list<string>, keys:list<string>, skippedKeys:list<string>}
     */
    public static function importFromEnvironment(): array
    {
        $done = ['variables' => [], 'keys' => [], 'skippedKeys' => []];

        $variables = Config::all();
        foreach (array_keys(self::VARIABLES) as $name) {
            $value = Env::get($name);
            if ($value !== null && $value !== '' && !isset($variables[$name])) {
                Config::put($name, $value, 'marketing', null, null);
                $done['variables'][] = $name;
            }
        }

        $present = array_column(Keys::describe(), 'name');
        foreach (array_keys(self::KEYS) as $name) {
            $value = Env::get($name);
            if ($value === null || $value === '' || in_array($name, $present, true)) {
                continue;
            }
            if (!Keys::available()) {
                $done['skippedKeys'][] = $name;
                continue;
            }
            Keys::put($name, $value, 'marketing');
            $done['keys'][] = $name;
        }

        return $done;
    }
}
