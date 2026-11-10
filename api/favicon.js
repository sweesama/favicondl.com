// GET /api/favicon?url=example.com[&size=32][&format=json|redirect]
// Older endpoint kept for existing integrations. Default: JSON.
// `domain` is still accepted and redirected to `url`. size snaps to
// 16, 32, 48, 64, 128, 180, 192, 256 or 512. Anything else in the query
// is ignored, and a non-canonical request 308s to the stable URL.
module.exports = require('./_lib/handler').createHandler({ defaultFormat: 'json' });
