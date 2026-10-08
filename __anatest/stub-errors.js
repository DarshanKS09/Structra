class DataError extends Error { constructor(code, message) { super(message); this.code = code; } }
const toDataError = (e, f) => (e instanceof DataError ? e : new DataError("DATABASE", (e && e.message) || f || "err"));
module.exports = { DataError, toDataError, unwrap: (r) => { if (r.error) throw toDataError(r.error); return r.data; }, validationError: (m) => new DataError("VALIDATION", m) };