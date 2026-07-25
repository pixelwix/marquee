const net = require('net');

// Speaks NUT's (Network UPS Tools) plaintext protocol directly rather than going
// through a UI like nut-webgui — it's a small, stable, well-documented protocol,
// so this needs no scraping and no extra dependency (just Node's built-in net).
function queryVars() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: process.env.NUT_HOST, port: Number(process.env.NUT_PORT) || 3493 });
    let buffer = '';

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('NUT query timed out'));
    }, 5000);

    socket.on('connect', () => {
      socket.write(`USERNAME ${process.env.NUT_USERNAME}\n`);
      socket.write(`PASSWORD ${process.env.NUT_PASSWORD}\n`);
      socket.write(`LIST VAR ${process.env.NUT_UPS_NAME}\n`);
      socket.write('LOGOUT\n');
    });

    socket.on('data', chunk => { buffer += chunk.toString(); });

    socket.on('close', () => {
      clearTimeout(timer);
      const vars = {};
      for (const line of buffer.split('\n')) {
        const m = line.match(/^VAR \S+ (\S+) "(.*)"$/);
        if (m) vars[m[1]] = m[2];
      }
      resolve(vars);
    });

    socket.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function getStatus() {
  if (!process.env.NUT_HOST) return null;
  const vars = await queryVars();
  if (!vars['ups.status']) return null;
  return {
    status: vars['ups.status'], // e.g. "OL CHRG" (online, charging), "OB" (on battery), "LB" (low battery)
    batteryChargePercent: Number(vars['battery.charge']) || null,
    batteryRuntimeSeconds: Number(vars['battery.runtime']) || null,
    loadPercent: Number(vars['ups.load']) || null,
    model: vars['ups.model'] || null
  };
}

module.exports = { getStatus };
