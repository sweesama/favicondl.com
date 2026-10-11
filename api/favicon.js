// GET /api/favicon?domain=example.com[&size=128][&format=json|redirect]
// Older endpoint kept for existing integrations. Default: JSON.
module.exports = require('./_lib/handler').createHandler({ defaultFormat: 'json' });
