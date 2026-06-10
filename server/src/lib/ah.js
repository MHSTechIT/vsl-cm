// Async route wrapper — forwards rejected promises to Express's error handler
// instead of crashing the process on an unhandled rejection.
export const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)
