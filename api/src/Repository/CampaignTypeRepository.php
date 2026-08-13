<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use RuntimeException;

/**
 * Types de campagne : la grille de cartes de la première étape de l'assistant.
 *
 * Neuf types étaient posés par un jeu de données et n'avaient jamais pu bouger.
 * Le réseau change plus vite : une carte traiteur, une opération anniversaire,
 * une ouverture de corner ne rentrent dans aucun des neuf, et il fallait
 * réécrire un fichier SQL pour en ajouter un.
 *
 * Deux règles tiennent ce dépôt :
 *
 * — un type utilisé ne se supprime pas. Les campagnes passées portent son
 *   identifiant, et l'effacer rendrait muettes des campagnes qui existent : le
 *   pilotage par type, les couleurs du calendrier, les briefs déjà imprimés.
 *   Il se désactive, ce qui le retire des choix sans toucher à l'histoire.
 * — le code ne se modifie pas. Il n'est ni affiché ni traduit ; il sert de
 *   point d'ancrage aux jeux de données et aux reprises, qui désignent
 *   « fetes » et non « Fêtes (Noël, Épiphanie…) ».
 */
final class CampaignTypeRepository
{
    /**
     * La bibliothèque d'icônes, tracés compris.
     *
     * Fermée, et côté serveur : une icône choisie ici doit se redessiner
     * identique dans l'assistant, dans le calendrier et dans les fichiers
     * d'impression, qui sont produits par l'API. Un emoji libre aurait changé
     * de dessin d'un poste à l'autre, et un téléversement aurait demandé de
     * gérer le cadrage, le contraste et le stockage pour chaque type.
     *
     * Même famille visuelle que le reste du module : linéaire, `stroke` 1,7,
     * angles arrondis, dans une boîte de 24.
     *
     * @var array<string, array{label:string, path:string}>
     */
    public const ICONS = [
        'etoile'      => ['label' => 'Étoile',        'path' => 'M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.6 5.7 21l2.3-7.1-6-4.5h7.6z'],
        'cadeau'      => ['label' => 'Cadeau',        'path' => 'M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7M12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7'],
        'sapin'       => ['label' => 'Sapin',         'path' => 'M12 2l4 6h-3l4 6h-3l4 6H4l4-6H5l4-6H6z'],
        'boutique'    => ['label' => 'Boutique',      'path' => 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6'],
        'panier'      => ['label' => 'Panier',        'path' => 'M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 1 0 .01 0M18 20a1 1 0 1 0 .01 0'],
        'gens'        => ['label' => 'Clients',       'path' => 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
        'poubelle'    => ['label' => 'Anti-gaspi',    'path' => 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14'],
        'croissant'   => ['label' => 'Viennoiserie',  'path' => 'M3 14a9 9 0 0 0 18 0c0-1-3 1-5 1s-4-2-4-4 2-5 1-5a9 9 0 0 0-10 8z'],
        'gateau'      => ['label' => 'Pâtisserie',    'path' => 'M4 21h16v-6a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4zM12 11V7M9 7V4M15 7V4M4 17h16'],
        'cafe'        => ['label' => 'Café',          'path' => 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h2a2 2 0 0 1 0 5h-2M6 3v2M10 3v2M14 3v2'],
        'plat'        => ['label' => 'Traiteur',      'path' => 'M3 16h18M4 16a8 8 0 0 1 16 0M12 5v3M2 20h20'],
        'etiquette'   => ['label' => 'Promotion',     'path' => 'M20 12l-8 8-9-9V3h8zM7.5 7.5a1 1 0 1 0 .01 0'],
        'megaphone'   => ['label' => 'Annonce',       'path' => 'M3 11l14-7v16L3 13zM7 14v5'],
        'fusee'       => ['label' => 'Lancement',     'path' => 'M5 15c-1 3 0 5 0 5s2 1 5 0M9 15l-3-3 1-4a11 11 0 0 1 9-6 11 11 0 0 1-6 9l-4 1zM14 9a1.5 1.5 0 1 0 .01 0'],
        'calendrier'  => ['label' => 'Saisonnalité',  'path' => 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
        'soleil'      => ['label' => 'Été',           'path' => 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'],
        'flocon'      => ['label' => 'Hiver',         'path' => 'M12 2v20M2 12h20M5 5l14 14M19 5L5 19'],
        'coeur'       => ['label' => 'Fidélité',      'path' => 'M12 20s-7-4.6-7-9.5A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.5c0 4.9-7 9.5-7 9.5z'],
        'poignee'     => ['label' => 'Partenariat',   'path' => 'M8 12l3 3 5-5M3 8l4-4 4 3 5-1 5 4-4 9-5-2-5 2-4-9z'],
        'ecole'       => ['label' => 'Écoles',        'path' => 'M2 8l10-4 10 4-10 4zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'],
        'bureau'      => ['label' => 'Entreprises',   'path' => 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 21V10h4a1 1 0 0 1 1 1v10M2 21h20M8 8h3M8 12h3M8 16h3'],
        'camion'      => ['label' => 'Livraison',     'path' => 'M3 7h11v9H3zM14 10h4l3 3v3h-7M6.5 19a1.5 1.5 0 1 0 .01 0M17.5 19a1.5 1.5 0 1 0 .01 0'],
        'ecran'       => ['label' => 'Digital',       'path' => 'M4 4h16v12H4zM2 20h20M9 8l4 2-4 2z'],
        'mobile'      => ['label' => 'Mobile',        'path' => 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM10 19h4'],
        'photo'       => ['label' => 'Réseaux',       'path' => 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 15l-5-5L5 21'],
        'graphique'   => ['label' => 'Performance',   'path' => 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
        'cible'       => ['label' => 'Objectif',      'path' => 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 13a1 1 0 1 0 .01 0'],
        'ticket'      => ['label' => 'Bon / voucher', 'path' => 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM13 6v12'],
        'euro'        => ['label' => 'Prix',          'path' => 'M17 6a7 7 0 1 0 0 12M3 10h9M3 14h9'],
        'horloge'     => ['label' => 'Happy hour',    'path' => 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'],
        'lieu'        => ['label' => 'Local',         'path' => 'M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11zM12 8a2 2 0 1 0 .01 0'],
        'drapeau'     => ['label' => 'Ouverture',     'path' => 'M4 22V4M4 4h13l-2 4 2 4H4'],
    ];

    /**
     * Tous les types, actifs ou non, avec ce qui empêche de les supprimer.
     *
     * `campaigns` n'est pas décoratif : c'est lui qui décide si le bouton
     * « Supprimer » a un sens. Le renvoyer avec la liste évite un aller-retour
     * par type, et surtout évite de proposer une action qui échouera.
     *
     * @return array{types:list<array<string,mixed>>, icons:list<array<string,string>>}
     */
    public function all(): array
    {
        $statement = Database::connection()->query(
            'SELECT t.id, t.code, t.label, t.description, t.color_hex,
                    t.icon_path, t.icon_key, t.default_lever_code, t.default_kpi_label,
                    t.lever_id, t.lever_badge_label, t.sort_order, t.is_active,
                    COALESCE(t.lever_badge_label, l.label) AS lever_label,
                    l.color_hex                            AS lever_color_hex,
                    (SELECT COUNT(*) FROM mar_campaign c WHERE c.type_id = t.id) AS campaigns
               FROM mar_campaign_type t
               LEFT JOIN mar_lever l ON l.id = t.lever_id
              ORDER BY t.sort_order, t.id'
        );

        $types = $statement->fetchAll();
        foreach ($types as &$type) {
            $type['id']         = (int) $type['id'];
            $type['lever_id']   = $type['lever_id'] !== null ? (int) $type['lever_id'] : null;
            $type['sort_order'] = (int) $type['sort_order'];
            $type['is_active']  = (bool) $type['is_active'];
            $type['campaigns']  = (int) $type['campaigns'];
        }

        $icons = [];
        foreach (self::ICONS as $key => $icon) {
            $icons[] = ['key' => $key, 'label' => $icon['label'], 'path' => $icon['path']];
        }

        return ['types' => $types, 'icons' => $icons];
    }

    /** @param array<string,mixed> $data */
    public function create(AuthContext $auth, array $data): int
    {
        unset($auth);

        $connection = Database::connection();
        $champs     = $this->validate($data, null);

        // Le code se dérive du nom quand il n'est pas donné : il n'est ni
        // affiché ni traduit, et le faire saisir n'apporte qu'une occasion de se
        // tromper. Il reste modifiable à la création, jamais après.
        $code = trim((string) ($data['code'] ?? ''));
        $code = $code === '' ? $this->slug($champs['label']) : $this->slug($code);

        if ($code === '') {
            throw new RuntimeException('Le nom ne donne aucun code exploitable : ajoutez des lettres.');
        }

        $existe = $connection->prepare('SELECT 1 FROM mar_campaign_type WHERE code = :code');
        $existe->execute(['code' => $code]);
        if ($existe->fetchColumn() !== false) {
            throw new RuntimeException(sprintf('Un type porte déjà le code « %s ».', $code));
        }

        // En fin de liste : un type nouveau n'a pas à s'insérer avant ceux que
        // l'équipe a l'habitude de voir en premier.
        $rang = (int) $connection->query('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM mar_campaign_type')
            ->fetchColumn();

        $statement = $connection->prepare(
            'INSERT INTO mar_campaign_type
                (code, label, description, color_hex, icon_path, icon_key,
                 lever_id, lever_badge_label, default_kpi_label, sort_order, is_active)
             VALUES
                (:code, :label, :description, :color_hex, :icon_path, :icon_key,
                 :lever_id, :lever_badge_label, :default_kpi_label, :sort_order, 1)'
        );
        $statement->execute($champs + ['code' => $code, 'sort_order' => $rang]);

        return (int) $connection->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public function update(int $id, array $data): bool
    {
        $connection = Database::connection();

        $lecture = $connection->prepare(
            'SELECT label, description, color_hex, icon_key, icon_path, lever_id,
                    lever_badge_label, default_kpi_label, is_active
               FROM mar_campaign_type WHERE id = :id'
        );
        $lecture->execute(['id' => $id]);
        $existant = $lecture->fetch();

        if ($existant === false) {
            return false;
        }

        // Fusion, pas remplacement. Un appel qui ne porte que le nom ne doit pas
        // effacer l'icône, la couleur et le levier au passage : c'est ce que
        // fait une mise à jour partielle interprétée comme une réécriture, et
        // rien ne le signale — la carte se vide, simplement.
        $fusion = [
            'label'             => $data['label']             ?? $existant['label'],
            'description'       => $data['description']       ?? $existant['description'],
            'color_hex'         => $data['color_hex']         ?? $existant['color_hex'],
            'icon_key'          => $data['icon_key']          ?? $existant['icon_key'],
            'lever_id'          => $data['lever_id']          ?? $existant['lever_id'],
            'lever_badge_label' => $data['lever_badge_label'] ?? $existant['lever_badge_label'],
            'default_kpi_label' => $data['default_kpi_label'] ?? $existant['default_kpi_label'],
        ];

        // Vider un champ reste possible : c'est la chaîne vide qui l'exprime,
        // explicitement, là où l'absence de clé ne dit rien.
        foreach ($fusion as $cle => $valeur) {
            if (array_key_exists($cle, $data) && ($data[$cle] === '' || $data[$cle] === null)) {
                $fusion[$cle] = null;
            }
        }

        $champs = $this->validate($fusion, $id);

        // Les types livrés portent un tracé sans clé : ils sont antérieurs à la
        // bibliothèque. Redériver le tracé depuis la clé les effacerait au
        // premier changement de nom — l'icône disparaîtrait de la carte, sans
        // qu'on ait touché à l'icône. Tant que l'appel ne parle pas d'icône, on
        // laisse la sienne.
        if (!array_key_exists('icon_key', $data)) {
            $champs['icon_key']  = $existant['icon_key'];
            $champs['icon_path'] = $existant['icon_path'];
        }

        $statement = $connection->prepare(
            'UPDATE mar_campaign_type
                SET label = :label, description = :description, color_hex = :color_hex,
                    icon_path = :icon_path, icon_key = :icon_key,
                    lever_id = :lever_id, lever_badge_label = :lever_badge_label,
                    default_kpi_label = :default_kpi_label,
                    is_active = :is_active
              WHERE id = :id'
        );

        $statement->execute($champs + [
            'id'        => $id,
            // Absent du corps = inchangé : l'éditeur n'envoie pas toujours
            // l'activation, et la ramener à 1 par défaut réactiverait un type
            // qu'on venait de retirer.
            'is_active' => array_key_exists('is_active', $data)
                ? (filter_var($data['is_active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0)
                : (int) $existant['is_active'],
        ]);

        return true;
    }

    /**
     * Supprime un type, ou refuse si des campagnes s'en réclament.
     *
     * @return array{deleted:bool, campaigns:int}
     */
    public function delete(int $id): array
    {
        $connection = Database::connection();

        $usage = $connection->prepare('SELECT COUNT(*) FROM mar_campaign WHERE type_id = :id');
        $usage->execute(['id' => $id]);
        $campagnes = (int) $usage->fetchColumn();

        if ($campagnes > 0) {
            // Refuser plutôt que délier : mettre `type_id` à NULL rendrait
            // muettes des campagnes qui existent, et le pilotage par type
            // perdrait des lignes sans que rien ne l'annonce.
            return ['deleted' => false, 'campaigns' => $campagnes];
        }

        $suppression = $connection->prepare('DELETE FROM mar_campaign_type WHERE id = :id');
        $suppression->execute(['id' => $id]);

        return ['deleted' => $suppression->rowCount() > 0, 'campaigns' => 0];
    }

    /**
     * Ordre d'affichage, tel que l'écran vient de le composer.
     *
     * @param list<int|string> $ids
     */
    public function reorder(array $ids): int
    {
        $connection = Database::connection();
        $statement  = $connection->prepare(
            'UPDATE mar_campaign_type SET sort_order = :rang WHERE id = :id'
        );

        $connection->beginTransaction();

        try {
            $rang = 0;
            foreach ($ids as $id) {
                $statement->execute(['rang' => ++$rang, 'id' => (int) $id]);
            }

            $connection->commit();
        } catch (\Throwable $echec) {
            $connection->rollBack();

            throw $echec;
        }

        return count($ids);
    }

    /**
     * Contrôle des champs communs à la création et à la mise à jour.
     *
     * @param  array<string,mixed> $data
     * @return array<string,mixed>
     */
    private function validate(array $data, ?int $id): array
    {
        unset($id);

        $label = trim((string) ($data['label'] ?? ''));
        if ($label === '') {
            throw new RuntimeException('Le nom du type est obligatoire.');
        }

        if (mb_strlen($label) > 120) {
            throw new RuntimeException('Le nom du type dépasse 120 caractères.');
        }

        // L'icône est prise dans la bibliothèque, jamais dans le corps de la
        // requête : accepter un tracé arbitraire ferait entrer du SVG écrit
        // ailleurs dans des pages et des PDF que le module signe.
        $cle = trim((string) ($data['icon_key'] ?? ''));
        if ($cle !== '' && !isset(self::ICONS[$cle])) {
            throw new RuntimeException(sprintf('Icône inconnue : « %s ».', $cle));
        }

        $couleur = $this->couleur($data['color_hex'] ?? null);

        $levier = $data['lever_id'] ?? null;
        if (!empty($levier)) {
            $existe = Database::connection()->prepare('SELECT 1 FROM mar_lever WHERE id = :id');
            $existe->execute(['id' => (int) $levier]);
            if ($existe->fetchColumn() === false) {
                throw new RuntimeException('Levier introuvable.');
            }
        }

        return [
            'label'             => $label,
            'description'       => $this->texte($data['description'] ?? null, 300),
            'color_hex'         => $couleur,
            // Le tracé est recopié depuis la bibliothèque : tout ce qui dessine
            // aujourd'hui lit `icon_path`, l'impression comprise, et n'a pas à
            // connaître les clés.
            'icon_key'          => $cle === '' ? null : $cle,
            'icon_path'         => $cle === '' ? null : self::ICONS[$cle]['path'],
            'lever_id'          => empty($levier) ? null : (int) $levier,
            'lever_badge_label' => $this->texte($data['lever_badge_label'] ?? null, 60),
            'default_kpi_label' => $this->texte($data['default_kpi_label'] ?? null, 160),
        ];
    }

    private function texte(mixed $valeur, int $max): ?string
    {
        $texte = trim((string) ($valeur ?? ''));

        if ($texte === '') {
            return null;
        }

        return mb_substr($texte, 0, $max);
    }

    /** `#abc` est développé, tout le reste est refusé plutôt que corrigé. */
    private function couleur(mixed $valeur): ?string
    {
        $brut = strtolower(trim((string) ($valeur ?? '')));

        if ($brut === '') {
            return null;
        }

        if (preg_match('/^#([0-9a-f]{3})$/', $brut, $court) === 1) {
            return '#' . $court[1][0] . $court[1][0] . $court[1][1] . $court[1][1] . $court[1][2] . $court[1][2];
        }

        if (preg_match('/^#[0-9a-f]{6}$/', $brut) !== 1) {
            throw new RuntimeException('Couleur invalide : format attendu #RRGGBB.');
        }

        return $brut;
    }

    /**
     * Code technique dérivé d'un nom : « Fêtes (Noël) » donne « fetes_noel ».
     *
     * Les accents sont ramenés à leur lettre plutôt que supprimés — « fetes »
     * se retrouve, « fts » ne se retrouve pas.
     */
    private function slug(string $texte): string
    {
        $sans = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $texte);
        $sans = $sans === false ? $texte : $sans;
        $sans = strtolower(preg_replace('/[^A-Za-z0-9]+/', '_', $sans) ?? '');

        return mb_substr(trim($sans, '_'), 0, 40);
    }
}
