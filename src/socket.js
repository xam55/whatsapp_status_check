const targets = require('./services/targets');

let ioInstance = null;
let lastStatus = {
  connected: false,
  message: 'Not connected'
};
let lastQr = null;
const logs = [];
let resetSessionHandler = null;

function pushLog(level, message) {
  const item = {
    level,
    message,
    time: new Date().toISOString()
  };

  logs.unshift(item);
  if (logs.length > 100) logs.pop();

  if (ioInstance) {
    ioInstance.emit('log', item);
  }
}

function serializeTargets() {
  const list = targets.getTargets();
  return {
    list,
    watchingAll: targets.isWatchingAll()
  };
}

function emitTargets(socket = ioInstance) {
  if (!socket) return;
  socket.emit('targets', serializeTargets());
}

function emitStatus(status) {
  lastStatus = {
    connected: Boolean(status.connected),
    message: status.message || (status.connected ? 'Connected' : 'Not connected')
  };

  if (ioInstance) {
    ioInstance.emit('status', lastStatus);
  }

  pushLog(lastStatus.connected ? 'ok' : 'info', lastStatus.message);
}

function emitQr(payload) {
  lastQr = payload;
  if (ioInstance) {
    ioInstance.emit('qr', payload);
  }
  pushLog('info', 'QR generated and sent to browser.');
}

function clearQr() {
  lastQr = null;
  if (ioInstance) {
    ioInstance.emit('qr_cleared');
  }
}

function emitViewed(payload) {
  if (ioInstance) {
    ioInstance.emit('viewed', payload);
  }
}

function emitDebug(payload) {
  const event = {
    level: payload.level || 'info',
    message: payload.message,
    time: payload.time || new Date().toISOString()
  };

  logs.unshift(event);
  if (logs.length > 100) logs.pop();

  if (ioInstance) {
    ioInstance.emit('debug', event);
    ioInstance.emit('log', event);
  }
}

function emitLog(level, message) {
  pushLog(level, message);
}

function setResetSessionHandler(handler) {
  resetSessionHandler = handler;
}

function getState() {
  return {
    status: lastStatus,
    hasQr: Boolean(lastQr),
    qr: lastQr,
    targets: serializeTargets(),
    logs
  };
}

function initSocket(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    pushLog('info', `UI connected: ${socket.id}`);
    socket.emit('status', lastStatus);
    socket.emit('logs', { list: logs });
    if (!lastStatus.connected && lastQr) {
      socket.emit('qr', lastQr);
    }
    emitTargets(socket);

    socket.on('get_targets', () => {
      pushLog('info', `get_targets from ${socket.id}`);
      emitTargets(socket);
    });

    socket.on('add_target', (payload = {}) => {
      try {
        const target = targets.addTarget(payload.number, payload.label);
        pushLog('ok', `Added target ${target.number}${target.label ? ` (${target.label})` : ''}`);
        emitTargets();
      } catch (error) {
        pushLog('error', `add_target failed: ${error.message}`);
        socket.emit('status', {
          connected: lastStatus.connected,
          message: error.message
        });
      }
    });

    socket.on('remove_target', (payload = {}) => {
      try {
        targets.removeTarget(payload.number);
        pushLog('warn', `Removed target ${payload.number}`);
        emitTargets();
      } catch (error) {
        pushLog('error', `remove_target failed: ${error.message}`);
        socket.emit('status', {
          connected: lastStatus.connected,
          message: error.message
        });
      }
    });

    socket.on('reset_session', async () => {
      if (!resetSessionHandler) {
        pushLog('error', 'reset_session failed: reset handler is not ready.');
        return;
      }

      try {
        pushLog('warn', `Session reset requested from UI: ${socket.id}`);
        await resetSessionHandler();
      } catch (error) {
        pushLog('error', `reset_session failed: ${error.message}`);
        socket.emit('status', {
          connected: false,
          message: error.message
        });
      }
    });
  });
}

module.exports = {
  clearQr,
  emitDebug,
  emitLog,
  emitQr,
  emitStatus,
  emitTargets,
  emitViewed,
  getState,
  initSocket,
  setResetSessionHandler
};
