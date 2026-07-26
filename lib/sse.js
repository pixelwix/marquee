// Generic SSE client registry, shared by any feature that needs to push events to
// connected dashboards. One EventSource connection per browser tab is reused across
// event types (Now Playing state, media-available toasts, ...) rather than opening
// a separate connection per feature.
const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

module.exports = { addClient, removeClient, broadcast };
