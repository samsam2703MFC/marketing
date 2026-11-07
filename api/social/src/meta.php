<?php
declare(strict_types=1);

/**
 * Meta Graph / Marketing API — le seul point du module qui parle à Meta.
 *
 * Mêmes règles que le client lecture seule du BO (src/meta_graph.php) :
 *
 *  1. un System User du Business Manager (token longue durée). Le token, la
 *     clé secrète de l'app et le jeton du webhook sont stockés et LUS dans
 *     `mar_sa_parametre` (clés meta_system_token, meta_app_secret,
 *     meta_verify_token, marquées secrètes : jamais renvoyées au navigateur).
 *     Au premier lancement, ceux de Brand Guard (BO) y sont recopiés ; un
 *     champ resté VIDE reprend la connexion partagée du CRM candidat (table
 *     `meta_connexion`, même base, même application Meta — voir plus bas) ;
 *  2. les tokens de Page se demandent à Meta (`/me/accounts`) au moment de
 *     publier, et ne quittent pas le processus ;
 *  3. tout appel passe par `call()` : la version d'API est un réglage, les
 *     codes d'erreur que l'écran explique (190 token expiré, 368 Page
 *     restreinte, 2 délai dépassé) sont conservés tels quels, le rate limit se
 *     rejoue avec un délai qui double.
 *
 * `$transport` s'injecte pour les tests : un Graph simulé rend les mêmes
 * tableaux que le vrai, la logique se vérifie sans réseau ni token.
 */
final class MetaError extends RuntimeException
{
    public function __construct(string $message, public int $metaCode = 0, public int $http = 0, public bool $transient = false)
    {
        parent::__construct($message);
    }
}

final class Meta
{
    /** @var null|callable(string $method, string $url, array $params): array{0:int,1:?array} */
    public static $transport = null;
    /** @var null|callable(int $s): void */
    public static $sleep = null;
    private static ?array $pageTokens = null;

    /** Clé de l'écran → [réglage du module, clé commune d'erp_cles] (mêmes noms des deux côtés). */
    private const CLES = ['systemToken' => ['meta_system_token', 'meta_system_token'], 'appSecret' => ['meta_app_secret', 'meta_app_secret'],
        'verifyToken' => ['meta_verify_token', 'meta_verify_token'], 'appId' => ['meta_app_id', 'meta_app_id']];

    /**
     * Les réglages Meta : ceux du module d'abord ; un champ vide reprend la
     * connexion Meta commune de l'ERP (table erp_cles, lignes `meta_*` tenues par
     * le Recrutement — client oct. 2026 puis 7 nov. 2026 : une table des clés
     * commune à tout l'ERP).
     */
    public static function config(): array
    {
        $s = static fn (string $k) => trim((string) (socSetting($k) ?? ''));
        $c = ['version' => $s('meta_version') ?: 'v25.0'];
        foreach (self::CLES as $k => [$local, $crm]) { $c[$k] = $s($local) ?: socMetaConnexion($crm); }
        return $c;
    }

    /** D'où vient chaque clé : 'social' (le module), 'crm' (connexion commune d'erp_cles) ou '' (absente). */
    public static function sources(): array
    {
        $out = [];
        foreach (self::CLES as $k => [$local, $crm]) {
            $out[$k] = trim((string) (socSetting($local) ?? '')) !== '' ? 'social' : (socMetaConnexion($crm) !== '' ? 'crm' : '');
        }
        return $out;
    }

    public static function configured(): bool { return self::config()['systemToken'] !== ''; }

    /** L'état pour l'écran : l'existence des secrets, jamais leur valeur. */
    public static function statut(): array
    {
        $c = self::config();
        return ['version' => $c['version'], 'tokenDefini' => $c['systemToken'] !== '',
            'secretDefini' => $c['appSecret'] !== '', 'verifyDefini' => $c['verifyToken'] !== '', 'configure' => self::configured(),
            'appId' => $c['appId'], 'jeton' => socSetting('meta_jeton_info'), 'sources' => self::sources(),
            // La connexion partagée du CRM : disponible ou non, et son application — jamais un secret.
            'crm' => ['dispo' => socMetaConnexion('meta_system_token') !== '', 'appId' => socMetaConnexion('meta_app_id')]];
    }

    /**
     * Ce que Meta dit du token : valide ou non, date d'expiration, permissions
     * réellement accordées, application. Exige l'identifiant de l'application
     * et sa clé secrète (jeton d'application `app_id|app_secret`).
     */
    public static function verifierJeton(): ?array
    {
        $c = self::config();
        if ($c['systemToken'] === '' || $c['appId'] === '' || $c['appSecret'] === '') { return null; }
        try {
            $r = self::call('GET', 'debug_token', ['input_token' => $c['systemToken']], $c['appId'] . '|' . $c['appSecret']);
            $d = (array) ($r['data'] ?? []);
            $info = ['valide' => !empty($d['is_valid']), 'expire' => !empty($d['expires_at']) ? date('Y-m-d', (int) $d['expires_at']) : 'jamais',
                'scopes' => array_values((array) ($d['scopes'] ?? [])), 'app' => (string) ($d['application'] ?? ''), 'appId' => (string) ($d['app_id'] ?? ''),
                'type' => (string) ($d['type'] ?? ''), 'erreur' => $d['error']['message'] ?? null, 'le' => date('Y-m-d H:i')];
            if ($info['appId'] !== '' && $info['appId'] !== $c['appId']) { $info['erreur'] = 'le token appartient à une autre application (' . $info['appId'] . ')'; }
        } catch (MetaError $e) {
            $info = ['valide' => false, 'erreur' => $e->getMessage(), 'le' => date('Y-m-d H:i'), 'scopes' => []];
        }
        socSettingPut('meta_jeton_info', $info);
        return $info;
    }

    public static function base(): string { return 'https://graph.facebook.com/' . self::config()['version'] . '/'; }

    /**
     * Un appel Graph. `$token` null : le token du System User.
     * Les tableaux et objets des paramètres partent en JSON, comme Meta l'attend.
     */
    public static function call(string $method, string $path, array $params = [], ?string $token = null): array
    {
        $url = str_starts_with($path, 'http') ? $path : self::base() . ltrim($path, '/');
        // Une URL de pagination (`paging.next`) porte déjà son token.
        if (!str_contains($url, 'access_token=')) {
            $params['access_token'] = $token ?? self::config()['systemToken'];
            if ($params['access_token'] === '') { unset($params['access_token']); }
        }
        foreach ($params as $k => $v) {
            if (is_array($v)) { $params[$k] = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
            elseif (is_bool($v)) { $params[$k] = $v ? 'true' : 'false'; }
        }
        $delai = 1;
        for ($essai = 0; $essai < 5; $essai++) {
            [$code, $body] = self::$transport ? (self::$transport)($method, $url, $params) : self::curl($method, $url, $params);
            $err = is_array($body) ? ($body['error'] ?? null) : null;
            if ($code >= 200 && $code < 300 && $err === null) { return is_array($body) ? $body : []; }
            $ec = is_array($err) ? (int) ($err['code'] ?? 0) : 0;
            $msg = is_array($err) ? trim((string) ($err['error_user_msg'] ?? '') ?: (string) ($err['message'] ?? '')) : ('HTTP ' . $code);
            if ($code === 429 || in_array($ec, [4, 17, 32, 613, 80004], true)) {
                if ($essai < 3) { self::dormir($delai); $delai *= 2; continue; }
                throw new MetaError('limite d’appels Meta atteinte : ' . $msg, $ec, $code, true);
            }
            if ($code === 0) { throw new MetaError('Meta injoignable : ' . $msg, 2, 0, true); }
            // L'app Meta du module en mode Développement : Meta le dit sans dire quoi faire.
            if (preg_match('/en cours de d[ée]veloppement|in development mode/iu', $msg)) {
                $msg .= ' → À faire une fois : passer l’app Meta du module en mode Live (developers.facebook.com → l’app → interrupteur « Mode de l’app » en haut).';
            }
            throw new MetaError($msg !== '' ? $msg : 'réponse illisible de Meta', $ec, $code, $ec === 2 || $code >= 500);
        }
        throw new MetaError('limite d’appels Meta atteinte', 4, 429, true);
    }

    private static function dormir(int $s): void
    {
        if (self::$sleep) { (self::$sleep)($s); return; }
        sleep($s);
    }

    private static function curl(string $method, string $url, array $params): array
    {
        $ch = curl_init();
        if ($method === 'GET' || $method === 'DELETE') {
            $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($params);
            curl_setopt($ch, CURLOPT_URL, $url);
            if ($method === 'DELETE') { curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE'); }
        } else {
            curl_setopt_array($ch, [CURLOPT_URL => $url, CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($params)]);
        }
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 10]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $e = curl_error($ch);
        curl_close($ch);
        if ($raw === false) { return [0, ['error' => ['message' => $e, 'code' => 2]]]; }
        return [$code, json_decode((string) $raw, true)];
    }

    /** Les tokens de Page du System User : page_id → token. Mémorisés le temps du processus. */
    public static function pageTokens(bool $forcer = false): array
    {
        if (self::$pageTokens !== null && !$forcer) { return self::$pageTokens; }
        $out = [];
        $path = 'me/accounts';
        $params = ['fields' => 'id,name,access_token,instagram_business_account', 'limit' => 100];
        for ($p = 0; $p < 10; $p++) {
            $r = self::call('GET', $path, $params);
            foreach ($r['data'] ?? [] as $pg) {
                if (!empty($pg['id']) && !empty($pg['access_token'])) {
                    $out[(string) $pg['id']] = ['token' => (string) $pg['access_token'], 'name' => (string) ($pg['name'] ?? ''),
                        'ig' => (string) ($pg['instagram_business_account']['id'] ?? '')];
                }
            }
            $next = $r['paging']['next'] ?? null;
            if (!is_string($next) || $next === '') { break; }
            $path = $next; $params = [];
        }
        return self::$pageTokens = $out;
    }

    public static function pageToken(string $pageId): string
    {
        $t = self::pageTokens()[$pageId]['token'] ?? null;
        if ($t === null) {
            throw new MetaError('la Page ' . $pageId . ' n’est pas accessible au System User (Business Manager → Utilisateurs système → Ressources)', 190);
        }
        return $t;
    }

    /** Pour les tests : oublier les tokens mémorisés. */
    public static function reset(): void { self::$pageTokens = null; socMetaConnexion(null); }
}

/* --- Connexion Meta commune de l'ERP (table erp_cles) ----------------------------------
 *
 * Le Recrutement (CRM candidat), sa page franchise, le Pilotage et ce module partagent la base.
 * La connexion Meta commune vit dans erp_cles, la table des clés de tout l'ERP : une ligne par clé,
 * en clair, portail `commun` — meta_app_id, meta_app_secret, meta_system_token, meta_verify_token,
 * meta_page_id, meta_page_token, meta_graph_version… — tenue par le CRM (« Connecter et tester »).
 * Choix du client (oct. 2026) : la MÊME application Meta. Or une application n'a qu'UNE adresse de
 * rappel pour les Pages : celle de l'API de la page franchise, qui relaie ici les leads des
 * formulaires qu'elle n'a pas validés — d'où l'adresse que ce module y inscrit (meta_relais_social),
 * et sa réponse (`formulaires` : lesquels sont les nôtres). Le module ne lit aucune table du CRM.
 */

/** Une valeur de la connexion commune ('' si absente) ; `null` vide le cache du processus. */
function socMetaConnexion(?string $cle): string
{
    static $cache = null;
    if ($cle === null) { $cache = null; return ''; }
    if ($cache === null) {
        $cache = [];
        try {
            foreach (Db::rows("SELECT cle, valeur FROM erp_cles WHERE portail = 'commun' AND cle LIKE 'meta\\_%'") as $r) { $cache[(string) $r['cle']] = trim((string) $r['valeur']); }
        } catch (Throwable $e) { /* table absente */ }
    }
    return $cache[$cle] ?? '';
}

/**
 * Inscrit l'adresse du webhook du module dans la connexion commune (erp_cles,
 * meta_relais_social), pour que l'API franchise du CRM lui relaie ce qui le
 * concerne. Écrit seulement si elle change. Rend l'adresse inscrite.
 */
function socMetaRelaisInscrire(): ?string
{
    $base = rtrim(trim((string) (socSetting('url_publique') ?? '')), '/');
    if (!preg_match('#^https?://#i', $base)) { return null; }
    $url = $base . '/api/v1/social/webhook';
    try {
        $r = Db::row("SELECT valeur FROM erp_cles WHERE cle = 'meta_relais_social'");
        if ($r !== null && (string) $r['valeur'] === $url) { return $url; }
        Db::exec("INSERT INTO erp_cles (cle, valeur, secret, indice, portail, integration, maj_le, maj_par) VALUES ('meta_relais_social', ?, 0, NULL, 'commun', 'Meta', ?, 'Social')
                  ON DUPLICATE KEY UPDATE valeur = VALUES(valeur), maj_le = VALUES(maj_le), maj_par = VALUES(maj_par)", [$url, date('Y-m-d H:i:s')]);
        socMetaConnexion(null);
        return $url;
    } catch (Throwable $e) { return null; }
}
