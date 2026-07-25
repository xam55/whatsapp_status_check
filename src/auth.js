const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'wa_status_session';
const JWT_ALGORITHM = 'HS256';
const JWT_AUDIENCE = 'whatsapp-status-ui';
const JWT_ISSUER = 'whatsapp-status-bot';
const PLACEHOLDER_PASSWORD = 'CHANGE_ME_BEFORE_START';
const PLACEHOLDER_SECRET = 'CHANGE_ME_TO_A_RANDOM_SECRET_AT_LEAST_32_CHARS';
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map();

function getConfig() {
  return {
    username: String(process.env.UI_USER || '').trim(),
    password: String(process.env.UI_PASSWORD || ''),
    secret: String(process.env.JWT_SECRET || ''),
    expiresSeconds: Number(process.env.JWT_EXPIRES_SECONDS || 43_200),
    secureCookie: String(process.env.COOKIE_SECURE || 'true').toLowerCase() !== 'false'
  };
}

function validateAuthConfig() {
  const config = getConfig();

  if (!config.username || !config.password || config.password === PLACEHOLDER_PASSWORD) {
    throw new Error(
      'Set UI_USER and a strong UI_PASSWORD in .env before starting the production server.'
    );
  }

  if (config.password.length < 12) {
    throw new Error('UI_PASSWORD must contain at least 12 characters.');
  }

  if (!config.secret || config.secret === PLACEHOLDER_SECRET || config.secret.length < 32) {
    throw new Error('JWT_SECRET must be a random value containing at least 32 characters.');
  }

  if (
    !Number.isInteger(config.expiresSeconds)
    || config.expiresSeconds < 300
    || config.expiresSeconds > 604_800
  ) {
    throw new Error('JWT_EXPIRES_SECONDS must be an integer between 300 and 604800.');
  }
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual), 'utf8');
  const expectedBuffer = Buffer.from(String(expected), 'utf8');

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator < 0) return cookies;

    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

function verifyRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;

  try {
    return jwt.verify(token, getConfig().secret, {
      algorithms: [JWT_ALGORITHM],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER
    });
  } catch {
    return null;
  }
}

function getClientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getAttemptState(key) {
  const now = Date.now();
  const state = failedAttempts.get(key);

  if (!state || now - state.startedAt >= ATTEMPT_WINDOW_MS) {
    const fresh = { count: 0, startedAt: now };
    failedAttempts.set(key, fresh);
    return fresh;
  }

  return state;
}

function recordFailedAttempt(key) {
  const state = getAttemptState(key);
  state.count += 1;
}

function getRetryAfterSeconds(key) {
  const state = getAttemptState(key);
  if (state.count < MAX_FAILED_ATTEMPTS) return 0;

  return Math.max(1, Math.ceil((ATTEMPT_WINDOW_MS - (Date.now() - state.startedAt)) / 1000));
}

function setSessionCookie(res, token) {
  const config = getConfig();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: 'strict',
    path: '/',
    maxAge: config.expiresSeconds * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: getConfig().secureCookie,
    sameSite: 'strict',
    path: '/'
  });
}

function login(req, res) {
  const clientKey = getClientKey(req);
  const retryAfter = getRetryAfterSeconds(clientKey);

  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ ok: false, message: 'Too many attempts. Try again later.' });
    return;
  }

  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  const config = getConfig();
  const usernameValid = safeEqual(username, config.username);
  const passwordValid = safeEqual(password, config.password);
  const valid = usernameValid && passwordValid;

  if (!valid) {
    recordFailedAttempt(clientKey);
    res.status(401).json({ ok: false, message: 'Invalid username or password.' });
    return;
  }

  failedAttempts.delete(clientKey);
  const token = jwt.sign(
    { sub: config.username, role: 'admin' },
    config.secret,
    {
      algorithm: JWT_ALGORITHM,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      expiresIn: config.expiresSeconds
    }
  );

  setSessionCookie(res, token);
  res.json({ ok: true, user: config.username });
}

function logout(req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

function getSession(req, res) {
  const payload = verifyRequest(req);
  res.json({
    authenticated: Boolean(payload),
    user: payload?.sub || null
  });
}

function requireJwtAuth(req, res, next) {
  const payload = verifyRequest(req);

  if (payload) {
    req.auth = payload;
    next();
    return;
  }

  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, message: 'Authentication required.' }));
}

module.exports = {
  getSession,
  login,
  logout,
  requireJwtAuth,
  validateAuthConfig
};
