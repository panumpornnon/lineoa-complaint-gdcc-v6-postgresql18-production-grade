import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';

import config from './config.js';
import { checkDatabase, pool } from './db.js';
import publicRouter from './routes/public.js';
import complaintsRouter from './routes/complaints.js';
import adminRouter from './routes/admin.js';
import webhookRouter from './routes/webhook.js';
import { notFoundHandler, errorHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { ensureUploadDirectory } from './services/uploads.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.resolve(__dirname, '../public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(requestContext);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://static.line-scdn.net', 'https://unpkg.com'],
        "connect-src": ["'self'", "https://api.line.me", "https://access.line.me", "https://liff.line.me", "https://*.line.me", "https://*.line-scdn.net"],
        "img-src": ["'self'", 'data:', 'blob:', 'https://profile.line-scdn.net', 'https://*.line-scdn.net', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://unpkg.com'],
        "frame-src": ["'self'", "https://access.line.me", "https://liff.line.me", "https://*.line.me"],
        "style-src": ["'self'", 'https://unpkg.com'],
        "font-src": ["'self'", 'data:'],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'self'", 'https://access.line.me'],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  }),
);

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/webhook') {
    res.setHeader('cache-control', 'no-store');
  }
  next();
});

// Webhook ต้องตรวจลายเซ็นจาก raw request body ก่อน express.json()
app.use('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), webhookRouter);

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'x-dev-user-id', 'x-dev-display-name'],
  maxAge: 600,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'มีการเรียกใช้งานมากเกินไป กรุณาลองใหม่ภายหลัง' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'เข้าสู่ระบบผิดหลายครั้ง กรุณารอแล้วลองใหม่' },
});

app.get('/health/live', (req, res) => res.json({ status: 'ok', service: 'lineoa-complaint-api' }));
app.get('/health/ready', async (req, res) => {
  const db = await checkDatabase();
  res.json({ status: 'ready', databaseTime: db.now, databaseVersion: db.server_version, databaseMajor: db.server_major, environment: config.nodeEnv });
});
app.get('/health', async (req, res) => {
  const db = await checkDatabase();
  res.json({ status: 'ok', databaseTime: db.now, databaseVersion: db.server_version, databaseMajor: db.server_major, environment: config.nodeEnv });
});

app.use('/api', apiLimiter);
app.use('/api', publicRouter);
app.use('/api/complaints', complaintsRouter);
app.use('/api/admin/login', loginLimiter);
app.use('/api/admin', adminRouter);

app.use(express.static(publicPath, {
  extensions: ['html'],
  maxAge: 0,
  etag: true,
  immutable: false,
}));

app.use(notFoundHandler);
app.use(errorHandler);

let server;
try {
  await ensureUploadDirectory();
  await checkDatabase();
  server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('server_started', { port: config.port });
  });
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs + 5_000, 60_000);
  server.keepAliveTimeout = 5_000;
} catch (error) {
  logger.error('startup_failed', { error: error.message, stack: error.stack });
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });

  const forceTimer = setTimeout(() => {
    logger.error('shutdown_forced', { timeoutMs: config.shutdownTimeoutMs });
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();

  server.close(async (error) => {
    if (error) logger.error('http_server_close_error', { error: error.message });
    try {
      await pool.end();
      clearTimeout(forceTimer);
      logger.info('shutdown_completed');
      process.exit(error ? 1 : 0);
    } catch (dbError) {
      logger.error('database_pool_close_error', { error: dbError.message });
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { error: String(reason) }));
process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});
