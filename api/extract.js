// GET /api/extract?url=example.com[&size=32][&format=json|redirect]
// Default: 302 redirect to the image. size snaps to 16, 32, 48, 64, 128,
// 180, 192, 256 or 512. Omit size for the original file. Other query
// parameters are ignored; a non-canonical request 308s to the stable URL.
module.exports = require('./_lib/handler').createHandler({ defaultFormat: 'redirect' });
