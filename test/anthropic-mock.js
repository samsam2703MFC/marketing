// API Anthropic simulée pour les tests locaux : la route Messages, avec la
// sortie structurée (output_config.format json_schema) que demande
// server/translate.js. Elle vérifie la forme de la requête (modèle, schéma,
// en-têtes) et « traduit » avec un petit lexique : connu → le mot flamand,
// inconnu → le texte suivi de « [nl] », pour que les tests le reconnaissent.
//   POST /v1/messages   Authorization: Bearer MOCK_KEY  → message assistant (JSON)
// revoke() : la clé est refusée (401 authentication_error).
import http from 'node:http';

export const MOCK_KEY = 'sk-ant-test-mock';
export const LEXICON = {
  'Pain au chocolat': 'Chocoladebroodje',
  'Tarte aux pommes': 'Appeltaart',
  'Viennoiseries': 'Koffiekoeken',
  'Le petit-déj': 'Het ontbijt',
  'Café + croissant': 'Koffie + croissant',
};
export const mockTranslate = (text, lang) => LEXICON[text] || `${text} [${lang}]`;

export function startAnthropicMock() {
  const calls = [];
  let revoked = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'request-id': `req_mock_${calls.length}` }); res.end(JSON.stringify(obj)); };
      const fail = (code, type, message) => send(code, { type: 'error', error: { type, message } });
      if (req.method !== 'POST' || !/\/v1\/messages$/.test(new URL(req.url, 'http://x').pathname)) return fail(404, 'not_found_error', 'route inconnue');
      // La clé arrive en « Authorization: Bearer » (SDK actuel) ou en x-api-key.
      const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (revoked || key !== MOCK_KEY) return fail(401, 'authentication_error', 'invalid API key');
      if (!req.headers['anthropic-version']) return fail(400, 'invalid_request_error', 'anthropic-version header required');
      let j;
      try { j = JSON.parse(body); } catch { return fail(400, 'invalid_request_error', 'corps JSON invalide'); }
      const fmt = j.output_config && j.output_config.format;
      if (!j.model || !j.max_tokens || !Array.isArray(j.messages) || !fmt || fmt.type !== 'json_schema' || !fmt.schema) {
        return fail(400, 'invalid_request_error', 'model, max_tokens, messages et output_config.format (json_schema) requis');
      }
      if ('temperature' in j || 'top_p' in j) return fail(400, 'invalid_request_error', 'sampling parameters are not supported');
      let ask;
      try { ask = JSON.parse(j.messages[0].content); } catch { return fail(400, 'invalid_request_error', 'contenu utilisateur : JSON attendu'); }
      calls.push({ model: j.model, lang: ask.target, n: (ask.items || []).length, system: String(j.system || '') });
      const translations = (ask.items || []).map((it) => ({ id: it.id, text: mockTranslate(it.text, ask.target) }));
      const text = JSON.stringify({ translations });
      send(200, {
        id: `msg_mock_${calls.length}`, type: 'message', role: 'assistant', model: j.model,
        content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 400 + body.length / 4 | 0, output_tokens: text.length / 4 | 0 },
      });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({
      url: `http://127.0.0.1:${server.address().port}`, calls,
      revoke: (on = true) => { revoked = on; },
      close: () => server.close(),
    });
  }));
}
