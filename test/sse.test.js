const test = require('node:test');
const assert = require('node:assert/strict');
const sse = require('../lib/sse');

// A fake res good enough for addClient/broadcast: just needs .write() to not
// throw. Real clients are removed via req.on('close', ...) in the route, not
// exercised here — this only tests the registry's own capacity logic.
function fakeRes() {
  return { write() {} };
}

test('addClient accepts up to the cap, then rejects and stops growing', () => {
  const accepted = [];
  // Drains hasCapacity() to find the current cap without hardcoding lib/sse.js's
  // internal MAX_CLIENTS — adds clients until it reports full.
  while (sse.hasCapacity()) {
    const res = fakeRes();
    sse.addClient(res);
    accepted.push(res);
  }

  assert.equal(sse.hasCapacity(), false);
  const overflow = fakeRes();
  assert.equal(sse.addClient(overflow), false);

  // Freeing one slot makes room for exactly one more.
  sse.removeClient(accepted[0]);
  assert.equal(sse.hasCapacity(), true);
  assert.equal(sse.addClient(overflow), true);
  assert.equal(sse.hasCapacity(), false);

  // Clean up so this doesn't leak into other tests sharing the module.
  sse.removeClient(overflow);
  for (const res of accepted.slice(1)) sse.removeClient(res);
});

test('broadcast writes the same payload to every registered client', () => {
  const a = fakeRes();
  const b = fakeRes();
  let aPayload = null;
  let bPayload = null;
  a.write = (p) => { aPayload = p; };
  b.write = (p) => { bPayload = p; };

  sse.addClient(a);
  sse.addClient(b);
  sse.broadcast('test-event', { hello: 'world' });

  assert.equal(aPayload, bPayload);
  assert.match(aPayload, /^event: test-event\ndata: \{"hello":"world"\}\n\n$/);

  sse.removeClient(a);
  sse.removeClient(b);
});
