// GET /api/favicon?domain=example.com[&size=32][&format=json|redirect]
// Older endpoint kept for existing integrations. Default: JSON.
// size, when present, is an exact output side from 16 to 512.
module.exports = require('./_lib/handler').createHandler({ defaultFormat: 'json' });
