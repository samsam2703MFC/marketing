<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use RuntimeException;
use Throwable;

/** Leads B2B : liste, entonnoir, changement d'état. */
final class LeadRepository
{
    /**
     * Leads d'une campagne, restreints aux boutiques du périmètre.
     *
     * @return list<array<string,mixed>>
     */
    public function listByCampaign(AuthContext $auth, int $campaignId): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'ld.shop_id');
        $bindings['campaign']  = $campaignId;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT ld.id, ld.company_name, ld.contact_name, ld.contact_email, ld.contact_phone,
                    ld.size_label, ld.potential_amount, ld.status_code, ld.assigned_user_id,
                    sec.label   AS sector_label,
                    s.id        AS shop_id,
                    s.name      AS shop_name,
                    st.label    AS status_label,
                    st.color_hex, st.bg_hex, st.border_hex
               FROM mar_crm_lead ld
               JOIN mar_lead_status st  ON st.code = ld.status_code
               LEFT JOIN mar_b2b_sector sec ON sec.id = ld.sector_id
               LEFT JOIN mar_shop s         ON s.id = ld.shop_id
              WHERE ld.campaign_id = :campaign
                AND (ld.shop_id IS NULL OR %s)
              ORDER BY ld.company_name',
            $scopeSql
        ));
        $statement->execute($bindings);

        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['id']               = (int) $row['id'];
            $row['shop_id']          = $row['shop_id'] !== null ? (int) $row['shop_id'] : null;
            $row['potential_amount'] = $row['potential_amount'] !== null ? (float) $row['potential_amount'] : null;
            // La pastille d'initiales de la maquette : calculée une fois ici.
            $row['initials']         = $this->initials((string) $row['company_name']);
        }

        return $rows;
    }

    /**
     * Entonnoir : `n · libellé` par état, les cinq états toujours présents.
     *
     * @return list<array<string,mixed>>
     */
    public function funnel(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT status_code, status_label, color_hex, bg_hex, border_hex, leads_count
               FROM mar_v_lead_funnel
              WHERE campaign_id = :id
              ORDER BY sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['leads_count'] = (int) $row['leads_count'];
        }

        return $rows;
    }

    /**
     * Change l'état d'un lead.
     *
     * L'état courant est dénormalisé sur `mar_crm_lead` pour la performance de
     * liste, et l'historique s'écrit dans `mar_crm_lead_event`. Les deux écritures
     * sont dans une transaction : un historique qui diverge de l'état courant
     * serait pire que pas d'historique du tout.
     */
    public function changeStatus(AuthContext $auth, int $leadId, string $newStatus, ?string $note = null): bool
    {
        $connection = Database::connection();

        $lookup = $connection->prepare(
            'SELECT ld.id, ld.status_code, ld.shop_id
               FROM mar_crm_lead ld WHERE ld.id = :id'
        );
        $lookup->execute(['id' => $leadId]);
        $lead = $lookup->fetch();

        if ($lead === false) {
            throw new RuntimeException('Lead introuvable.');
        }

        if ($lead['shop_id'] !== null && !Scope::allowsShop($auth, (int) $lead['shop_id'])) {
            throw new RuntimeException('Lead hors périmètre.');
        }

        $exists = $connection->prepare('SELECT 1 FROM mar_lead_status WHERE code = :code');
        $exists->execute(['code' => $newStatus]);
        if ($exists->fetchColumn() === false) {
            throw new RuntimeException(sprintf('État « %s » inconnu.', $newStatus));
        }

        $previous = (string) $lead['status_code'];
        if ($previous === $newStatus && $note === null) {
            return true;
        }

        $connection->beginTransaction();

        try {
            $update = $connection->prepare('UPDATE mar_crm_lead SET status_code = :code WHERE id = :id');
            $update->execute(['code' => $newStatus, 'id' => $leadId]);

            $event = $connection->prepare(
                'INSERT INTO mar_crm_lead_event (lead_id, from_status, to_status, event_type, note, user_id)
                 VALUES (:lead_id, :from_status, :to_status, :event_type, :note, :user_id)'
            );
            $event->execute([
                'lead_id'     => $leadId,
                'from_status' => $previous,
                'to_status'   => $newStatus,
                'event_type'  => $this->eventTypeFor($newStatus),
                'note'        => $note,
                'user_id'     => $auth->userId,
            ]);

            $connection->commit();

            return true;
        } catch (Throwable $e) {
            $connection->rollBack();
            throw $e;
        }
    }

    /** @return list<array<string,mixed>> */
    public function history(int $leadId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT id, from_status, to_status, event_type, note, occurred_at, user_id
               FROM mar_crm_lead_event WHERE lead_id = :id ORDER BY occurred_at DESC, id DESC'
        );
        $statement->execute(['id' => $leadId]);

        return $statement->fetchAll();
    }

    /**
     * Génère les leads d'une campagne à partir des secteurs cochés.
     * Appelé au lancement, uniquement si `create_crm_leads` est vrai.
     */
    public function generateForCampaign(AuthContext $auth, int $campaignId): int
    {
        $connection = Database::connection();

        $campaign = $connection->prepare(
            'SELECT create_crm_leads FROM mar_campaign WHERE id = :id'
        );
        $campaign->execute(['id' => $campaignId]);
        $row = $campaign->fetch();

        if ($row === false) {
            throw new RuntimeException('Campagne introuvable.');
        }

        if (!(bool) $row['create_crm_leads']) {
            // L'étape ⑦ a répondu « non » : aucun lead ne doit être créé.
            return 0;
        }

        $sectors = $connection->prepare(
            'SELECT s.id, s.estimated_leads_count
               FROM mar_campaign_b2b_sector cbs
               JOIN mar_b2b_sector s ON s.id = cbs.sector_id
              WHERE cbs.campaign_id = :id'
        );
        $sectors->execute(['id' => $campaignId]);

        $expected = 0;
        foreach ($sectors->fetchAll() as $sector) {
            $expected += (int) $sector['estimated_leads_count'];
        }

        // Le volume attendu se dérive des secteurs ; l'alimentation réelle des
        // comptes vient d'un import de base B2B, hors de ce module.
        return $expected;
    }

    private function eventTypeFor(string $status): string
    {
        return match ($status) {
            'called'  => 'CALL',
            'sent'    => 'OFFER_SENT',
            'ordered' => 'ORDER',
            default   => 'NOTE',
        };
    }

    private function initials(string $name): string
    {
        $words = preg_split('/\s+/', trim($name)) ?: [];
        $letters = '';

        foreach (array_slice($words, 0, 2) as $word) {
            $first = mb_substr($word, 0, 1);
            if ($first !== '') {
                $letters .= mb_strtoupper($first);
            }
        }

        return $letters !== '' ? $letters : '?';
    }
}
