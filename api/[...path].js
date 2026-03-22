import express from "express";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

sqlite3.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_DIR = process.env.PK_DB_DIR || "/tmp";
const DB_PATH = path.join(DB_DIR, "parkkean.db");

fs.mkdirSync(DB_DIR, { recursive: true });
const db = new sqlite3.Database(DB_PATH);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Keep route compatibility across serverless adapters.
  if (!req.url.startsWith("/api/")) {
    req.url = `/api${req.url.startsWith("/") ? req.url : `/${req.url}`}`;
  }
  next();
});
const VALID_STATUSES = new Set(["OPEN", "LIMITED", "FULL"]);
const HISTORY_DAY_MULTIPLIERS = [0.45, 0.85, 0.95, 1, 1, 0.92, 0.5];
const HISTORY_HOUR_MULTIPLIERS = [
  0.18, 0.15, 0.15, 0.18, 0.2, 0.28, 0.4, 0.55, 0.7, 0.82, 0.92, 0.95,
  0.9, 0.88, 0.85, 0.78, 0.7, 0.62, 0.52, 0.45, 0.38, 0.3, 0.25, 0.2,
];
const REPORT_STATUS_TO_PERCENT = new Map([
  ["OPEN", 20],
  ["LIMITED", 65],
  ["FULL", 95],
]);
const REPORT_INFLUENCE_WINDOWS = [
  { maxMinutes: 20, weight: 0.9 },
  { maxMinutes: 45, weight: 0.8 },
  { maxMinutes: 90, weight: 0.65 },
  { maxMinutes: 180, weight: 0.45 },
  { maxMinutes: 360, weight: 0.3 },
];
const REPORT_STATUS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const BOOTSTRAP_VERSION = "20250208";
const FORCE_BOOTSTRAP = String(process.env.PK_FORCE_BOOTSTRAP || "").toLowerCase() === "true";
const ECO_COMMUTE_POINTS = Object.freeze({
  walked: 3,
  biked: 3,
  carpooled: 2,
  drove: 1,
});
const ADMIN_ACCOUNT = Object.freeze({
  username: "Park Admin",
  email: "admin@parkkean.edu",
  password: "parkkean-admin",
});
const GUEST_ACCOUNT = Object.freeze({
  username: "Guest",
  email: "guest@parkkean.local",
  password: "guest-access",
});
const PASSWORD_HASH_CONFIG = Object.freeze({
  iterations: 120000,
  keyLength: 64,
  digest: "sha512",
});
const USER_COLUMN_SELECTION = `
  id,
  username,
  email,
  points,
  reports,
  is_admin,
  last_latitude,
  last_longitude,
  location_accuracy,
  location_updated_at,
  last_eco_log_date
`;
const LOT_COLUMN_SELECTION = `
  id,
  code,
  name,
  capacity,
  occupancy,
  status,
  walk_time,
  full_by,
  last_updated,
  latitude,
  longitude
`;
const EARTH_RADIUS_METERS = 6371000;
const AVERAGE_WALKING_SPEED_MPS = 1.38;
const LOT_COORDINATES = new Map([
  ["VAUGHN_EAMES", { latitude: 40.6812, longitude: -74.2301 }],
  ["LIBERTY_HALL", { latitude: 40.6804, longitude: -74.2345 }],
  ["OVERNIGHT", { latitude: 40.6787, longitude: -74.2289 }],
  ["STEM", { latitude: 40.6798, longitude: -74.231 }],
  ["EAST_CAMPUS", { latitude: 40.6823, longitude: -74.2268 }],
  ["HYNES_HALL", { latitude: 40.6809, longitude: -74.2295 }],
  ["KEAN_HALL", { latitude: 40.6791, longitude: -74.2338 }],
  ["COUGAR_HALL", { latitude: 40.6775, longitude: -74.2322 }],
  ["HARWOOD", { latitude: 40.684, longitude: -74.2277 }],
  ["D_ANGOLA", { latitude: 40.6802, longitude: -74.2282 }],
  ["GLAB", { latitude: 40.6816, longitude: -74.2328 }],
  ["ADMISSIONS", { latitude: 40.6789, longitude: -74.2349 }],
  ["MORRIS_AVE", { latitude: 40.6765, longitude: -74.2361 }],
]);
const LOT_STATUS_SCHEDULE = Object.freeze({
  VAUGHN_EAMES: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "FULL",
    "16_19": "LIMITED",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  LIBERTY_HALL: {
    "7_10": "OPEN",
    "10_13": "LIMITED",
    "13_16": "LIMITED",
    "16_19": "LIMITED",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  OVERNIGHT: {
    "7_10": "OPEN",
    "10_13": "OPEN",
    "13_16": "OPEN",
    "16_19": "OPEN",
    "19_22": "LIMITED",
    "22_7": "LIMITED",
  },
  STEM: {
    "7_10": "LIMITED",
    "10_13": "LIMITED",
    "13_16": "LIMITED",
    "16_19": "OPEN",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  EAST_CAMPUS: {
    "7_10": "OPEN",
    "10_13": "LIMITED",
    "13_16": "LIMITED",
    "16_19": "OPEN",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  HYNES_HALL: {
    "7_10": "OPEN",
    "10_13": "OPEN",
    "13_16": "OPEN",
    "16_19": "OPEN",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  KEAN_HALL: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "FULL",
    "16_19": "LIMITED",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  COUGAR_HALL: {
    "7_10": "LIMITED",
    "10_13": "LIMITED",
    "13_16": "LIMITED",
    "16_19": "LIMITED",
    "19_22": "LIMITED",
    "22_7": "OPEN",
  },
  HARWOOD: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "LIMITED",
    "16_19": "OPEN",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  D_ANGOLA: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "LIMITED",
    "16_19": "OPEN",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  GLAB: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "FULL",
    "16_19": "LIMITED",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  ADMISSIONS: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "FULL",
    "16_19": "LIMITED",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
  MORRIS_AVE: {
    "7_10": "LIMITED",
    "10_13": "FULL",
    "13_16": "LIMITED",
    "16_19": "LIMITED",
    "19_22": "OPEN",
    "22_7": "OPEN",
  },
});
const BUILDING_SEEDS = [
  { code: "HARWOOD_ARENA", name: "Harwood Arena", latitude: 40.68035, longitude: -74.23756 },
  { code: "GLAB", name: "Green Lane Academic Building", latitude: 40.68282, longitude: -74.23619 },
  { code: "LIBERTY_HALL", name: "Liberty Hall", latitude: 40.67968, longitude: -74.22727 },
  { code: "STEM_BUILDING", name: "STEM Building", latitude: 40.67974, longitude: -74.23078 },
  { code: "HYNES_HALL", name: "Hynes Hall", latitude: 40.68282, longitude: -74.23228 },
  { code: "CAS_BUILDING", name: "CAS Building", latitude: 40.67854, longitude: -74.23423 },
  { code: "WILKINS_THEATER", name: "Wilkins Theater", latitude: 40.67853, longitude: -74.23177 },
  { code: "SCIENCE_BUILDING", name: "Science Building", latitude: 40.68034, longitude: -74.23489 },
  { code: "NAAB", name: "North Avenue Academic Building", latitude: 40.67636, longitude: -74.22847 },
  { code: "EAST_CAMPUS_HALL", name: "East Campus Hall", latitude: 40.67978, longitude: -74.22395 },
];
const BUILDING_WALK_MINUTES = {
  HARWOOD_ARENA: {
    VAUGHN_EAMES: 11,
    LIBERTY_HALL: 17,
    OVERNIGHT: 13,
    STEM: 13,
    EAST_CAMPUS: 22,
    HYNES_HALL: 10,
    KEAN_HALL: 4,
    COUGAR_HALL: 3,
    HARWOOD: 1,
    D_ANGOLA: 1,
    GLAB: 4,
    ADMISSIONS: 4,
    MORRIS_AVE: 6,
  },
  GLAB: {
    VAUGHN_EAMES: 15,
    LIBERTY_HALL: 17,
    OVERNIGHT: 17,
    STEM: 14,
    EAST_CAMPUS: 21,
    HYNES_HALL: 9,
    KEAN_HALL: 3,
    COUGAR_HALL: 8,
    HARWOOD: 4,
    D_ANGOLA: 5,
    GLAB: 1,
    ADMISSIONS: 5,
    MORRIS_AVE: 7,
  },
  LIBERTY_HALL: {
    VAUGHN_EAMES: 8,
    LIBERTY_HALL: 1,
    OVERNIGHT: 10,
    STEM: 4,
    EAST_CAMPUS: 6,
    HYNES_HALL: 11,
    KEAN_HALL: 14,
    COUGAR_HALL: 20,
    HARWOOD: 18,
    D_ANGOLA: 19,
    GLAB: 19,
    ADMISSIONS: 12,
    MORRIS_AVE: 12,
  },
  STEM_BUILDING: {
    VAUGHN_EAMES: 8,
    LIBERTY_HALL: 4,
    OVERNIGHT: 11,
    STEM: 2,
    EAST_CAMPUS: 8,
    HYNES_HALL: 9,
    KEAN_HALL: 12,
    COUGAR_HALL: 18,
    HARWOOD: 16,
    D_ANGOLA: 17,
    GLAB: 15,
    ADMISSIONS: 10,
    MORRIS_AVE: 9,
  },
  HYNES_HALL: {
    VAUGHN_EAMES: 15,
    LIBERTY_HALL: 11,
    OVERNIGHT: 17,
    STEM: 9,
    EAST_CAMPUS: 15,
    HYNES_HALL: 1,
    KEAN_HALL: 7,
    COUGAR_HALL: 14,
    HARWOOD: 13,
    D_ANGOLA: 14,
    GLAB: 10,
    ADMISSIONS: 11,
    MORRIS_AVE: 9,
  },
  CAS_BUILDING: {
    VAUGHN_EAMES: 5,
    LIBERTY_HALL: 12,
    OVERNIGHT: 7,
    STEM: 10,
    EAST_CAMPUS: 15,
    HYNES_HALL: 14,
    KEAN_HALL: 8,
    COUGAR_HALL: 7,
    HARWOOD: 6,
    D_ANGOLA: 7,
    GLAB: 11,
    ADMISSIONS: 7,
    MORRIS_AVE: 4,
  },
  WILKINS_THEATER: {
    VAUGHN_EAMES: 3,
    LIBERTY_HALL: 8,
    OVERNIGHT: 5,
    STEM: 7,
    EAST_CAMPUS: 13,
    HYNES_HALL: 14,
    KEAN_HALL: 10,
    COUGAR_HALL: 10,
    HARWOOD: 10,
    D_ANGOLA: 11,
    GLAB: 12,
    ADMISSIONS: 10,
    MORRIS_AVE: 3,
  },
  SCIENCE_BUILDING: {
    VAUGHN_EAMES: 9,
    LIBERTY_HALL: 12,
    OVERNIGHT: 11,
    STEM: 10,
    EAST_CAMPUS: 16,
    HYNES_HALL: 11,
    KEAN_HALL: 4,
    COUGAR_HALL: 7,
    HARWOOD: 6,
    D_ANGOLA: 7,
    GLAB: 7,
    ADMISSIONS: 1,
    MORRIS_AVE: 3,
  },
  NAAB: {
    VAUGHN_EAMES: 3,
    LIBERTY_HALL: 8,
    OVERNIGHT: 1,
    STEM: 7,
    EAST_CAMPUS: 13,
    HYNES_HALL: 18,
    KEAN_HALL: 14,
    COUGAR_HALL: 12,
    HARWOOD: 15,
    D_ANGOLA: 16,
    GLAB: 17,
    ADMISSIONS: 10,
    MORRIS_AVE: 8,
  },
  EAST_CAMPUS_HALL: {
    VAUGHN_EAMES: 16,
    LIBERTY_HALL: 6,
    OVERNIGHT: 15,
    STEM: 8,
    EAST_CAMPUS: 1,
    HYNES_HALL: 15,
    KEAN_HALL: 19,
    COUGAR_HALL: 25,
    HARWOOD: 23,
    D_ANGOLA: 24,
    GLAB: 21,
    ADMISSIONS: 17,
    MORRIS_AVE: 15,
  },
};

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

function normalizeNumber(value) {
  if (value === null || typeof value === "undefined") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    is_admin: Boolean(row.is_admin),
    points: Number(row.points) || 0,
    reports: Number(row.reports) || 0,
    last_latitude: normalizeNumber(row.last_latitude),
    last_longitude: normalizeNumber(row.last_longitude),
    location_accuracy: normalizeNumber(row.location_accuracy),
    location_updated_at: normalizeNumber(row.location_updated_at),
    last_eco_log_date: row.last_eco_log_date || null,
  };
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : "";
}

async function ensureGuestAccount() {
  const guestEmail = normalizeEmail(GUEST_ACCOUNT.email);
  let existing = await get(`SELECT id FROM users WHERE email_lower = ?`, [guestEmail]);
  if (!existing) {
    existing = await get(`SELECT id FROM users WHERE lower(username) = ?`, [
      GUEST_ACCOUNT.username.toLowerCase(),
    ]);
  }
  if (!existing) {
    const credentials = hashPassword(GUEST_ACCOUNT.password);
    await run(
      `INSERT INTO users (username, email, email_lower, password_hash, password_salt, points, reports, created_at, is_admin)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0)`,
      [
        GUEST_ACCOUNT.username,
        GUEST_ACCOUNT.email,
        guestEmail,
        credentials.hash,
        credentials.salt,
        Date.now(),
      ]
    );
    return;
  }
  await run(
    `UPDATE users
       SET username = ?,
           email = ?,
           email_lower = ?,
           is_admin = 0
     WHERE id = ?`,
    [GUEST_ACCOUNT.username, GUEST_ACCOUNT.email, guestEmail, existing.id]
  );
}

async function getGuestUser() {
  await ensureGuestAccount();
  return get(`SELECT ${USER_COLUMN_SELECTION} FROM users WHERE lower(username) = ?`, [
    GUEST_ACCOUNT.username.toLowerCase(),
  ]);
}

function isValidEmail(value) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .pbkdf2Sync(
      String(password),
      salt,
      PASSWORD_HASH_CONFIG.iterations,
      PASSWORD_HASH_CONFIG.keyLength,
      PASSWORD_HASH_CONFIG.digest
    )
    .toString("hex");
  return { hash: derived, salt };
}

function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt) return false;
  const derived = crypto
    .pbkdf2Sync(
      String(password),
      salt,
      PASSWORD_HASH_CONFIG.iterations,
      PASSWORD_HASH_CONFIG.keyLength,
      PASSWORD_HASH_CONFIG.digest
    )
    .toString("hex");
  const derivedBuffer = Buffer.from(derived, "hex");
  const hashBuffer = Buffer.from(String(hash), "hex");
  if (derivedBuffer.length !== hashBuffer.length) return false;
  return crypto.timingSafeEqual(derivedBuffer, hashBuffer);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(value))) return null;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function minutesFromMeters(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  return Math.max(1, Math.round(distanceMeters / (AVERAGE_WALKING_SPEED_MPS * 60)));
}

function deterministicNoise(seed) {
  const value = Math.sin(seed) * 10000;
  return (value - Math.floor(value)) * 0.1 - 0.05;
}

function statusToPercent(status) {
  if (!status) return null;
  const normalized = String(status).trim().toUpperCase();
  if (!REPORT_STATUS_TO_PERCENT.has(normalized)) return null;
  return REPORT_STATUS_TO_PERCENT.get(normalized);
}

function statusFromPercent(percent) {
  if (!Number.isFinite(percent)) return "OPEN";
  if (percent >= 90) return "FULL";
  if (percent >= 45) return "LIMITED";
  return "OPEN";
}

function getScheduleBlock(timestamp = Date.now()) {
  const date = new Date(Number(timestamp) || Date.now());
  const hour = date.getHours();
  if (hour >= 7 && hour < 10) return "7_10";
  if (hour >= 10 && hour < 13) return "10_13";
  if (hour >= 13 && hour < 16) return "13_16";
  if (hour >= 16 && hour < 19) return "16_19";
  if (hour >= 19 && hour < 22) return "19_22";
  return "22_7";
}

function getScheduledStatusForLot(lotCode, timestamp = Date.now()) {
  if (!lotCode) return null;
  const schedule = LOT_STATUS_SCHEDULE[lotCode];
  if (!schedule) return null;
  const block = getScheduleBlock(timestamp);
  const status = schedule[block];
  if (!status) return null;
  const normalized = status.toString().trim().toUpperCase();
  return VALID_STATUSES.has(normalized) ? normalized : null;
}

function reportInfluenceWeight(createdAt, now) {
  const timestamp = Number(createdAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageMs = now - timestamp;
  if (ageMs <= 0) return REPORT_INFLUENCE_WINDOWS[0].weight;
  const ageMinutes = ageMs / 60000;
  for (const window of REPORT_INFLUENCE_WINDOWS) {
    if (ageMinutes <= window.maxMinutes) {
      return window.weight;
    }
  }
  return 0;
}

async function ensureHistoricalPatterns() {
  await run(
    `CREATE TABLE IF NOT EXISTS lot_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL,
      hour_block INTEGER NOT NULL,
      avg_occupancy_pct INTEGER NOT NULL,
      UNIQUE(lot_id, day_of_week, hour_block)
    )`
  );

  const lots = await all("SELECT id, capacity, occupancy FROM lots");
  for (const lot of lots) {
    const row = await get("SELECT COUNT(*) AS count FROM lot_history WHERE lot_id = ?", [lot.id]);
    if (row?.count >= 168) continue;
    await run("DELETE FROM lot_history WHERE lot_id = ?", [lot.id]);
    const entries = generateHistoricalEntries(lot);
    for (const entry of entries) {
      await run(
        `INSERT INTO lot_history (lot_id, day_of_week, hour_block, avg_occupancy_pct)
         VALUES (?, ?, ?, ?)`,
        [lot.id, entry.day, entry.hour, entry.percent]
      );
    }
  }
}

async function getUserLocationCoordinates(username) {
  if (!username) return null;
  const record = await get(
    `SELECT last_latitude, last_longitude FROM users WHERE lower(username) = ?`,
    [username.toLowerCase()]
  );
  if (!record) return null;
  const latitude = normalizeNumber(record.last_latitude);
  const longitude = normalizeNumber(record.last_longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function generateHistoricalEntries(lot) {
  const capacity = Number(lot.capacity) || 0;
  const occupancy = Number(lot.occupancy) || 0;
  const baselineRatio =
    capacity > 0 ? clamp(occupancy / capacity, 0.2, 0.95) : clamp(occupancy / 150, 0.2, 0.95);
  const entries = [];
  for (let day = 0; day < 7; day++) {
    const dayMultiplier = HISTORY_DAY_MULTIPLIERS[day] ?? 0.7;
    for (let hour = 0; hour < 24; hour++) {
      const hourMultiplier = HISTORY_HOUR_MULTIPLIERS[hour] ?? 0.5;
      const seed = lot.id * 1000 + day * 24 + hour;
      const noise = deterministicNoise(seed);
      const ratio =
        baselineRatio * 0.45 + dayMultiplier * 0.2 + hourMultiplier * 0.3 + 0.05 + noise;
      const percent = Math.round(clamp(ratio, 0.05, 0.99) * 100);
      entries.push({ day, hour, percent });
    }
  }
  return entries;
}

async function ensureUserLocationColumns() {
  const columns = await all("PRAGMA table_info(users)");
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    { name: "last_latitude", type: "REAL" },
    { name: "last_longitude", type: "REAL" },
    { name: "location_accuracy", type: "REAL" },
    { name: "location_updated_at", type: "INTEGER" },
  ];

  for (const column of additions) {
    if (existing.has(column.name)) continue;
    await run(`ALTER TABLE users ADD COLUMN ${column.name} ${column.type}`);
  }
}

async function ensureUserRoleColumn() {
  const columns = await all("PRAGMA table_info(users)");
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has("is_admin")) {
    await run(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  }
}

async function ensureUserCredentialColumns() {
  const columns = await all("PRAGMA table_info(users)");
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    { name: "email", type: "TEXT" },
    { name: "email_lower", type: "TEXT" },
    { name: "password_hash", type: "TEXT" },
    { name: "password_salt", type: "TEXT" },
  ];
  for (const column of additions) {
    if (!existing.has(column.name)) {
      await run(`ALTER TABLE users ADD COLUMN ${column.name} ${column.type}`);
    }
  }
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower)`);

  const rows = await all(
    `SELECT id, username, email, email_lower, password_hash, password_salt
     FROM users`
  );
  for (const row of rows) {
    const updates = [];
    const params = [];
    let resolvedEmail = row.email;
    if (!resolvedEmail) {
      resolvedEmail = `${row.username || "user"}+${row.id}@parkkean.local`;
      updates.push("email = ?");
      params.push(resolvedEmail);
    }
    const normalized = normalizeEmail(resolvedEmail);
    if (row.email_lower !== normalized) {
      updates.push("email_lower = ?");
      params.push(normalized);
    }
    if (!row.password_hash || !row.password_salt) {
      const { hash, salt } = hashPassword(crypto.randomBytes(12).toString("hex"));
      updates.push("password_hash = ?", "password_salt = ?");
      params.push(hash, salt);
    }
    if (updates.length > 0) {
      await run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, row.id]);
    }
  }
}

async function ensureUserEcoColumns() {
  const columns = await all("PRAGMA table_info(users)");
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has("last_eco_log_date")) {
    await run(`ALTER TABLE users ADD COLUMN last_eco_log_date TEXT`);
  }
}

async function ensureLotCoordinateColumns() {
  const columns = await all("PRAGMA table_info(lots)");
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    { name: "latitude", type: "REAL" },
    { name: "longitude", type: "REAL" },
  ];
  for (const column of additions) {
    if (existing.has(column.name)) continue;
    await run(`ALTER TABLE lots ADD COLUMN ${column.name} ${column.type}`);
  }
}

async function backfillLotCoordinates() {
  for (const [code, coords] of LOT_COORDINATES.entries()) {
    await run(
      `UPDATE lots
         SET latitude = COALESCE(latitude, ?),
             longitude = COALESCE(longitude, ?)
       WHERE code = ?
         AND (latitude IS NULL OR longitude IS NULL)`,
      [coords.latitude, coords.longitude, code]
    );
  }
}

async function ensureBuildings() {
  await run(
    `CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    )`
  );

  const existing = await all("SELECT code FROM buildings");
  const existingCodes = new Set(existing.map((row) => row.code));
  for (const building of BUILDING_SEEDS) {
    if (existingCodes.has(building.code)) {
      await run(
        `UPDATE buildings SET name = ?, latitude = ?, longitude = ? WHERE code = ?`,
        [building.name, building.latitude, building.longitude, building.code]
      );
    } else {
      await run(
        `INSERT INTO buildings (code, name, latitude, longitude) VALUES (?, ?, ?, ?)`,
        [building.code, building.name, building.latitude, building.longitude]
      );
    }
  }
}

async function ensureBuildingLotWalks() {
  await run(
    `CREATE TABLE IF NOT EXISTS building_lot_walks (
      building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
      minutes INTEGER NOT NULL,
      PRIMARY KEY (building_id, lot_id)
    )`
  );

  const buildings = await all("SELECT id, code FROM buildings");
  const lots = await all("SELECT id, code FROM lots");

  for (const building of buildings) {
    await run("DELETE FROM building_lot_walks WHERE building_id = ?", [building.id]);
    const minutesMap = BUILDING_WALK_MINUTES[building.code] || {};
    for (const lot of lots) {
      const minutes = minutesMap[lot.code] ?? minutesMap[lot.code?.toUpperCase()] ?? null;
      if (!Number.isFinite(minutes)) continue;
      await run(
        `INSERT INTO building_lot_walks (building_id, lot_id, minutes) VALUES (?, ?, ?)`,
        [building.id, lot.id, Math.max(1, Math.round(minutes))]
      );
    }
  }
}

async function ensureAdminAccount() {
  const adminEmail = normalizeEmail(ADMIN_ACCOUNT.email);
  let existing = await get(`SELECT id FROM users WHERE email_lower = ?`, [adminEmail]);
  if (!existing) {
    existing = await get(`SELECT id FROM users WHERE lower(username) = ?`, [
      ADMIN_ACCOUNT.username.toLowerCase(),
    ]);
  }
  const credentials = hashPassword(ADMIN_ACCOUNT.password);
  let adminId = existing?.id ?? null;
  if (!existing) {
    const result = await run(
      `INSERT INTO users (username, email, email_lower, password_hash, password_salt, points, reports, created_at, is_admin)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 1)`,
      [
        ADMIN_ACCOUNT.username,
        ADMIN_ACCOUNT.email,
        adminEmail,
        credentials.hash,
        credentials.salt,
        Date.now(),
      ]
    );
    adminId = result.id;
  } else {
    await run(
      `UPDATE users
         SET username = ?,
             email = ?,
             email_lower = ?,
             password_hash = ?,
             password_salt = ?
       WHERE id = ?`,
      [
        ADMIN_ACCOUNT.username,
        ADMIN_ACCOUNT.email,
        adminEmail,
        credentials.hash,
        credentials.salt,
        adminId,
      ]
    );
  }
  if (adminId) {
    await run(`UPDATE users SET is_admin = CASE WHEN id = ? THEN 1 ELSE 0 END`, [adminId]);
  }
}

async function ensureSystemMetaTable() {
  await run(
    `CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  );
}

async function getSystemMeta(key) {
  if (!key) return null;
  const row = await get(`SELECT value FROM system_meta WHERE key = ?`, [key]);
  return row?.value ?? null;
}

async function setSystemMeta(key, value) {
  if (!key) return;
  await run(
    `INSERT INTO system_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value ?? "")]
  );
}

async function ensureNotificationsTable() {
  await run(
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lot_id INTEGER NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    )`
  );
  await run(
    `CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
       ON notifications(recipient_id, created_at DESC)`
  );
}

async function createNotificationsForLotUpdate({ lotId, reporterId, status, note, createdAt }) {
  if (!lotId || !reporterId || !status) return;
  const recipients = await all(`SELECT id FROM users WHERE id != ?`, [reporterId]);
  if (!recipients.length) return;
  const trimmedNote = note?.trim() || "";
  for (const recipient of recipients) {
    await run(
      `INSERT INTO notifications (recipient_id, lot_id, reporter_id, status, note, created_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [recipient.id, lotId, reporterId, status, trimmedNote, createdAt]
    );
  }
}

async function listNotificationsForUser(recipientId, limit = 25) {
  if (!recipientId) return [];
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
  return all(
    `SELECT
        n.id,
        n.lot_id,
        n.status,
        n.note,
        n.created_at,
        n.is_read,
        lots.name AS lot_name,
        lots.code AS lot_code,
        reporter.username AS reporter_username
     FROM notifications n
     JOIN lots ON lots.id = n.lot_id
     JOIN users reporter ON reporter.id = n.reporter_id
     WHERE n.recipient_id = ?
     ORDER BY n.created_at DESC
     LIMIT ?`,
    [recipientId, normalizedLimit]
  );
}

async function listAdminNotificationsForLot(lotId, limit = 5) {
  if (!lotId) return [];
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 25));
  const rows = await all(
    `SELECT
        n.id,
        n.status,
        n.note,
        n.created_at,
        reporter.username AS reporter_username
     FROM notifications n
     JOIN users reporter ON reporter.id = n.reporter_id
     WHERE n.lot_id = ?
       AND reporter.is_admin = 1
     ORDER BY n.created_at DESC
     LIMIT ?`,
    [lotId, normalizedLimit]
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    note: row.note,
    created_at: Number(row.created_at),
    reporter: row.reporter_username,
  }));
}

async function getUserByUsername(username) {
  if (!username) return null;
  return get(
    `SELECT ${USER_COLUMN_SELECTION} FROM users WHERE lower(username) = ?`,
    [username.toLowerCase()]
  );
}

async function getAdminUser(username) {
  const user = await getUserByUsername(username);
  if (!user || !user.is_admin) return null;
  return user;
}

async function getNearestBuilding(coords) {
  if (!coords) return null;
  const buildings = await all("SELECT id, code, name, latitude, longitude FROM buildings");
  let best = null;
  let bestDistance = Infinity;
  buildings.forEach((building) => {
    if (
      !Number.isFinite(building.latitude) ||
      !Number.isFinite(building.longitude) ||
      !Number.isFinite(coords.latitude) ||
      !Number.isFinite(coords.longitude)
    ) {
      return;
    }
    const distance = haversineDistanceMeters(
      coords.latitude,
      coords.longitude,
      building.latitude,
      building.longitude
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { ...building, distance_meters: distance };
    }
  });
  return best;
}

async function getBuildingWalkMap(buildingId) {
  if (!buildingId) return null;
  const rows = await all(
    "SELECT lot_id, minutes FROM building_lot_walks WHERE building_id = ?",
    [buildingId]
  );
  if (!rows.length) return null;
  const map = new Map();
  rows.forEach((row) => {
    map.set(Number(row.lot_id), Number(row.minutes));
  });
  return map;
}

async function getHistoricalSnapshot(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const day = date.getDay();
  const hour = date.getHours();
  const rows = await all(
    `SELECT lot_id, avg_occupancy_pct
     FROM lot_history
     WHERE day_of_week = ? AND hour_block = ?`,
    [day, hour]
  );

  const historyMap = new Map();
  rows.forEach((row) => {
    historyMap.set(row.lot_id, Number(row.avg_occupancy_pct) || null);
  });
  return { historyMap, context: { day_of_week: day, hour_block: hour } };
}

function applyEstimateToLot(lot, historyMap, now, walkOptions = {}) {
  const capacity = Number(lot.capacity) || 0;
  const fallbackPercent =
    capacity > 0 ? clamp((Number(lot.occupancy) / capacity) * 100, 0, 100) : 0;
  const historicalPercent = historyMap.get(lot.id) ?? fallbackPercent ?? 0;
  const lastReport = lot.lastReport;
  let blendedPercent = historicalPercent;
  let reportPercent = null;
  let reportWeight = 0;
  let distanceFromUser = null;
  let walkMinutesFromUser = null;
  let walkSource = null;
  const userLocation = walkOptions?.userLocation ?? null;
  const buildingContext = walkOptions?.buildingContext ?? null;
  const walkMinutesMap = walkOptions?.walkMinutesMap ?? null;

  if (lastReport) {
    reportPercent = statusToPercent(lastReport.reported_status);
    reportWeight = reportInfluenceWeight(lastReport.created_at, now);
    if (reportPercent !== null && reportWeight > 0) {
      blendedPercent = Math.round(
        historicalPercent * (1 - reportWeight) + reportPercent * reportWeight
      );
    }
  }

  const buildingMinutes =
    walkMinutesMap && walkMinutesMap.has(lot.id) ? walkMinutesMap.get(lot.id) : null;
  if (Number.isFinite(buildingMinutes)) {
    walkMinutesFromUser = buildingMinutes;
    walkSource = buildingContext
      ? { type: "building", id: buildingContext.id, name: buildingContext.name, code: buildingContext.code }
      : { type: "building" };
    if (
      buildingContext &&
      Number.isFinite(buildingContext.latitude) &&
      Number.isFinite(buildingContext.longitude) &&
      Number.isFinite(lot.latitude) &&
      Number.isFinite(lot.longitude)
    ) {
      distanceFromUser = haversineDistanceMeters(
        buildingContext.latitude,
        buildingContext.longitude,
        Number(lot.latitude),
        Number(lot.longitude)
      );
    }
  } else if (
    userLocation &&
    Number.isFinite(userLocation.latitude) &&
    Number.isFinite(userLocation.longitude) &&
    Number.isFinite(lot.latitude) &&
    Number.isFinite(lot.longitude)
  ) {
    distanceFromUser = haversineDistanceMeters(
      userLocation.latitude,
      userLocation.longitude,
      Number(lot.latitude),
      Number(lot.longitude)
    );
    walkMinutesFromUser = minutesFromMeters(distanceFromUser);
    walkSource = { type: "user_location" };
  }

  const occupancyCount = capacity > 0 ? Math.round((capacity * blendedPercent) / 100) : 0;
  const recentReportAge = lastReport ? now - Number(lastReport.created_at) : null;
  const shouldUseReportStatus =
    lastReport && Number.isFinite(recentReportAge) && recentReportAge <= REPORT_STATUS_MAX_AGE_MS;
  const status = shouldUseReportStatus
    ? lastReport.reported_status
    : statusFromPercent(blendedPercent);
  const lastUpdated = shouldUseReportStatus && Number(lastReport.created_at)
    ? Number(lastReport.created_at)
    : now;

  return {
    ...lot,
    occupancy: occupancyCount,
    status,
    last_updated: lastUpdated,
    walk_distance_meters: distanceFromUser,
    walk_minutes_from_user: walkMinutesFromUser,
    walk_source: walkSource,
    estimate: {
      blended_percent: blendedPercent,
      historical_percent: historicalPercent,
      report_percent: reportPercent,
      report_weight: reportWeight,
      generated_at: now,
      walk_minutes: walkMinutesFromUser,
      distance_meters: distanceFromUser,
    },
  };
}

async function generateEstimatedLots(lots, options = {}) {
  const now = Number(options?.timestamp) || Date.now();
  const { historyMap, context } = await getHistoricalSnapshot(now);
  const userLocation = options?.userLocation ?? null;
  const buildingContext = options?.buildingContext ?? null;
  const walkMinutesMap = options?.walkMinutesMap ?? null;
  let reportAdjustedLots = 0;
  let scheduleAdjustedLots = 0;
  const estimatedLots = lots.map((lot) => {
    const estimate = applyEstimateToLot(lot, historyMap, now, {
      userLocation,
      buildingContext,
      walkMinutesMap,
    });
    if ((estimate.estimate?.report_weight ?? 0) > 0) {
      reportAdjustedLots += 1;
    }
    const scheduledStatus = getScheduledStatusForLot(lot.code, now);
    if (!scheduledStatus) return estimate;
    const capacity = Number(estimate.capacity) || 0;
    const scheduledPercent = statusToPercent(scheduledStatus);
    const occupancy =
      scheduledPercent !== null && capacity > 0
        ? Math.round((capacity * scheduledPercent) / 100)
        : estimate.occupancy;
    scheduleAdjustedLots += 1;
    return {
      ...estimate,
      status: scheduledStatus,
      occupancy,
      last_updated: now,
      estimate: {
        ...estimate.estimate,
        scheduled_status: scheduledStatus,
        scheduled_percent: scheduledPercent,
      },
    };
  });

  const source = {
    mode: "ESTIMATED",
    generated_at: now,
    components: {
      historical: context,
      reports: reportAdjustedLots ? { lots_adjusted: reportAdjustedLots } : { lots_adjusted: 0 },
    },
  };
  if (scheduleAdjustedLots) {
    source.components.schedule = {
      block: getScheduleBlock(now),
      lots_adjusted: scheduleAdjustedLots,
    };
  }

  if (buildingContext) {
    source.components.walking = {
      type: "building",
      code: buildingContext.code,
      name: buildingContext.name,
    };
  } else if (userLocation) {
    source.components.walking = { type: "user_location" };
  }

  return { lots: estimatedLots, source };
}

async function initDatabase() {
  await run(
    `CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      occupancy INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN',
      walk_time INTEGER DEFAULT 0,
      full_by TEXT,
      last_updated INTEGER DEFAULT 0,
      latitude REAL,
      longitude REAL
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      email_lower TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      reports INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      is_admin INTEGER NOT NULL DEFAULT 0,
      last_eco_log_date TEXT
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL REFERENCES lots(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      reported_status TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    )`
  );

  const lotCount = await get("SELECT COUNT(*) AS count FROM lots");
  if (!lotCount?.count) {
    await seedLots();
  }

  const userCount = await get("SELECT COUNT(*) AS count FROM users");
  if (!userCount?.count) {
    await seedUsers();
  }

  await ensureSystemMetaTable();
  await ensureUserLocationColumns();
  await ensureUserRoleColumn();
  await ensureUserCredentialColumns();
  await ensureUserEcoColumns();
  const recordedBootstrap = await getSystemMeta("bootstrap_version");
  const shouldRunBootstrap = FORCE_BOOTSTRAP || recordedBootstrap !== BOOTSTRAP_VERSION;
  if (shouldRunBootstrap) {
    const bootstrapStart = Date.now();
    await ensureHistoricalPatterns();
    await ensureLotCoordinateColumns();
    await backfillLotCoordinates();
    await ensureBuildings();
    await ensureBuildingLotWalks();
    await setSystemMeta("bootstrap_version", BOOTSTRAP_VERSION);
    console.log(
      `[bootstrap] Completed heavy setup (version ${BOOTSTRAP_VERSION}) in ${Date.now() - bootstrapStart}ms`
    );
  } else {
    console.log("[bootstrap] Skipping heavy setup — already up to date");
  }
  await ensureNotificationsTable();
  await ensureAdminAccount();
  await ensureGuestAccount();
  // Always refresh building-lot walk times to reflect latest matrix
  await ensureBuildings();
  await ensureBuildingLotWalks();
}

async function seedLots() {
  const now = Date.now();
  const hours = (n) => n * 60 * 60 * 1000;
  const mins = (n) => n * 60 * 1000;
  const seedLots = [
    {
      code: "VAUGHN_EAMES",
      name: "Vaughn-Eames Lot",
      capacity: 140,
      occupancy: 110,
      walk_time: 4,
      full_by: "08:30",
      status: "LIMITED",
      last_updated: now - hours(2) - mins(15),
      latitude: 40.6812,
      longitude: -74.2301,
    },
    {
      code: "LIBERTY_HALL",
      name: "Liberty Hall Academic Building Lot",
      capacity: 180,
      occupancy: 95,
      walk_time: 6,
      full_by: "09:45",
      status: "OPEN",
      last_updated: now - hours(3),
      latitude: 40.6804,
      longitude: -74.2345,
    },
    {
      code: "OVERNIGHT",
      name: "Overnight Lot",
      capacity: 220,
      occupancy: 210,
      walk_time: 10,
      full_by: "07:15",
      status: "FULL",
      last_updated: now - hours(1) - mins(40),
      latitude: 40.6787,
      longitude: -74.2289,
    },
    {
      code: "STEM",
      name: "STEM Lot",
      capacity: 160,
      occupancy: 120,
      walk_time: 5,
      full_by: "09:30",
      status: "LIMITED",
      last_updated: now - hours(2),
      latitude: 40.6798,
      longitude: -74.231,
    },
    {
      code: "EAST_CAMPUS",
      name: "East Campus Lot",
      capacity: 200,
      occupancy: 80,
      walk_time: 8,
      full_by: "11:00",
      status: "OPEN",
      last_updated: now - hours(3) - mins(30),
      latitude: 40.6823,
      longitude: -74.2268,
    },
    {
      code: "HYNES_HALL",
      name: "Hynes Hall Lot",
      capacity: 90,
      occupancy: 75,
      walk_time: 3,
      full_by: "08:15",
      status: "LIMITED",
      last_updated: now - hours(2) - mins(45),
      latitude: 40.6809,
      longitude: -74.2295,
    },
    {
      code: "KEAN_HALL",
      name: "Kean Hall Lot",
      capacity: 125,
      occupancy: 60,
      walk_time: 4,
      full_by: "12:00",
      status: "OPEN",
      last_updated: now - hours(4),
      latitude: 40.6791,
      longitude: -74.2338,
    },
    {
      code: "COUGAR_HALL",
      name: "Cougar Hall Lot",
      capacity: 150,
      occupancy: 130,
      walk_time: 7,
      full_by: "08:50",
      status: "LIMITED",
      last_updated: now - hours(1) - mins(20),
      latitude: 40.6775,
      longitude: -74.2322,
    },
    {
      code: "HARWOOD",
      name: "Harwood Lot",
      capacity: 110,
      occupancy: 45,
      walk_time: 9,
      full_by: "13:00",
      status: "OPEN",
      last_updated: now - hours(5),
      latitude: 40.684,
      longitude: -74.2277,
    },
    {
      code: "D_ANGOLA",
      name: "D'Angola Lot",
      capacity: 95,
      occupancy: 92,
      walk_time: 6,
      full_by: "07:55",
      status: "FULL",
      last_updated: now - hours(2) - mins(5),
      latitude: 40.6802,
      longitude: -74.2282,
    },
    {
      code: "GLAB",
      name: "GLAB Lot",
      capacity: 130,
      occupancy: 70,
      walk_time: 4,
      full_by: "10:30",
      status: "OPEN",
      last_updated: now - hours(3) - mins(50),
      latitude: 40.6816,
      longitude: -74.2328,
    },
    {
      code: "ADMISSIONS",
      name: "Admissions Lot",
      capacity: 85,
      occupancy: 65,
      walk_time: 5,
      full_by: "09:10",
      status: "LIMITED",
      last_updated: now - hours(1) - mins(55),
      latitude: 40.6789,
      longitude: -74.2349,
    },
    {
      code: "MORRIS_AVE",
      name: "Morris Ave Lot",
      capacity: 210,
      occupancy: 150,
      walk_time: 12,
      full_by: "10:45",
      status: "OPEN",
      last_updated: now - hours(4) - mins(10),
      latitude: 40.6765,
      longitude: -74.2361,
    },
  ];

  for (const lot of seedLots) {
    await run(
      `INSERT INTO lots (code, name, capacity, occupancy, status, walk_time, full_by, last_updated, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lot.code,
        lot.name,
        lot.capacity,
        lot.occupancy,
        lot.status,
        lot.walk_time,
        lot.full_by,
        lot.last_updated,
        lot.latitude,
        lot.longitude,
      ]
    );
  }
}

async function seedUsers() {
  const seedUsers = [
    {
      username: "michael",
      email: "michael@students.kean.edu",
      password: "cougar-mike",
      points: 45,
      reports: 9,
      is_admin: 0,
    },
    {
      username: "ava",
      email: "ava@students.kean.edu",
      password: "ava-parking",
      points: 30,
      reports: 6,
      is_admin: 0,
    },
    {
      username: "jayden",
      email: "jayden@students.kean.edu",
      password: "jayden-spot",
      points: 25,
      reports: 5,
      is_admin: 0,
    },
  ];

  for (const user of seedUsers) {
    const normalizedEmail = normalizeEmail(user.email);
    const credentials = hashPassword(user.password);
    await run(
      `INSERT INTO users (username, email, email_lower, password_hash, password_salt, points, reports, created_at, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.username,
        user.email,
        normalizedEmail,
        credentials.hash,
        credentials.salt,
        user.points,
        user.reports,
        Date.now() - Math.floor(Math.random() * 86400000),
        user.is_admin ? 1 : 0,
      ]
    );
  }

  const lot = await get("SELECT id FROM lots WHERE code = ?", ["OVERNIGHT"]);
  const user = await get("SELECT id FROM users WHERE username = ?", ["michael"]);
  if (lot && user) {
    await run(
      `INSERT INTO reports (lot_id, user_id, reported_status, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [lot.id, user.id, "FULL", "Upper deck closed for event prep.", Date.now() - 3600000]
    );
  }
}

async function getLotsWithReports(targetId = null) {
  const lots = await all(
    `SELECT ${LOT_COLUMN_SELECTION}
     FROM lots
     ORDER BY name ASC`
  );

  if (!lots.length) return targetId ? null : [];

  const lotIds = targetId ? [targetId] : lots.map((lot) => lot.id);
  const placeholders = lotIds.map(() => "?").join(",");
  const reports = await all(
    `SELECT r.id, r.lot_id, r.reported_status, r.note, r.created_at, u.username AS user, u.is_admin AS is_admin
     FROM reports r
     JOIN users u ON u.id = r.user_id
     WHERE r.lot_id IN (${placeholders})
     ORDER BY r.created_at DESC`,
    lotIds
  );

  const grouped = new Map();
  reports.forEach((report) => {
    if (!grouped.has(report.lot_id)) grouped.set(report.lot_id, []);
    grouped.get(report.lot_id).push({
      id: report.id,
      lot_id: report.lot_id,
      reported_status: report.reported_status,
      note: report.note,
      created_at: Number(report.created_at),
      user: report.user,
      is_admin: Boolean(report.is_admin),
    });
  });

  const normalizeLot = (lot) => ({
    id: lot.id,
    code: lot.code,
    name: lot.name,
    capacity: Number(lot.capacity),
    occupancy: Number(lot.occupancy),
    status: lot.status,
    walk_time: Number(lot.walk_time),
    full_by: lot.full_by,
    last_updated: Number(lot.last_updated),
    latitude: normalizeNumber(lot.latitude),
    longitude: normalizeNumber(lot.longitude),
    lastReport: grouped.get(lot.id)?.[0] ?? null,
  });

  if (targetId) {
    const lot = lots.find((item) => item.id === Number(targetId));
    return lot ? normalizeLot(lot) : null;
  }

  return lots.map(normalizeLot);
}

let initPromise = null;
async function ensureInitialized() {
  if (!initPromise) {
    initPromise = initDatabase().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

app.get("/api/lots", async (req, res, next) => {
  try {
    await ensureInitialized();
    const lotsFromDb = await getLotsWithReports();
    const username = req.query?.username?.toString().trim().toLowerCase() || null;
    const userLocation = username ? await getUserLocationCoordinates(username) : null;
    let buildingContext = null;
    let walkMinutesMap = null;
    if (userLocation) {
      buildingContext = await getNearestBuilding(userLocation);
      if (buildingContext) {
        walkMinutesMap = await getBuildingWalkMap(buildingContext.id);
      }
    }
    const { lots, source } = await generateEstimatedLots(lotsFromDb, {
      userLocation,
      buildingContext,
      walkMinutesMap,
    });
    res.json({
      lots,
      live: false,
      source,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/lots/:id/reports", async (req, res, next) => {
  try {
    await ensureInitialized();
    const { id } = req.params;
    const reports = await all(
      `SELECT r.id, r.lot_id, r.reported_status, r.note, r.created_at, u.username AS user, u.is_admin AS is_admin
       FROM reports r
       JOIN users u ON u.id = r.user_id
       WHERE r.lot_id = ?
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [id]
    );
    const adminUpdates = await listAdminNotificationsForLot(Number(id), 5);
    res.json({
      reports: reports.map((report) => ({
        id: report.id,
        lot_id: report.lot_id,
        reported_status: report.reported_status,
        note: report.note,
        created_at: Number(report.created_at),
        user: report.user,
        is_admin: Boolean(report.is_admin),
      })),
      admin_updates: adminUpdates,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/notifications", async (req, res, next) => {
  try {
    await ensureInitialized();
    const username = req.query?.username?.toString().trim() || GUEST_ACCOUNT.username;
    const userRecord = await get(`SELECT id FROM users WHERE lower(username) = ?`, [
      username.toLowerCase(),
    ]);
    if (!userRecord) {
      return res.status(404).json({ error: "User account not found" });
    }
    const limitParam = Number(req.query?.limit);
    const notifications = await listNotificationsForUser(userRecord.id, limitParam);
    res.json({
      notifications: notifications.map((notification) => ({
        id: notification.id,
        status: notification.status,
        note: notification.note,
        created_at: Number(notification.created_at),
        is_read: Boolean(notification.is_read),
        lot: {
          id: notification.lot_id,
          name: notification.lot_name,
          code: notification.lot_code,
        },
        reporter: notification.reporter_username,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/lots/:id/status", async (req, res, next) => {
  try {
    await ensureInitialized();
    const lotId = Number(req.params.id);
    const username = req.body?.username?.trim();
    const status = req.body?.status?.trim()?.toUpperCase();
    const note = req.body?.note?.trim() || "";
    if (!Number.isFinite(lotId) || lotId <= 0) {
      return res.status(400).json({ error: "Valid lot id is required." });
    }
    if (!username) {
      return res.status(400).json({ error: "Admin username is required." });
    }
    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: "Provide a valid status value." });
    }
    const adminUser = await getAdminUser(username);
    if (!adminUser) {
      return res.status(403).json({ error: "Admin privileges required." });
    }
    const lot = await get("SELECT id, capacity FROM lots WHERE id = ?", [lotId]);
    if (!lot) {
      return res.status(404).json({ error: "Lot not found." });
    }
    const timestamp = Date.now();
    const capacity = Number(lot.capacity) || 0;
    const percent = statusToPercent(status) ?? 0;
    const occupancy = capacity > 0 ? Math.round((capacity * percent) / 100) : 0;
    await run(
      `UPDATE lots SET status = ?, occupancy = ?, last_updated = ? WHERE id = ?`,
      [status, occupancy, timestamp, lotId]
    );
    await run(
      `INSERT INTO reports (lot_id, user_id, reported_status, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [lotId, adminUser.id, status, note || "Admin status update", timestamp]
    );
    await createNotificationsForLotUpdate({
      lotId,
      reporterId: adminUser.id,
      status,
      note: note || "Admin status update",
      createdAt: timestamp,
    });
    const updatedLot = await getLotsWithReports(lotId);
    res.json({ lot: updatedLot });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/events/notify", async (req, res, next) => {
  try {
    await ensureInitialized();
    const username = req.body?.username?.trim();
    const eventName = req.body?.eventName?.trim();
    const eventDate = req.body?.eventDate?.trim();
    const status = req.body?.status?.trim()?.toUpperCase();
    const lotIds = Array.isArray(req.body?.lotIds)
      ? Array.from(
          new Set(
            req.body.lotIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
          )
        )
      : [];
    const message = req.body?.note?.trim() || "";
    if (!username) {
      return res.status(400).json({ error: "Admin username is required." });
    }
    if (!eventName) {
      return res.status(400).json({ error: "Event name is required." });
    }
    if (!eventDate) {
      return res.status(400).json({ error: "Event date is required." });
    }
    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: "Provide a valid impact status." });
    }
    if (!lotIds.length) {
      return res.status(400).json({ error: "Select at least one affected lot." });
    }
    const adminUser = await getAdminUser(username);
    if (!adminUser) {
      return res.status(403).json({ error: "Admin privileges required." });
    }
    const placeholders = lotIds.map(() => "?").join(", ");
    const lots = await all(`SELECT id, name FROM lots WHERE id IN (${placeholders})`, lotIds);
    if (lots.length !== lotIds.length) {
      return res.status(404).json({ error: "One or more selected lots were not found." });
    }
    const timestamp = Date.now();
    const friendlyDate = new Date(eventDate);
    const formattedDate = Number.isNaN(friendlyDate.getTime())
      ? eventDate
      : friendlyDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
    const baseMessage = [`Event: ${eventName}`, `Date: ${formattedDate}`]
      .concat(message ? [message] : [])
      .join(" · ");
    for (const lot of lots) {
      const lotMessage = `${baseMessage} · Impact: ${lot.name} will be marked as ${status}.`;
      await createNotificationsForLotUpdate({
        lotId: lot.id,
        reporterId: adminUser.id,
        status,
        note: lotMessage,
        createdAt: timestamp,
      });
    }
    res.status(201).json({ notifications_sent: lots.length });
  } catch (error) {
    next(error);
  }
});

app.post("/api/lots/refresh", async (req, res, next) => {
  try {
    await ensureInitialized();
    const lotsFromDb = await getLotsWithReports();
    const username = req.query?.username?.toString().trim().toLowerCase() || null;
    const userLocation = username ? await getUserLocationCoordinates(username) : null;
    let buildingContext = null;
    let walkMinutesMap = null;
    if (userLocation) {
      buildingContext = await getNearestBuilding(userLocation);
      if (buildingContext) {
        walkMinutesMap = await getBuildingWalkMap(buildingContext.id);
      }
    }
    const { lots, source } = await generateEstimatedLots(lotsFromDb, {
      timestamp: Date.now(),
      userLocation,
      buildingContext,
      walkMinutesMap,
    });
    res.json({ lots, live: false, source });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    await ensureInitialized();
    const username = req.body?.username?.trim();
    const email = req.body?.email?.trim();
    const password = req.body?.password ?? "";
    if (!username || username.length < 3) {
      return res.status(400).json({ error: "Choose a username with at least 3 characters." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long." });
    }
    const normalizedEmail = normalizeEmail(email);
    const existingEmail = await get(`SELECT id FROM users WHERE email_lower = ?`, [normalizedEmail]);
    if (existingEmail) {
      return res.status(409).json({ error: "That email already has an account." });
    }
    const existingUsername = await get(
      `SELECT id FROM users WHERE lower(username) = ?`,
      [username.toLowerCase()]
    );
    if (existingUsername) {
      return res.status(409).json({ error: "That username is taken." });
    }
    const credentials = hashPassword(password);
    const result = await run(
      `INSERT INTO users (username, email, email_lower, password_hash, password_salt, points, reports, created_at, is_admin)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0)`,
      [username, email, normalizedEmail, credentials.hash, credentials.salt, Date.now()]
    );
    const user = await get(`SELECT ${USER_COLUMN_SELECTION} FROM users WHERE id = ?`, [result.id]);
    res.status(201).json({ user: normalizeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    await ensureInitialized();
    const email = req.body?.email?.trim();
    const password = req.body?.password ?? "";
    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    const normalizedEmail = normalizeEmail(email);
    const user = await get(
      `SELECT ${USER_COLUMN_SELECTION}, password_hash, password_salt FROM users WHERE email_lower = ?`,
      [normalizedEmail]
    );
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    res.json({ user: normalizeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users/:username", async (req, res, next) => {
  try {
    await ensureInitialized();
    const username = req.params.username.trim().toLowerCase();
    const user = await get(
      `SELECT ${USER_COLUMN_SELECTION} FROM users WHERE lower(username) = ?`,
      [username]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ user: normalizeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/:username/location", async (req, res, next) => {
  try {
    await ensureInitialized();
    const username = req.params.username?.trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const user = await get(
      `SELECT ${USER_COLUMN_SELECTION} FROM users WHERE lower(username) = ?`,
      [username]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy = req.body?.accuracy;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "Valid latitude and longitude are required" });
    }
    const accuracyValue = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
    const timestamp = Date.now();

    await run(
      `UPDATE users
         SET last_latitude = ?,
             last_longitude = ?,
             location_accuracy = ?,
             location_updated_at = ?
       WHERE id = ?`,
      [latitude, longitude, accuracyValue, timestamp, user.id]
    );

    const updatedUser = await get(`SELECT ${USER_COLUMN_SELECTION} FROM users WHERE id = ?`, [
      user.id,
    ]);
    res.json({ user: normalizeUser(updatedUser) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/eco-commute", async (req, res, next) => {
  try {
    await ensureInitialized();
    const username = req.body?.username?.trim() || GUEST_ACCOUNT.username;
    const rawMode = req.body?.mode;
    const mode = typeof rawMode === "string" ? rawMode.trim().toLowerCase() : "";
    if (!mode || !Object.prototype.hasOwnProperty.call(ECO_COMMUTE_POINTS, mode)) {
      return res
        .status(400)
        .json({ error: "Choose a valid commute mode: walked, biked, carpooled, or drove." });
    }

    let user = await get(
      `SELECT ${USER_COLUMN_SELECTION} FROM users WHERE lower(username) = ?`,
      [username.toLowerCase()]
    );
    if (!user && username.toLowerCase() === GUEST_ACCOUNT.username.toLowerCase()) {
      user = await getGuestUser();
    }
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const today = getTodayDateString();
    if (user.last_eco_log_date === today) {
      return res.json({
        success: false,
        message: "You already logged your eco-commute for today.",
        pointsAwarded: 0,
        totalPoints: Number(user.points) || 0,
        user: normalizeUser(user),
      });
    }

    const awarded = ECO_COMMUTE_POINTS[mode] ?? 0;
    await run(`UPDATE users SET points = points + ?, last_eco_log_date = ? WHERE id = ?`, [
      awarded,
      today,
      user.id,
    ]);
    const updatedUser = await get(`SELECT ${USER_COLUMN_SELECTION} FROM users WHERE id = ?`, [
      user.id,
    ]);

    res.json({
      success: true,
      message: `Eco-commute logged. You earned ${awarded} points.`,
      pointsAwarded: awarded,
      totalPoints: Number(updatedUser?.points) || 0,
      user: normalizeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/leaderboard", async (req, res, next) => {
  try {
    await ensureInitialized();
    const leaderboard = await all(
      `SELECT username, points
       FROM users
       ORDER BY points DESC, username ASC
       LIMIT 20`
    );
    res.json({ leaderboard: leaderboard.map((user) => ({ ...user, points: Number(user.points) })) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports", async (req, res, next) => {
  try {
    await ensureInitialized();
    const { username, lotId, status, note } = req.body ?? {};
    if (!lotId || !status) {
      return res.status(400).json({ error: "lotId and status are required" });
    }
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const lot = await get("SELECT id, capacity FROM lots WHERE id = ?", [lotId]);
    if (!lot) {
      return res.status(404).json({ error: "Lot not found" });
    }

    const trimmedUsername =
      typeof username === "string" && username.trim() ? username.trim() : GUEST_ACCOUNT.username;
    const lowerUsername = trimmedUsername.toLowerCase();
    let user = await get(
      `SELECT ${USER_COLUMN_SELECTION} FROM users WHERE lower(username) = ?`,
      [lowerUsername]
    );
    if (!user && lowerUsername === GUEST_ACCOUNT.username.toLowerCase()) {
      user = await getGuestUser();
    }
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }

    const timestamp = Date.now();
    await run(
      `INSERT INTO reports (lot_id, user_id, reported_status, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [lotId, user.id, status, note?.trim() || "", timestamp]
    );
    const percent = statusToPercent(status) ?? 0;
    const capacity = Number(lot.capacity) || 0;
    const occupancyValue = capacity > 0 ? Math.round((capacity * percent) / 100) : 0;
    await run(
      `UPDATE lots SET status = ?, occupancy = ?, last_updated = ? WHERE id = ?`,
      [status, occupancyValue, timestamp, lotId]
    );
    await run(`UPDATE users SET points = points + 5, reports = reports + 1 WHERE id = ?`, [user.id]);
    await createNotificationsForLotUpdate({
      lotId,
      reporterId: user.id,
      status,
      note,
      createdAt: timestamp,
    });

    const updatedUser = await get(`SELECT ${USER_COLUMN_SELECTION} FROM users WHERE id = ?`, [
      user.id,
    ]);
    const updatedLot = await getLotsWithReports(lotId);

    res.status(201).json({
      user: normalizeUser(updatedUser),
      lot: updatedLot,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

export default async function handler(req, res) {
  try {
    await ensureInitialized();
    return app(req, res);
  } catch (error) {
    console.error(error);
    const message = error?.message ? String(error.message) : "Internal server error";
    const code = error?.code ? String(error.code) : null;
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message,
        code,
      });
    }
  }
}
