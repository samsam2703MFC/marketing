<?php

declare(strict_types=1);

/**
 * Table de routage du module marketing.
 *
 * Préfixe `/api/v1/marketing/` — avec une barre oblique, à ne pas confondre avec
 * les `/api/v1/marketing-campaigns` de l'ERP, qui restent en place. Les deux
 * familles peuvent cohabiter le temps de la bascule : c'est `mar_campaign` qui
 * fait foi côté module.
 *
 * Dans l'ERP, ces routes doivent être redéclarées par le routeur de
 * l'application ; seuls les contrôleurs sont à reprendre.
 */

use Marketing\Controller\CampaignController;
use Marketing\Controller\CatalogController;
use Marketing\Controller\FundController;
use Marketing\Controller\LeadController;
use Marketing\Controller\NetworkController;
use Marketing\Controller\ReferenceController;
use Marketing\Controller\SalesController;
use Marketing\Controller\SessionController;
use Marketing\Controller\UploadController;
use Marketing\Support\Router;

return static function (Router $router): void {
    $references = new ReferenceController();
    $campaigns  = new CampaignController();
    $funds      = new FundController();
    $leads      = new LeadController();
    $session    = new SessionController();
    $catalog    = new CatalogController();
    $network    = new NetworkController();
    $sales      = new SalesController();
    $uploads    = new UploadController();

    // Session — publique : elle ne dit que si l'appelant est authentifié.
    // Le front s'en sert pour savoir s'il est embarqué dans l'ERP, auquel cas
    // l'identité est déjà posée et son écran de connexion n'a pas lieu d'être.
    $router->get('/api/v1/marketing/session', [$session, 'show'], true);

    // Référentiels
    $router->get('/api/v1/marketing/references', [$references, 'index']);
    $router->get('/api/v1/marketing/shops',      [$references, 'shops']);
    $router->get('/api/v1/marketing/brands',     [$references, 'brands']);

    // Campagnes
    $router->get('/api/v1/marketing/campaigns',                 [$campaigns, 'index']);
    $router->get('/api/v1/marketing/campaigns/calendar',        [$campaigns, 'calendar']);
    $router->get('/api/v1/marketing/campaigns/{id}',            [$campaigns, 'show']);
    $router->get('/api/v1/marketing/campaigns/{id}/monitor',    [$campaigns, 'monitor']);
    // Reprise d'un brouillon : lecture par identifiants, réécriture en bloc.
    $router->get('/api/v1/marketing/campaigns/{id}/draft',      [$campaigns, 'draft']);
    $router->put('/api/v1/marketing/campaigns/{id}/draft',      [$campaigns, 'replace']);
    $router->post('/api/v1/marketing/campaigns',                [$campaigns, 'store']);
    $router->patch('/api/v1/marketing/campaigns/{id}',          [$campaigns, 'update']);
    $router->delete('/api/v1/marketing/campaigns/{id}',         [$campaigns, 'destroy']);

    // Ventes réelles — l'historique qui éclaire l'étape « Objectifs »
    $router->get('/api/v1/marketing/sales/quantities', [$sales, 'quantities']);

    // Visuels de campagne envoyés depuis l'assistant
    $router->post('/api/v1/marketing/uploads', [$uploads, 'store']);

    // Outils de campagne
    $router->get('/api/v1/marketing/offer-items',     [$catalog, 'offerItems']);
    $router->get('/api/v1/marketing/promotions',      [$catalog, 'promotions']);
    $router->get('/api/v1/marketing/campaign-offers', [$catalog, 'campaignOffers']);
    $router->get('/api/v1/marketing/bundles',    [$catalog, 'bundles']);
    $router->get('/api/v1/marketing/vouchers',   [$catalog, 'vouchers']);

    // Leads B2B
    $router->get('/api/v1/marketing/campaigns/{id}/leads',      [$leads, 'index']);
    $router->patch('/api/v1/marketing/leads/{id}/status',       [$leads, 'updateStatus']);
    $router->get('/api/v1/marketing/leads/{id}/history',        [$leads, 'history']);
    $router->post('/api/v1/marketing/campaigns/{id}/leads/generate', [$leads, 'generate']);

    // Vivier B2B : c'est lui qui alimente la génération des leads.
    $router->get('/api/v1/marketing/b2b/sectors',           [$leads, 'sectorSummary']);
    $router->get('/api/v1/marketing/b2b/prospects',         [$leads, 'prospects']);
    $router->get('/api/v1/marketing/b2b/prospects/count',   [$leads, 'prospectCount']);
    $router->post('/api/v1/marketing/b2b/prospects/import', [$leads, 'importProspects']);

    // Reprise depuis l'ERP : boutiques et clients marqués professionnels.
    $router->post('/api/v1/marketing/erp/sync', [$leads, 'syncErp']);

    // Diffusion
    $router->get('/api/v1/marketing/diffusion',   [$network, 'diffusion']);

    // Agences et performance
    $router->get('/api/v1/marketing/agencies',            [$network, 'agencies']);
    $router->get('/api/v1/marketing/agencies/{id}/campaigns', [$network, 'interventions']);
    $router->get('/api/v1/marketing/analysis',            [$network, 'analysis']);
    $router->get('/api/v1/marketing/roi',                 [$network, 'roi']);

    // Réseau
    $router->get('/api/v1/marketing/crm',      [$network, 'crm']);
    $router->get('/api/v1/marketing/presence', [$network, 'presence']);
    $router->get('/api/v1/marketing/kits',     [$network, 'kits']);

    // Fonds, leviers et ROI
    $router->get('/api/v1/marketing/funds/ledger',              [$funds, 'ledger']);
    $router->get('/api/v1/marketing/funds/levers',              [$funds, 'leverSummary']);
    $router->post('/api/v1/marketing/funds/movements',          [$funds, 'storeMovement']);
    $router->get('/api/v1/marketing/roi/quarterly',             [$funds, 'roiQuarterly']);
    $router->get('/api/v1/marketing/campaigns/{id}/roi-costs',  [$funds, 'roiCosts']);
};
