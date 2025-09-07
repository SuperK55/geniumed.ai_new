export function rawBodySaver(_req, _res, buf){ if (buf) _req.rawBody = buf; }
export function getRawBody(req){ return req.rawBody || Buffer.from(JSON.stringify(req.body||{})); }
