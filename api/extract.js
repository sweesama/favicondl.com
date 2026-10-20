// GET /api/extract?url=example.com[&size=32][&format=json|redirect]
// Default: 302 redirect. With size (16–512) the image is an exact square PNG.
// Omit size to receive the original file.
module.exports = require('./_lib/handler').createHandler({ defaultFormat: 'redirect' });
