<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Support\ImageStore;
use Marketing\Support\Request;
use Marketing\Support\Response;
use RuntimeException;

/** Visuels envoyés depuis l'assistant de campagne. */
final class UploadController
{
    public function store(Request $request): array
    {
        $content = (string) ($request->body['content'] ?? '');

        if (trim($content) === '') {
            // Un corps vide arrive aussi quand le serveur a coupé la requête
            // sur sa taille maximale : le dire évite de chercher côté image.
            return Response::error(
                'Aucun contenu reçu. Si le fichier est volumineux, le serveur a pu refuser '
                . 'l\'envoi : réessayez avec une image plus légère.'
            );
        }

        try {
            return Response::data(ImageStore::store($content));
        } catch (RuntimeException $failure) {
            return Response::error($failure->getMessage());
        }
    }
}
