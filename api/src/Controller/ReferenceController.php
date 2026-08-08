<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\ReferenceRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class ReferenceController
{
    public function __construct(private readonly ReferenceRepository $references = new ReferenceRepository())
    {
    }

    /** Tous les référentiels en un appel — remplace les tableaux en dur du prototype. */
    public function index(Request $request): array
    {
        unset($request);

        return Response::data($this->references->all());
    }

    public function brands(Request $request): array
    {
        unset($request);

        return Response::data($this->references->brands());
    }

    /** Boutiques visibles par l'appelant — l'étape « périmètre » de l'assistant. */
    public function shops(Request $request): array
    {
        unset($request);

        return Response::data($this->references->shops(AuthContext::current()));
    }
}
