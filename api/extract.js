// GET /api/extract?url=example.com[&size=128][&format=json|redirect]
// Default: 302 redirect to the best icon (served through /api/proxy).
module.exports = require('./_lib/handler').createHandler({ defaultFormat: 'redirect' });
