const path = require('path');
const fs = require('fs/promises');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const { handleStatusUpsert } = require('./handlers/status');
const targets = require('./services/targets');
const { initializeDatabase } = require('./db/database');
const { clearQr, emitLog, emitQr, emitStatus } = require('./socket');

const AUTH_DIR = path.resolve(__dirname, '..', 'auth_session');
const MAX_BACKOFF_MS = 60_000;
const FALLBACK_WA_VERSION = [2, 3000, 1035194821];

let reconnectAttempts = 0;
let reconnectTimer = null;
let socket = null;
let connected = false;
let creatingSocket = false;
let resettingSession = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay() {
  const exponential = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** reconnectAttempts));
  const jitter = Math.floor(Math.random() * 500);
  reconnectAttempts += 1;
  return exponential + jitter;
}

async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function getBaileysVersion() {
  try {
    emitStatus({ connected: false, message: 'Fetching WhatsApp Web version...' });
    const result = await withTimeout(
      fetchLatestBaileysVersion(),
      10_000,
      'WhatsApp Web version request timed out'
    );
    emitLog('ok', `Using WhatsApp Web version ${result.version.join('.')}`);
    return result.version;
  } catch (error) {
    emitLog('warn', `${error.message}. Using fallback version ${FALLBACK_WA_VERSION.join('.')}`);
    return FALLBACK_WA_VERSION;
  }
}

async function createSocket() {
  if (creatingSocket) return socket;
  creatingSocket = true;

  initializeDatabase();
  targets.initializeTargets();
  emitStatus({ connected: false, message: 'Preparing WhatsApp auth session...' });

  let saveCreds;

  try {
    const authState = await useMultiFileAuthState(AUTH_DIR);
    const { state } = authState;
    saveCreds = authState.saveCreds;
    const version = await getBaileysVersion();

    emitStatus({ connected: false, message: 'Creating WhatsApp socket...' });
    socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      connectTimeoutMs: 30_000,
      defaultQueryTimeoutMs: 60_000,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' }),
      browser: Browsers.macOS('Chrome')
    });
    emitLog('ok', 'WhatsApp socket created. Waiting for QR or connection update.');
  } finally {
    creatingSocket = false;
  }

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const image = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 8
      });
      const publicUrl = process.env.PUBLIC_URL || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`;
      console.log(`[${new Date().toISOString()}] QR code generated. Open ${publicUrl}`);
      emitQr({ image });
      emitStatus({ connected: false, message: 'Scan QR code in WhatsApp.' });
    }

    if (connection === 'connecting') {
      console.log(`[${new Date().toISOString()}] Connecting to WhatsApp...`);
      emitStatus({ connected: false, message: 'Connecting to WhatsApp...' });
      return;
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      connected = true;
      console.log(`[${new Date().toISOString()}] WhatsApp connection opened.`);
      emitStatus({ connected: true, message: 'Connected' });
      return;
    }

    if (connection === 'close') {
      if (resettingSession) return;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.warn(
        `[${new Date().toISOString()}] WhatsApp connection closed. reason=${statusCode || 'unknown'}`
      );
      connected = false;
      emitStatus({ connected: false, message: 'Disconnected. Reconnecting...' });

      if (loggedOut) {
        console.error(
          `[${new Date().toISOString()}] Session logged out. Resetting auth_session for a new QR.`
        );
        emitStatus({ connected: false, message: 'Logged out. Resetting session for a new QR...' });
        resetSession().catch((error) => {
          console.error(`[${new Date().toISOString()}] Failed to reset session after logout:`, error);
          emitStatus({ connected: false, message: `Session reset failed: ${error.message}` });
        });
        return;
      }

      scheduleReconnect();
    }
  });

  socket.ev.on('messages.upsert', (upsert) => {
    handleStatusUpsert(socket, upsert).catch((error) => {
      console.error(`[${new Date().toISOString()}] Status handler failed:`, error);
    });
  });

  return socket;
}

async function closeSocket() {
  connected = false;

  if (!socket) return;

  try {
    if (typeof socket.end === 'function') {
      socket.end(new Error('Session reset'));
    } else if (socket.ws && typeof socket.ws.close === 'function') {
      socket.ws.close();
    }
  } catch (error) {
    emitLog('warn', `Socket close warning: ${error.message}`);
  }

  socket = null;
}

async function clearAuthSession() {
  await fs.rm(AUTH_DIR, { recursive: true, force: true });
  clearQr();
  emitLog('warn', 'auth_session cleared.');
}

async function resetSession() {
  if (resettingSession) return socket;
  resettingSession = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    reconnectAttempts = 0;
    emitStatus({ connected: false, message: 'Resetting WhatsApp session...' });
    await closeSocket();
    await clearAuthSession();
    await wait(500);
    emitStatus({ connected: false, message: 'Generating new QR...' });
    return await createSocket();
  } finally {
    resettingSession = false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  const delay = getBackoffDelay();
  console.log(`[${new Date().toISOString()}] Reconnecting in ${delay}ms...`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      await wait(100);
      await createSocket();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Reconnect failed:`, error);
      scheduleReconnect();
    }
  }, delay);
}

async function startBot() {
  console.log(`[${new Date().toISOString()}] Starting WhatsApp Status Auto-Viewer Bot...`);
  return createSocket();
}

function getConnectionStatus() {
  return {
    connected,
    message: connected ? 'Connected' : 'Not connected'
  };
}

module.exports = {
  getConnectionStatus,
  resetSession,
  startBot
};
