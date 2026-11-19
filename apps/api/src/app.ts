import express, { type ErrorRequestHandler } from 'express';
import type { BlockchainService } from './blockchain/service.js';
import { ApiError } from './errors.js';

export function createApp(blockchain: BlockchainService) {
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true);
  app.set('strict routing', true);

  // No body parser, wallet credentials, generic RPC proxy, or signing endpoints.
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only read-only GET requests are supported.'));
    }
    if (req.originalUrl.includes('?') || req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      return next(new ApiError(400, 'UNSUPPORTED_INPUT', 'Query parameters and request bodies are not accepted.'));
    }
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'qie-agentpay-api' }));
  app.get('/api/network', async (_req, res) => res.json(await blockchain.network()));
  app.get('/api/wallet/:address/balance', async (req, res) => res.json(await blockchain.balance(req.params.address)));
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found.')));

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const safeError = error instanceof ApiError ? error
      : error instanceof URIError ? new ApiError(400, 'INVALID_PATH', 'Request path is malformed.')
      : new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    res.status(safeError.status).json({ error: { code: safeError.code, message: safeError.message } });
  };
  app.use(errorHandler);
  return app;
}
