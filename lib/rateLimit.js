// Small in-memory per-IP rate limiter — no new dependency needed for a handful
// of endpoints. Not distributed/shared across processes, which is fine here
// since this app only ever runs as a single instance.
const buckets = new Map(); // key -> { count, resetAt }

function rateLimit({ windowMs, max, message }) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      return res.status(429).json({ error: message || 'Too many requests — try again shortly.' });
    }
    next();
  };
}

// Periodic cleanup so this doesn't grow unbounded over the app's lifetime.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

module.exports = rateLimit;
