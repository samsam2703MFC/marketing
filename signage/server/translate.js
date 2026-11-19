// Traduction des textes de la régie vers la langue d'un magasin (le
// néerlandais des magasins flamands d'abord), PROPOSÉE par Claude et VALIDÉE
// en régie : une proposition n'atteint jamais un écran avant validation.
//
// Modèle : Claude Haiku 5.5 par défaut (textes courts en volume, coût de
// quelques centimes pour tout le catalogue) — SIG_TRANSLATE_MODEL pour un autre.
// Clé : ANTHROPIC_API_KEY, posée par la livraison dans /etc/signage/signage.env
// (jamais en base : le miroir MySQL la recopierait).
//
// Ce qui se traduit, et d'où vient le texte français :
//   product/name           mar_sig_products.name        (sauf nom déjà donné par l'ERP)
//   category/name          mar_sig_product_categories   (idem)
//   module/name, /sub      titres et accroches des éléments affichés à l'écran
//   campaign/name, /message, /theme                  mar_sig_campaigns
//   promo_type/name        le libellé du badge de promotion
//   bundle/name, /descr    les bundles TFBuddy
import { translationSources, saveTranslationProposals } from './db.js';

export const TRANSLATE_MODEL = process.env.SIG_TRANSLATE_MODEL || 'claude-haiku-5-5';
export const translateConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const LANG_NAMES = {
  nl: 'Dutch as spoken in Flanders (Belgian Dutch)',
  en: 'English',
  de: 'German',
};
const BATCH = 60;          // textes par requête
const PARALLEL = 3;        // requêtes simultanées

// SDK chargé à la première proposition : sans node_modules (livraison
// incomplète), la régie démarre quand même — seule la proposition échoue.
let Anthropic = null;
let client = null;
async function anthropic() {
  if (!Anthropic) {
    try { Anthropic = (await import('@anthropic-ai/sdk')).default; }
    catch { throw new Error('SDK Anthropic absent du serveur (node_modules) — relancer la livraison'); }
  }
  // Identifiants lus dans l'environnement (ANTHROPIC_API_KEY) ; ANTHROPIC_BASE_URL
  // sert aux tests, qui parlent à une API simulée.
  return (client ||= new Anthropic({ timeout: 120000, maxRetries: 2 }));
}

// Sortie structurée : une traduction par identifiant reçu, rien d'autre.
const SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
};

const system = (lang) => `You translate the on-screen texts of the digital signage of L'Atelier By, a Belgian chain of bakeries and pastry shops, from French into ${LANG_NAMES[lang] || lang}. The translations are shown on screens in the shops, next to the products, to customers.

Each item has an id, a kind and a French text; some carry context (the product category, for instance). Return one translation per id.

- Use the words a Flemish bakery would print on its own price list and signs: natural, short, customer-facing. Product names follow local usage (for example « Pain au chocolat » is « Chocoladebroodje », « Tarte aux pommes » is « Appeltaart ») and keep the names Flemish customers use as they are (« Croissant », « Éclair », « Brownie »).
- Keep brand and product line names, proper nouns, numbers, quantities, units, prices and symbols unchanged (« L'Atelier By », « 4 + 2 croissants », « 3,50 € »).
- Keep every {{…}} token exactly as written; it is replaced later by shop data.
- Keep the length close to the French, and the same capitalization style.
- When a text is already in the target language or is a name that does not translate, return it unchanged.
- Return only the translation in "text": no quotes, notes or alternatives.`;

// Une requête : jusqu'à BATCH textes → { id: traduction }.
async function translateBatch(items, lang) {
  const res = await (await anthropic()).messages.create({
    model: TRANSLATE_MODEL,
    max_tokens: 16000,
    system: system(lang),
    // Des libellés courts : peu de réflexion suffit (effort bas = moins cher, plus vite).
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify({ target: lang, items }) }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude a refusé ce lot de textes');
  if (res.stop_reason === 'max_tokens') throw new Error('réponse tronquée (lot trop long)');
  const block = res.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(block ? block.text : '{}');
  const asked = new Set(items.map((x) => x.id));
  const out = {};
  for (const t of parsed.translations || []) {
    const text = String(t.text || '').trim();
    if (asked.has(t.id) && text) out[t.id] = text;
  }
  return { out, usage: res.usage || {} };
}

// Un message d'erreur qui dit quoi faire, d'après la classe d'erreur du SDK.
function explain(e) {
  if (!Anthropic) return String(e && e.message || e);
  if (e instanceof Anthropic.AuthenticationError) return 'clé API Anthropic refusée — vérifier le secret ANTHROPIC_API_KEY';
  if (e instanceof Anthropic.PermissionDeniedError) return `accès refusé au modèle ${TRANSLATE_MODEL} pour cette clé`;
  if (e instanceof Anthropic.NotFoundError) return `modèle ${TRANSLATE_MODEL} inconnu de l'API`;
  if (e instanceof Anthropic.RateLimitError) return 'limite de débit de l\'API atteinte — relancer dans une minute';
  if (e instanceof Anthropic.APIConnectionError) return 'API Anthropic injoignable depuis le serveur';
  if (e instanceof Anthropic.APIError) return `API Anthropic : ${e.status || ''} ${e.message}`.trim();
  return String(e && e.message || e);
}

// ---- Proposition en tâche de fond (le catalogue entier prend une minute) ----
let job = null;   // { lang, running, total, done, proposed, errors[], startedAt, endedAt, usage }
export const translationJob = () => job;

export function startTranslationJob(lang, { kinds = null, limit = 2000 } = {}) {
  if (job && job.running) return job;
  if (!translateConfigured()) throw new Error('clé API Anthropic absente — secret ANTHROPIC_API_KEY');
  const todo = translationSources(lang).filter((s) => s.missing && (!kinds || kinds.includes(s.kind))).slice(0, limit);
  job = { lang, running: true, total: todo.length, done: 0, proposed: 0, errors: [], startedAt: new Date().toISOString(), endedAt: null, usage: { input_tokens: 0, output_tokens: 0 }, model: TRANSLATE_MODEL };
  const cur = job;
  (async () => {
    const batches = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const items = batch.map((s) => ({ id: s.key, kind: s.kindLabel, text: s.source, ...(s.context ? { context: s.context } : {}) }));
        try {
          const { out, usage } = await translateBatch(items, lang);
          cur.usage.input_tokens += usage.input_tokens || 0;
          cur.usage.output_tokens += usage.output_tokens || 0;
          const rows = batch.filter((s) => out[s.key]).map((s) => ({ ...s, text: out[s.key] }));
          saveTranslationProposals(lang, rows, TRANSLATE_MODEL);
          cur.proposed += rows.length;
        } catch (e) {
          cur.errors.push(explain(e));
          // Clé refusée : inutile d'insister sur les lots suivants.
          if (!Anthropic || e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.NotFoundError) next = batches.length;
        }
        cur.done += batch.length;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
    cur.running = false;
    cur.endedAt = new Date().toISOString();
  })().catch((e) => { cur.errors.push(explain(e)); cur.running = false; cur.endedAt = new Date().toISOString(); });
  return job;
}

