require('dotenv').config({ quiet: true });

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const {
  getSession,
  login,
  logout,
  requireJwtAuth,
  validateAuthConfig
} = require('./auth');
const { resetSession, startBot } = require('./bot');
const { closeDatabase, initializeDatabase } = require('./db/database');
const { emitLog, getState, initSocket, setResetSessionHandler } = require('./socket');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const app = express();
const server = http.createServer(app);
const io = new Server(server);

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down...`);
  closeDatabase();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] Uncaught exception:`, error);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] Unhandled rejection:`, reason);
});

async function main() {
  validateAuthConfig();
  initializeDatabase();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.get('/healthz', (req, res) => {
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '4kb' }));

  initSocket(io);
  setResetSessionHandler(resetSession);

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      emitLog('http', `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
    });
    next();
  });

  const publicDir = path.resolve(__dirname, '..', 'public');
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
  app.get('/api/auth/session', getSession);
  app.post('/api/auth/login', login);
  app.post('/api/auth/logout', logout);

  app.use(requireJwtAuth);
  io.engine.use(requireJwtAuth);

  app.use(express.static(publicDir));
  app.get('/api/state', (req, res) => {
    res.json(getState());
  });
  app.post('/api/reset-session', async (req, res) => {
    await resetSession();
    res.json({ ok: true });
  });
  server.listen(PORT, HOST, () => {
    console.log(`[${new Date().toISOString()}] Web UI running at http://${HOST}:${PORT}`);
  });

  await startBot();
}

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] Failed to start app:`, error);
  closeDatabase();
  process.exit(1);
});
