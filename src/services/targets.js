const {
  addTarget: addDbTarget,
  removeTarget: removeDbTarget,
  listTargets: listDbTargets
} = require('../db/database');

let targetMap = new Map();
let initialized = false;

function normalizeNumber(number) {
  if (!number || typeof number !== 'string') {
    throw new Error('Phone number must be a non-empty string.');
  }

  const digits = number.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Phone number must contain digits.');
  }

  return digits;
}

function normalizeTarget(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Target must be a non-empty string.');
  }

  const value = input.trim();
  if (value.endsWith('@s.whatsapp.net') || value.endsWith('@lid')) {
    return value;
  }

  return `${normalizeNumber(value)}@s.whatsapp.net`;
}

function numberToJid(number) {
  return normalizeTarget(number);
}

function syncDbToMemory() {
  targetMap = new Map();
  const dbTargets = listDbTargets();
  for (const target of dbTargets) {
    targetMap.set(target.jid, target.label || null);
  }
}

function initializeTargets() {
  if (initialized) return;

  syncDbToMemory();
  initialized = true;

  if (targetMap.size === 0) {
    console.log(`[${new Date().toISOString()}] No targets configured. Watching all contacts.`);
  } else {
    console.log(`[${new Date().toISOString()}] Loaded ${targetMap.size} target contact(s).`);
  }
}

function isWatchingAll() {
  return String(process.env.WATCH_ALL || 'false').toLowerCase() === 'true';
}

function isTarget(jid) {
  if (!jid) return false;
  if (isWatchingAll()) return true;
  return targetMap.has(jid);
}

function getTargets() {
  syncDbToMemory();
  return Array.from(targetMap.entries()).map(([jid, label]) => ({
    jid,
    number: jid,
    display: jid.split('@')[0],
    label
  }));
}

function addTarget(number, label = null) {
  const jid = normalizeTarget(number);
  const cleanLabel = label && String(label).trim() ? String(label).trim() : null;
  addDbTarget(jid, cleanLabel);
  targetMap.set(jid, cleanLabel);
  return { jid, number: jid, display: jid.split('@')[0], label: cleanLabel };
}

function removeTarget(number) {
  const jid = normalizeTarget(number);
  const removed = targetMap.delete(jid);
  removeDbTarget(jid);
  return removed;
}

function getDisplayName(jid) {
  const label = targetMap.get(jid);
  if (label) return label;

  const number = jid.split('@')[0];
  return number || jid;
}

module.exports = {
  addTarget,
  getDisplayName,
  getTargets,
  initializeTargets,
  isWatchingAll,
  isTarget,
  normalizeNumber,
  normalizeTarget,
  numberToJid,
  removeTarget
};
