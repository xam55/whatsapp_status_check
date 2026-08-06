const { logView } = require('../db/database');
const { isTarget, getDisplayName } = require('../services/targets');
const { emitDebug, emitViewed } = require('../socket');

const STATUS_JID = 'status@broadcast';
const PROTOCOL_REVOKE = 0;
const LOG_STATUS_DEBUG = String(process.env.LOG_STATUS_DEBUG || 'false').toLowerCase() === 'true';

function defer(fn) {
  setImmediate(() => {
    try {
      fn();
    } catch (error) {
      emitDebug({ level: 'error', message: `Deferred status task failed: ${error.message}` });
    }
  });
}

function normalizeSenderJid(message) {
  return (
    message?.key?.participantAlt ||
    message?.key?.participantPn ||
    message?.key?.participant ||
    message?.participantAlt ||
    message?.participantPn ||
    message?.participant ||
    null
  );
}

function isStatusDelete(message) {
  return message?.message?.protocolMessage?.type === PROTOCOL_REVOKE;
}

function getDeletedStatusKey(message) {
  return message?.message?.protocolMessage?.key || null;
}

function normalizeDeleteSenderJid(message) {
  const deletedKey = getDeletedStatusKey(message);
  return (
    deletedKey?.participantAlt ||
    deletedKey?.participantPn ||
    deletedKey?.participant ||
    normalizeSenderJid(message)
  );
}

function getMessageTimestampMs(message) {
  const timestamp = message?.messageTimestamp;
  if (!timestamp) return null;
  if (typeof timestamp === 'number') return timestamp * 1000;
  if (typeof timestamp === 'bigint') return Number(timestamp) * 1000;
  if (typeof timestamp.toNumber === 'function') return timestamp.toNumber() * 1000;
  return null;
}

async function handleStatusMessage(sock, message) {
  if (!message?.key || message.key.remoteJid !== STATUS_JID) return;

  const deleted = isStatusDelete(message);
  const senderJid = deleted ? normalizeDeleteSenderJid(message) : normalizeSenderJid(message);
  if (!senderJid) {
    defer(() => emitDebug({ level: 'warn', message: 'Status detected, but sender JID is missing.' }));
    return;
  }

  const targetMatched = isTarget(senderJid);
  if (LOG_STATUS_DEBUG || !targetMatched) defer(() => {
    emitDebug({
      level: targetMatched ? 'info' : 'warn',
      message: `Status detected from ${senderJid}${targetMatched ? '' : ' - skipped: sender is not in the target list. Add this exact JID, or set WATCH_ALL=true to view all statuses.'}`
    });
  });

  if (!targetMatched) return;

  if (deleted) {
    const deletedAt = new Date();
    const name = getDisplayName(senderJid);
    const number = senderJid.split('@')[0];
    const deletedKey = getDeletedStatusKey(message);

    defer(() => {
      emitDebug({
        level: 'warn',
        message: `Status deleted from ${senderJid}${deletedKey?.id ? `, id=${deletedKey.id}` : ''}`
      });

      emitViewed({
        type: 'deleted',
        number,
        name,
        time: deletedAt.toISOString(),
        messageId: deletedKey?.id || message.key.id || null
      });
    });

    return;
  }

  const receivedAt = new Date();
  const timestampMs = getMessageTimestampMs(message);

  try {
    await sock.readMessages([message.key]);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Failed to mark status as read from ${senderJid}:`,
      error
    );
    defer(() => {
      emitDebug({
        level: 'error',
        message: `Failed to mark status as read from ${senderJid}: ${error.message}`
      });
    });
    return;
  }

  const viewedAt = new Date();
  const name = getDisplayName(senderJid);
  const number = senderJid.split('@')[0];
  const reactionMs = viewedAt.getTime() - receivedAt.getTime();
  const waLagMs = timestampMs ? Math.max(0, receivedAt.getTime() - timestampMs) : null;

  defer(() => {
    logView({
      senderJid,
      viewedAt: viewedAt.toISOString()
    });

    console.log(
      `[${viewedAt.toISOString()}] Viewed status from ${name} (${senderJid}) in ${reactionMs}ms`
    );

    emitDebug({
      level: 'ok',
      message: `Status viewed from ${senderJid} in ${reactionMs}ms${waLagMs !== null ? `, waLag=${waLagMs}ms` : ''}`
    });

    emitViewed({
      type: 'viewed',
      number,
      name,
      time: viewedAt.toISOString(),
      reactionMs,
      waLagMs
    });
  });
}

async function handleStatusUpsert(sock, upsert) {
  const messages = upsert?.messages || [];
  const statusMessages = messages.filter((message) => message?.key?.remoteJid === STATUS_JID);

  if (process.env.LOG_ALL_UPSERTS === 'true' || (LOG_STATUS_DEBUG && statusMessages.length > 0)) {
    defer(() => {
      emitDebug({
        level: statusMessages.length > 0 ? 'info' : 'debug',
        message: `messages.upsert received: total=${messages.length}, status=${statusMessages.length}`
      });
    });
  }

  await Promise.all(statusMessages.map((message) => handleStatusMessage(sock, message)));
}

module.exports = {
  handleStatusUpsert
};
