const { createClient } = require("@supabase/supabase-js");
let bound = null;
const db = () => bound;
const setClient = (c) => { bound = c; };
const safeArchiveTimestamp = async (f) => {
  const now = new Date();
  try { const c = await f(); if (c) { const d = new Date(c); if (!isNaN(d.getTime()) && d.getTime() > now.getTime()) return new Date(d.getTime()+1).toISOString(); } } catch {}
  return now.toISOString();
};
module.exports = { db, setClient, createClient: () => bound, safeArchiveTimestamp, requireUserId: async () => "" };