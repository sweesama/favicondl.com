# Container image for the favicondl MCP server (stdio transport).
# Used by MCP directories such as Glama to build, run and inspect the server.
# The website itself is deployed by Vercel and does not use this file.
FROM node:20-alpine

WORKDIR /app/mcp

# Install only production dependencies from the lockfile.
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY mcp/server.mjs ./

ENV NODE_ENV=production
USER node

# MCP over stdio: the client talks JSON-RPC on stdin/stdout.
CMD ["node", "server.mjs"]
