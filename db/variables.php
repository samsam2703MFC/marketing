<?php

declare(strict_types=1);

/**
 * Les réglages et les secrets du module, en base (`mar_variable`, `erp_cles`).
 *
 *   php db/variables.php import   verse en base ce que le .env porte encore, sans
 *                                 rien écraser (une valeur en base l'emporte) ;
 *   php db/variables.php list     liste les noms et leur source — jamais une clé.
 *
 * Le déploiement lance `import` après les migrations. Une clé n'est versée que si
 * la clé maîtresse est là (`MAR_KEYS_FILE`, à défaut master.key à côté du .env) ;
 * sinon elle reste lue dans le .env, et la commande le dit.
 */

require __DIR__ . '/../api/src/autoload.php';

use Marketing\Support\Config;
use Marketing\Support\Env;
use Marketing\Support\Keys;
use Marketing\Support\Settings;

$command = $argv[1] ?? 'list';

if ($command === 'import') {
    $done = Settings::importFromEnvironment();
    printf("Variables versées en base : %s\n", $done['variables'] ? implode(', ', $done['variables']) : 'aucune');
    printf("Clés versées en base (chiffrées) : %s\n", $done['keys'] ? implode(', ', $done['keys']) : 'aucune');
    if ($done['skippedKeys']) {
        printf("Clés laissées dans le .env, faute de clé maîtresse lisible : %s\n", implode(', ', $done['skippedKeys']));
    }
    exit(0);
}

if ($command === 'list') {
    $stored = Config::all();
    foreach (array_unique(array_merge(array_keys(Settings::VARIABLES), array_keys($stored))) as $name) {
        $source = isset($stored[$name]) ? 'base' : ((Env::get($name) ?? '') !== '' ? 'fichier' : 'absente');
        printf("variable  %-26s %s\n", $name, $source);
    }
    $keys = array_column(Keys::describe(), null, 'name');
    foreach (array_unique(array_merge(array_keys(Settings::KEYS), array_keys($keys))) as $name) {
        $source = isset($keys[$name]) ? ('base' . ($keys[$name]['readable'] ? '' : ' (illisible avec cette clé maîtresse)')) : ((Env::get($name) ?? '') !== '' ? 'fichier' : 'absente');
        printf("clé       %-26s %s\n", $name, $source);
    }
    exit(0);
}

fwrite(STDERR, "Usage : php db/variables.php import|list\n");
exit(2);
