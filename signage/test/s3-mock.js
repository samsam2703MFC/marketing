// Stockage objet compatible S3 simulé (OVHcloud Object Storage) pour les
// tests locaux : adresses « endpoint/bucket/clé » (path-style), signature AWS
// v4 VÉRIFIÉE à chaque requête (recalculée ici, indépendamment de server/s3.js),
// envoi refusé sans Content-Length (comme S3), lecture par morceaux (Range),
// ETag et If-None-Match, liste ListObjectsV2, suppression.
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';

export const MOCK_S3 = { bucket: 'signage-test', accessKey: 'OVHTESTACCESS', secretKey: 'ovh-test-secret', region: 'gra' };

const sha = (d) => createHash('sha256').update(d).digest('hex');
const hm = (k, d) => createHmac('sha256', k).update(d).digest();
const uriEnc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlError = (code, msg) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${msg}</Message></Error>`;

// Vérifie l'en-tête Authorization (AWS4-HMAC-SHA256) de la requête reçue.
function verify(req, rawPath, query) {
  const auth = String(req.headers.authorization || '');
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return 'en-tête Authorization absent ou mal formé';
  const [, access, day, region, signed, sig] = m;
  if (access !== MOCK_S3.accessKey) return 'clé d’accès inconnue';
  if (region !== MOCK_S3.region) return `région ${region} au lieu de ${MOCK_S3.region}`;
  const names = signed.split(';');
  if (!names.includes('host') || !names.includes('x-amz-date') || !names.includes('x-amz-content-sha256')) return 'host / x-amz-date / x-amz-content-sha256 non signés';
  const canonHeaders = names.map((n) => `${n}:${String(req.headers[n] == null ? '' : req.headers[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonQuery = [...query.entries()].map(([k, v]) => [uriEnc(k), uriEnc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [req.method, rawPath, canonQuery, canonHeaders, signed, req.headers['x-amz-content-sha256']].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], `${day}/${region}/s3/aws4_request`, sha(canonical)].join('\n');
  const key = hm(hm(hm(hm(`AWS4${MOCK_S3.secretKey}`, day), region), 's3'), 'aws4_request');
  return createHmac('sha256', key).update(toSign).digest('hex') === sig ? '' : 'SignatureDoesNotMatch';
}

export function startS3Mock() {
  const objects = new Map();   // clé → { body, type, etag, modified }
  const calls = [];
  let down = false;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const rawPath = u.pathname;
    calls.push(`${req.method} ${rawPath}${u.search}`);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (code, body = '', headers = {}) => { res.writeHead(code, { 'content-type': 'application/xml', ...headers }); res.end(body); };
      if (down) return send(503, xmlError('ServiceUnavailable', 'Please reduce your request rate.'));
      const why = verify(req, rawPath, u.searchParams);
      if (why) return send(403, xmlError('SignatureDoesNotMatch', why));
      const parts = rawPath.split('/');
      const bucket = decodeURIComponent(parts[1] || '');
      const key = parts.slice(2).map(decodeURIComponent).join('/');
      if (bucket !== MOCK_S3.bucket) return send(404, xmlError('NoSuchBucket', 'The specified bucket does not exist'));
      if (!key) {
        if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
          const prefix = u.searchParams.get('prefix') || '';
          const max = Number(u.searchParams.get('max-keys') || 1000);
          const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, max);
          return send(200, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`);
        }
        return send(400, xmlError('InvalidRequest', 'bucket operation not simulated'));
      }
      if (req.method === 'PUT') {
        if (req.headers['transfer-encoding'] && !req.headers['content-length']) return send(501, xmlError('NotImplemented', 'A header you provided implies functionality that is not implemented'));
        const body = Buffer.concat(chunks);
        const hash = req.headers['x-amz-content-sha256'];
        if (hash !== 'UNSIGNED-PAYLOAD' && hash !== sha(body)) return send(400, xmlError('XAmzContentSHA256Mismatch', 'The provided x-amz-content-sha256 header does not match what was computed.'));
        if (Number(req.headers['content-length']) !== body.length) return send(400, xmlError('IncompleteBody', 'You did not provide the number of bytes specified by the Content-Length HTTP header'));
        const etag = `"${createHash('md5').update(body).digest('hex')}"`;
        objects.set(key, { body, type: req.headers['content-type'] || 'binary/octet-stream', etag, modified: new Date() });
        return send(200, '', { etag });
      }
      const o = objects.get(key);
      if (req.method === 'DELETE') { objects.delete(key); return send(204); }
      if (!o) return send(404, xmlError('NoSuchKey', 'The specified key does not exist.'));
      const base = { 'content-type': o.type, etag: o.etag, 'last-modified': o.modified.toUTCString(), 'accept-ranges': 'bytes' };
      if (req.headers['if-none-match'] && req.headers['if-none-match'] === o.etag) { res.writeHead(304, base); return res.end(); }
      const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (r && (r[1] !== '' || r[2] !== '')) {
        const n = o.body.length;
        let start; let end;
        if (r[1] === '') { start = Math.max(0, n - Number(r[2])); end = n - 1; } else { start = Number(r[1]); end = r[2] === '' ? n - 1 : Math.min(Number(r[2]), n - 1); }
        if (start > end || start >= n) return send(416, xmlError('InvalidRange', 'The requested range is not satisfiable'), { 'content-range': `bytes */${n}` });
        res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${n}`, 'content-length': end - start + 1 });
        return res.end(req.method === 'HEAD' ? undefined : o.body.subarray(start, end + 1));
      }
      res.writeHead(200, { ...base, 'content-length': o.body.length });
      return res.end(req.method === 'HEAD' ? undefined : o.body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({
      url: `http://127.0.0.1:${server.address().port}`, calls, objects,
      down: (on = true) => { down = on; },
      close: () => server.close(),
    });
  }));
}
