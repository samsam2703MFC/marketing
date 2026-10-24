<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Service\CampaignVoucherService;
use Marketing\Service\VoucherError;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Les bons d'une campagne (sous-étape « Bons » de l'assistant).
 *
 * HTTP seulement : les règles sont dans CampaignVoucherService, les bons dans
 * le webshop. Un refus du service porte son statut (404, 403, 409, 503, 422).
 */
final class CampaignVoucherController
{
    /** Champs d'un bon que l'écran envoie — rien d'autre ne passe. */
    private const FIELDS = [
        'mechanic', 'value', 'offer_item_id', 'max_qty', 'min_order', 'code',
        'starts_on', 'ends_on', 'usage_total', 'per_customer', 'target_kind', 'target_id',
        // Mécanique « promotions » : les lignes de l'étape Prix cochées (offer_item_id).
        'promotions',
    ];

    public function __construct(
        private readonly CampaignVoucherService $vouchers = new CampaignVoucherService(),
    ) {
    }

    /** `GET …/campaigns/{id}/vouchers` — les bons suivis et ce qu'ils ont donné. */
    public function index(Request $request): array
    {
        return $this->run($request, fn (int $id): array => Response::data(
            $this->vouchers->forCampaign(AuthContext::current(), $id)
        ));
    }

    /** `POST …/campaigns/{id}/vouchers` — créer un bon pour la campagne. */
    public function store(Request $request): array
    {
        return $this->run($request, function (int $id) use ($request): array {
            $created = $this->vouchers->create(AuthContext::current(), $id, $request->only(self::FIELDS));

            return Response::created('Bon créé dans le webshop.', $created['code']);
        });
    }

    /** `PATCH …/campaigns/{id}/vouchers/{code}` — modifier un bon créé pour la campagne. */
    public function update(Request $request): array
    {
        return $this->run($request, function (int $id) use ($request): array {
            $fields = $request->only(self::FIELDS);
            unset($fields['code']);
            $this->vouchers->update(AuthContext::current(), $id, (string) $request->param('code'), $fields);

            return Response::mutated('Bon modifié.');
        });
    }

    /** `PUT …/campaigns/{id}/vouchers/{code}` — rattacher un bon existant (idempotent). */
    public function attach(Request $request): array
    {
        return $this->run($request, function (int $id) use ($request): array {
            $result = $this->vouchers->attach(AuthContext::current(), $id, (string) $request->param('code'));

            return $result['created']
                ? Response::data(['status' => 'success', 'message' => 'Bon rattaché à la campagne.'], 201)
                : Response::mutated('Ce bon suit déjà la campagne.');
        });
    }

    /** `DELETE …/campaigns/{id}/vouchers/{code}` — le retirer (suspendu s'il avait été créé ici). */
    public function destroy(Request $request): array
    {
        return $this->run($request, function (int $id) use ($request): array {
            $this->vouchers->detach(AuthContext::current(), $id, (string) $request->param('code'));

            return Response::mutated('Bon retiré de la campagne.');
        });
    }

    /** `GET …/webshop-vouchers?q=` — les bons qu'on peut rattacher. */
    public function available(Request $request): array
    {
        return $this->guard(fn (): array => Response::data(
            $this->vouchers->available(AuthContext::current(), (string) ($request->queryString('q') ?? ''))
        ));
    }

    /** `GET …/webshop-offices?q=` — bureaux, pour un bon qui leur est réservé (marque). */
    public function offices(Request $request): array
    {
        return $this->guard(fn (): array => Response::data(
            $this->vouchers->offices(AuthContext::current(), (string) ($request->queryString('q') ?? ''))
        ));
    }

    /** @param callable(int): array $action */
    private function run(Request $request, callable $action): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.', 422);
        }

        return $this->guard(static fn (): array => $action($id));
    }

    /** @param callable(): array $action */
    private function guard(callable $action): array
    {
        try {
            return $action();
        } catch (VoucherError $e) {
            return Response::error($e->getMessage(), $e->status);
        }
    }
}
