// Assumes requireAuth already ran (chain it first on the route) — this only adds
// the isOwner check on top, rather than re-deriving the "not signed in" case.
module.exports = function requireOwner(req, res, next) {
  if (!req.session.user.isOwner) return res.status(403).json({ error: 'Owner only' });
  next();
};
