import express from "express";
import path from "path";
import fs from "fs";
import * as xlsx from "xlsx";
import { initializeApp, cert, deleteApp, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { initializeApp as initWebClientApp } from "firebase/app";
import { 
  getFirestore as getWebClientFirestore, 
  doc as webDoc, 
  getDoc as webGetDoc, 
  setDoc as webSetDoc, 
  deleteDoc as webDeleteDoc, 
  collection as webCollection, 
  getDocs as webGetDocs, 
  query as webQuery, 
  limit as webLimit, 
  startAfter as webStartAfter,
  writeBatch as webWriteBatch
} from "firebase/firestore";

// Define the interface matching the license schema
interface LicenseRecord {
  sn: string;
  serialNo?: string;
  applicantId: string;
  fullName: string;
  licenseNo: string;
  category: string;
  oldCode: string;
  newCode: string;
  visitDate: string;
  receivedBy: string;
  lotCode?: string;
  _nA?: string;
  _nL?: string;
  _nN?: string;
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATA_DIR = path.join(process.cwd(), "data");
const JSON_DB_PATH = path.join(DATA_DIR, "license_db.json");
const CSV_DB_PATH = path.join(DATA_DIR, "license_db.csv");
const RESET_FLAG_PATH = path.join(DATA_DIR, ".database_reset_flag");
const UPLOADED_LOTS_PATH = path.join(DATA_DIR, "uploaded_lots.json");

// In-memory database for lightning fast searching and quota optimization
let licensesCache: LicenseRecord[] = [];
let uploadedLotsCache: any[] = [];
let cachedStats: { total: number; available: number; handedOver: number; categories: Record<string, number> } | null = null;

// Global readiness state to prevent 0-record race conditions during startup
let databaseReady = false;
let cacheReady = false;
let startupComplete = false;
let startupError: string | null = null;

// Helper to check if an error is a Firestore quota limit error (code 8 / RESOURCE_EXHAUSTED / quota exceeded)
function isQuotaExceededError(err: any): boolean {
  if (!err) return false;
  if (err.code === 8 || err.code === "resource-exhausted" || err.code === "RESOURCE_EXHAUSTED" || err.code === 429) {
    return true;
  }
  const msg = (
    (err && err.message) || 
    (err && err.details) || 
    String(err) || 
    ""
  ).toLowerCase();
  return (
    msg.includes("quota limit exceeded") || 
    msg.includes("quota exceeded") || 
    msg.includes("resource_exhausted") || 
    msg.includes("resource-exhausted") || 
    msg.includes("free daily read units") ||
    msg.includes("daily read quota") ||
    msg.includes("read quota") ||
    msg.includes("exhausted")
  );
}

// Helper to normalize strings for robust searching & duplicate detection (strips hyphens, spaces, lowercases once)
function normalizeSearchStr(str: string): string {
  return (str || "").toLowerCase().trim().replace(/[-\s]/g, "");
}

// Ultra high-speed O(1) search indexing structures
let licenseNoIndex = new Map<string, LicenseRecord[]>();
let applicantIdIndex = new Map<string, LicenseRecord[]>();

function rebuildSearchIndexes() {
  const startTime = Date.now();
  const licMap = new Map<string, LicenseRecord[]>();
  const appMap = new Map<string, LicenseRecord[]>();
  const total = licensesCache.length;

  for (let i = 0; i < total; i++) {
    const rec = licensesCache[i];
    const normAppId = normalizeSearchStr(rec.applicantId);
    const normLicNo = normalizeSearchStr(rec.licenseNo);
    const normName = normalizeSearchStr(rec.fullName);

    rec._nA = normAppId;
    rec._nL = normLicNo;
    rec._nN = normName;

    if (normLicNo) {
      let list = licMap.get(normLicNo);
      if (!list) {
        list = [];
        licMap.set(normLicNo, list);
      }
      list.push(rec);
    }

    if (normAppId) {
      let list = appMap.get(normAppId);
      if (!list) {
        list = [];
        appMap.set(normAppId, list);
      }
      list.push(rec);
    }
  }

  licenseNoIndex = licMap;
  applicantIdIndex = appMap;

  recalculateStats();
  if (global.gc) {
    try { (global as any).gc(); } catch (e) {}
  }
  if (total > 0) {
    console.log(`[Search Index] Rebuilt O(1) search maps for ${total.toLocaleString()} records in ${Date.now() - startTime}ms (${licMap.size} unique license keys, ${appMap.size} applicant keys).`);
  }
}

function recalculateStats() {
  const total = licensesCache.length;
  let availableCount = 0;
  let receivedCount = 0;
  const categoryCounts: Record<string, number> = {};

  for (let i = 0; i < total; i++) {
    const rec = licensesCache[i];
    if (rec.receivedBy && rec.receivedBy.trim() !== "") {
      receivedCount++;
    } else {
      availableCount++;
    }
    const cat = (rec.category || "Unknown").trim().toUpperCase();
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  cachedStats = {
    total,
    available: availableCount,
    handedOver: receivedCount,
    categories: categoryCounts,
  };
}

// Optional ephemeral local disk caching (purely best-effort, never crashes if filesystem is read-only or ephemeral)
function saveJsonDatabaseSafe(records: LicenseRecord[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
    }
    const tmpPath = `${JSON_DB_PATH}.tmp.${process.pid}.${Date.now()}`;
    const fd = fs.openSync(tmpPath, "w");
    fs.writeSync(fd, "[\n", undefined, "utf-8");

    const CHUNK = 2000;
    const total = records.length;
    for (let i = 0; i < total; i += CHUNK) {
      const end = Math.min(i + CHUNK, total);
      let chunkStr = "";
      for (let j = i; j < end; j++) {
        const r = records[j];
        const cleanRec = {
          sn: r.sn || "",
          serialNo: r.serialNo || r.sn || "",
          applicantId: r.applicantId || "",
          fullName: r.fullName || "",
          licenseNo: r.licenseNo || "",
          category: r.category || "",
          oldCode: r.oldCode || "",
          newCode: r.newCode || "",
          visitDate: r.visitDate || "",
          receivedBy: r.receivedBy || "",
          lotCode: r.lotCode || ""
        };
        chunkStr += JSON.stringify(cleanRec) + (j < total - 1 ? ",\n" : "\n");
      }
      fs.writeSync(fd, chunkStr, undefined, "utf-8");
    }
    fs.writeSync(fd, "]", undefined, "utf-8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    fs.renameSync(tmpPath, JSON_DB_PATH);

    try {
      const bakPath = `${JSON_DB_PATH}.bak`;
      fs.copyFileSync(JSON_DB_PATH, bakPath);
    } catch (e) {}
  } catch (err) {
    // Non-fatal on ephemeral / stateless server environments (e.g. Render)
    console.warn("[Storage] Notice: Local disk caching skipped or non-fatal error:", (err as any)?.message || err);
  }
}

function loadUploadedLotsIntoCache() {
  try {
    if (fs.existsSync(UPLOADED_LOTS_PATH)) {
      const rawData = fs.readFileSync(UPLOADED_LOTS_PATH, "utf-8");
      try {
        uploadedLotsCache = JSON.parse(rawData);
      } catch (e) {
        console.warn("[Database] UPLOADED_LOTS_PATH corrupt JSON, attempting recovery...");
        const recovered = parseCorruptedJsonArray(rawData);
        uploadedLotsCache = recovered || [];
      }
      if (startupComplete && licensesCache.length === 0 && uploadedLotsCache.length > 0) {
        console.log("[Database] Database cache is verified empty (0 records). Clearing ghost uploaded lots.");
        uploadedLotsCache = [];
        try { fs.writeFileSync(UPLOADED_LOTS_PATH, "[]", "utf-8"); } catch (e) {}
      }
      console.log(`[Database] Loaded ${uploadedLotsCache.length} uploaded lots from disk.`);
    } else {
      uploadedLotsCache = [];
    }

    if (uploadedLotsCache.length === 0 && licensesCache.length > 0) {
      const lotCounts: Record<string, number> = {};
      for (const rec of licensesCache) {
        const code = rec.lotCode || "LOT-RESTORED";
        lotCounts[code] = (lotCounts[code] || 0) + 1;
      }
      const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      uploadedLotsCache = Object.entries(lotCounts).map(([code, count]) => ({
        id: code,
        code: code,
        name: `${code}.xlsx`,
        fileName: `${code}.xlsx`,
        uploadDate: todayStr,
        records: count,
        status: "Active"
      }));
      try { fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8"); } catch (e) {}
      console.log(`[Database] Synthesized ${uploadedLotsCache.length} uploaded lot entries from active licenses.`);
    }
  } catch (error) {
    console.warn("Error loading uploaded lots into cache:", error);
    uploadedLotsCache = [];
  }
}

// Global state for live background sync progress
let activeSyncStatus = {
  isSyncing: false,
  totalRecords: 0,
  processedRecords: 0,
  error: null as string | null,
  operation: "" as "push" | "pull" | "",
  startTime: 0,
  alreadySynced: false,
};

let firebaseApp: any = null;
let firestoreDb: any = null;
let firebaseConfigError: string | null = null;
let activeProjectId = "";
let activeDatabaseId = "";

function createWebFirestoreAdapter(rawWebDb: any) {
  return {
    batch() {
      const wb = webWriteBatch(rawWebDb);
      return {
        set(docRefWrapper: any, data: any, options?: any) {
          wb.set(docRefWrapper.ref || docRefWrapper, data, options);
          return this;
        },
        delete(docRefWrapper: any) {
          wb.delete(docRefWrapper.ref || docRefWrapper);
          return this;
        },
        async commit() {
          await wb.commit();
        }
      };
    },
    collection(colName: string) {
      return {
        doc(docId: string) {
          const docRef = webDoc(rawWebDb, colName, docId);
          return {
            ref: docRef,
            async get() {
              const snap = await webGetDoc(docRef);
              return {
                exists: snap.exists(),
                data: () => snap.data(),
                id: snap.id,
              };
            },
            async set(data: any, options?: any) {
              await webSetDoc(docRef, data, options);
            },
            async delete() {
              await webDeleteDoc(docRef);
            }
          };
        },
        async get() {
          const colRef = webCollection(rawWebDb, colName);
          const snap = await webGetDocs(colRef);
          return {
            empty: snap.empty,
            docs: snap.docs.map(d => ({
              id: d.id,
              data: () => d.data(),
              ref: d.ref
            }))
          };
        },
        limit(n: number) {
          return {
            async get() {
              const colRef = webCollection(rawWebDb, colName);
              const q = webQuery(colRef, webLimit(n));
              const snap = await webGetDocs(q);
              return {
                empty: snap.empty,
                docs: snap.docs.map(d => ({
                  id: d.id,
                  data: () => d.data(),
                  ref: d.ref
                }))
              };
            },
            startAfter(lastDocWrapper: any) {
              return {
                limit(n2: number) {
                  return {
                    async get() {
                      const colRef = webCollection(rawWebDb, colName);
                      const q = webQuery(colRef, webStartAfter(lastDocWrapper.ref), webLimit(n2));
                      const snap = await webGetDocs(q);
                      return {
                        empty: snap.empty,
                        docs: snap.docs.map(d => ({
                          id: d.id,
                          data: () => d.data(),
                          ref: d.ref
                        }))
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

// Function to initialize or re-initialize Firebase dynamically
async function initFirebase(): Promise<boolean> {
  try {
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID;
    let clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.CLIENT_EMAIL || process.env.GCP_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.GCP_PRIVATE_KEY;
    let databaseId: string | undefined = process.env.FIREBASE_DATABASE_ID || process.env.FIRESTORE_DATABASE_ID || process.env.DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID;
    let apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    let authDomain = process.env.FIREBASE_AUTH_DOMAIN;
    let appId = process.env.FIREBASE_APP_ID;

    // Check for raw JSON string or JSON file in credential environment variables
    const jsonEnvVars = [
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
      process.env.FIREBASE_SERVICE_ACCOUNT,
      process.env.FIREBASE_CONFIG,
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
    ];

    for (const rawVal of jsonEnvVars) {
      if (!rawVal) continue;
      const trimmed = rawVal.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          projectId = parsed.project_id || parsed.projectId || projectId;
          clientEmail = parsed.client_email || parsed.clientEmail || clientEmail;
          privateKey = parsed.private_key || parsed.privateKey || privateKey;
          databaseId = parsed.database_id || parsed.firestoreDatabaseId || parsed.databaseId || databaseId;
          apiKey = parsed.apiKey || parsed.api_key || apiKey;
          authDomain = parsed.authDomain || authDomain;
          appId = parsed.appId || appId;
        } catch (e) {
          console.error("Error parsing JSON credential environment variable:", e);
        }
      } else if (fs.existsSync(trimmed)) {
        try {
          const fileContent = fs.readFileSync(trimmed, "utf-8");
          const parsed = JSON.parse(fileContent);
          projectId = parsed.project_id || parsed.projectId || projectId;
          clientEmail = parsed.client_email || parsed.clientEmail || clientEmail;
          privateKey = parsed.private_key || parsed.privateKey || privateKey;
          databaseId = parsed.database_id || parsed.firestoreDatabaseId || parsed.databaseId || databaseId;
          apiKey = parsed.apiKey || parsed.api_key || apiKey;
          authDomain = parsed.authDomain || authDomain;
          appId = parsed.appId || appId;
        } catch (e) {
          console.error(`Error parsing JSON credential file from ${trimmed}:`, e);
        }
      }
    }

    // Load from json config files if existing
    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const rootConfigPath = path.join(process.cwd(), "firebase_config.json");
    const appletConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
    const dataAppletConfigPath = path.join(DATA_DIR, "firebase-applet-config.json");

    const configCandidates = [configPath, rootConfigPath, appletConfigPath, dataAppletConfigPath];

    for (const cPath of configCandidates) {
      if (fs.existsSync(cPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(cPath, "utf-8"));
          projectId = config.projectId || config.project_id || projectId;
          clientEmail = config.clientEmail || config.client_email || clientEmail;
          privateKey = config.privateKey || config.private_key || privateKey;
          databaseId = config.firestoreDatabaseId || config.databaseId || config.database_id || databaseId;
          apiKey = config.apiKey || config.api_key || apiKey;
          authDomain = config.authDomain || authDomain;
          appId = config.appId || appId;
        } catch (e) {
          console.error(`Error reading Firebase config file at ${cPath}:`, e);
        }
      }
    }

    if (!projectId) {
      firebaseApp = null;
      firestoreDb = null;
      activeProjectId = "";
      activeDatabaseId = "";
      firebaseConfigError = "Missing required Firebase configuration: FIREBASE_PROJECT_ID.";
      console.error(`[Firebase] Initialization Failed: ${firebaseConfigError}`);
      return false;
    }

    activeProjectId = projectId;
    activeDatabaseId = databaseId || "";

    // Clean up existing app instance to prevent duplicate app errors
    if (firebaseApp) {
      try {
        if (typeof firebaseApp.delete === "function") {
          await firebaseApp.delete();
        } else {
          await deleteApp(firebaseApp);
        }
      } catch (e) {}
    }

    // 1. Attempt Firebase Admin SDK if service account credentials exist
    if (clientEmail && privateKey) {
      let adminApp: any = null;
      let adminDb: any = null;
      try {
        let cleanedPrivateKey = privateKey.trim();
        if ((cleanedPrivateKey.startsWith('"') && cleanedPrivateKey.endsWith('"')) || 
            (cleanedPrivateKey.startsWith("'") && cleanedPrivateKey.endsWith("'"))) {
          cleanedPrivateKey = cleanedPrivateKey.slice(1, -1).trim();
        }
        cleanedPrivateKey = cleanedPrivateKey.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\'/g, "'");

        if (!cleanedPrivateKey.includes("-----BEGIN PRIVATE KEY-----")) {
          cleanedPrivateKey = `-----BEGIN PRIVATE KEY-----\n${cleanedPrivateKey}\n-----END PRIVATE KEY-----`;
        }

        adminApp = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey: cleanedPrivateKey,
          })
        }, "nepal-license-central-db-admin");

        adminDb = databaseId ? getFirestore(adminApp, databaseId) : getFirestore(adminApp);
        try {
          await adminDb.collection("dataset_chunks").doc("manifest").get();
        } catch (mErr: any) {
          if (isQuotaExceededError(mErr)) {
            console.warn("[Firebase] Admin SDK connected, but daily read quota is exceeded. Read operations will fallback to in-memory/cache fallback.");
            firebaseApp = adminApp;
            firestoreDb = adminDb;
            firebaseConfigError = "Firestore daily read quota exceeded. Operating on in-memory cache fallback.";
            return true;
          }
          throw mErr;
        }

        firebaseApp = adminApp;
        firestoreDb = adminDb;
        firebaseConfigError = null;
        console.log("=========================================");
        console.log("[Firebase] Firebase Admin initialized");
        console.log("[Firebase] Firestore connected");
        console.log(`[Firebase] Project ID: ${projectId}`);
        if (databaseId) console.log(`[Firebase] Database ID: ${databaseId}`);
        console.log("=========================================");
        return true;
      } catch (adminErr: any) {
        if (adminApp && adminDb && isQuotaExceededError(adminErr)) {
          console.warn("[Firebase] Admin SDK connected, but daily read quota is exceeded. Read operations will fallback to in-memory cache fallback.");
          firebaseApp = adminApp;
          firestoreDb = adminDb;
          firebaseConfigError = "Firestore daily read quota exceeded. Operating on in-memory cache fallback.";
          return true;
        }
        console.warn("[Firebase] Admin SDK init failed, trying Web SDK fallback:", adminErr.message || adminErr);
      }
    }

    // 2. Fallback to Firebase Web Client SDK with apiKey (from firebase-applet-config.json)
    if (apiKey) {
      let webApp: any = null;
      let adapterDb: any = null;
      try {
        webApp = initWebClientApp({
          projectId,
          apiKey,
          authDomain,
          appId,
        }, "nepal-license-central-db-web");

        const rawWebDb = getWebClientFirestore(webApp, databaseId || undefined);
        adapterDb = createWebFirestoreAdapter(rawWebDb);
        try {
          await adapterDb.collection("dataset_chunks").doc("manifest").get();
        } catch (mErr: any) {
          if (isQuotaExceededError(mErr)) {
            console.warn("[Firebase] Web SDK connected, but daily read quota is exceeded. Read operations will fallback to in-memory cache fallback.");
            firebaseApp = webApp;
            firestoreDb = adapterDb;
            firebaseConfigError = "Firestore daily read quota exceeded. Operating on in-memory cache fallback.";
            return true;
          }
          throw mErr;
        }

        firebaseApp = webApp;
        firestoreDb = adapterDb;
        firebaseConfigError = null;
        console.log("=========================================");
        console.log("[Firebase] Firebase initialized");
        console.log("[Firebase] Firestore connected");
        console.log(`[Firebase] Project ID: ${projectId}`);
        if (databaseId) console.log(`[Firebase] Database ID: ${databaseId}`);
        console.log("=========================================");
        return true;
      } catch (webErr: any) {
        if (webApp && adapterDb && isQuotaExceededError(webErr)) {
          console.warn("[Firebase] Web SDK connected, but daily read quota is exceeded. Read operations will fallback to in-memory cache fallback.");
          firebaseApp = webApp;
          firestoreDb = adapterDb;
          firebaseConfigError = "Firestore daily read quota exceeded. Operating on in-memory cache fallback.";
          return true;
        }
        const errMsg = webErr.message || String(webErr);
        console.error(`[Firebase] Firestore Web SDK connection failed: ${errMsg}`);
        firebaseConfigError = `Firestore connection failed: ${errMsg}`;
        firestoreDb = null;
        return false;
      }
    }

    // Diagnostic missing item reporting
    const missingItems: string[] = [];
    if (!projectId) missingItems.push("FIREBASE_PROJECT_ID");
    if (!clientEmail) missingItems.push("FIREBASE_CLIENT_EMAIL");
    if (!privateKey) missingItems.push("FIREBASE_PRIVATE_KEY");
    if (!apiKey) missingItems.push("FIREBASE_API_KEY");

    firebaseConfigError = `Missing required Firebase configuration: ${missingItems.join(", ")}.`;
    console.error(`[Firebase] Initialization Failed: ${firebaseConfigError}`);
    firestoreDb = null;
    return false;
  } catch (error: any) {
    console.error("[Firebase] Initialization error:", error);
    firebaseApp = null;
    firestoreDb = null;
    firebaseConfigError = error.message || String(error);
    return false;
  }
}

// Backup uploaded lots to Firestore under config/uploaded_lots
async function pushLotsToFirestore() {
  if (!firestoreDb) return;
  try {
    const docRef = firestoreDb.collection("config").doc("uploaded_lots");
    await docRef.set({ lots: uploadedLotsCache, updatedAt: Date.now() });
    console.log(`[Firebase] Successfully backed up ${uploadedLotsCache.length} uploaded lots to Firestore.`);
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      console.warn("[Firebase] Quota exceeded while backing up uploaded lots to Firestore.");
      return;
    }
    console.error("[Firebase] Error backing up uploaded lots to Firestore:", err);
  }
}

function getNepaliDateStr(): string {
  try {
    const now = new Date();
    const yearBS = now.getFullYear() + 56 + (now.getMonth() >= 3 ? 1 : 0);
    const monthBS = String(((now.getMonth() + 8) % 12) + 1).padStart(2, "0");
    const dayBS = String(now.getDate()).padStart(2, "0");
    return `${yearBS}/${monthBS}/${dayBS}`;
  } catch (e) {
    return "2083/04/01";
  }
}

// Ensure Dashboard and Upload History represent identical database state
function synchronizeDashboardAndLots() {
  const totalInCache = licensesCache.length;
  if (totalInCache === 0) {
    if (startupComplete && uploadedLotsCache.length > 0) {
      console.log("[Sync] licensesCache is verified 0. Resetting uploadedLotsCache.");
      uploadedLotsCache = [];
      try { fs.writeFileSync(UPLOADED_LOTS_PATH, "[]", "utf-8"); } catch (e) {}
    }
    recalculateStats();
    return;
  }

  const lotCounts: Record<string, number> = {};
  for (const rec of licensesCache) {
    const code = rec.lotCode || "LOT-RESTORED";
    lotCounts[code] = (lotCounts[code] || 0) + 1;
  }

  const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const nepaliDateStr = getNepaliDateStr();

  if (uploadedLotsCache.length === 0) {
    let cumulative = 0;
    uploadedLotsCache = Object.entries(lotCounts).map(([code, count]) => {
      const prev = cumulative;
      cumulative += count;
      return {
        id: code,
        code: code,
        name: `${code}.xlsx`,
        fileName: `${code}.xlsx`,
        uploadDate: todayStr,
        nepaliDate: nepaliDateStr,
        prevRecords: prev,
        records: count,
        recentRecords: count,
        duplicateFound: 0,
        totalRecordsAfter: cumulative,
        status: "Active",
        uploadedBy: "Administrator",
        timestamp: Date.now()
      };
    });
  } else {
    let cumulative = 0;
    const existingCodes = new Set<string>();

    uploadedLotsCache = uploadedLotsCache.map(lot => {
      const lotCode = lot.code || lot.id || "LOT-RESTORED";
      existingCodes.add(lotCode);
      const recCount = lotCounts[lotCode] !== undefined ? lotCounts[lotCode] : (lot.records || 0);
      const prev = cumulative;
      cumulative += recCount;
      return {
        ...lot,
        id: lotCode,
        code: lotCode,
        name: lot.name || lot.fileName || `${lotCode}.xlsx`,
        fileName: lot.fileName || lot.name || `${lotCode}.xlsx`,
        uploadDate: lot.uploadDate || todayStr,
        nepaliDate: lot.nepaliDate || nepaliDateStr,
        prevRecords: lot.prevRecords !== undefined ? lot.prevRecords : prev,
        records: recCount,
        recentRecords: lot.recentRecords !== undefined ? lot.recentRecords : recCount,
        duplicateFound: lot.duplicateFound !== undefined ? lot.duplicateFound : 0,
        totalRecordsAfter: lot.totalRecordsAfter !== undefined ? lot.totalRecordsAfter : cumulative,
        status: lot.status || "Active",
        uploadedBy: lot.uploadedBy || lot.by || "Administrator"
      };
    });

    // Ensure any new lot code present in licensesCache is also added to uploadedLotsCache
    for (const [code, count] of Object.entries(lotCounts)) {
      if (!existingCodes.has(code)) {
        const prev = cumulative;
        cumulative += count;
        uploadedLotsCache.push({
          id: code,
          code: code,
          name: `${code}.xlsx`,
          fileName: `${code}.xlsx`,
          uploadDate: todayStr,
          nepaliDate: nepaliDateStr,
          prevRecords: prev,
          records: count,
          recentRecords: count,
          duplicateFound: 0,
          totalRecordsAfter: cumulative,
          status: "Active",
          uploadedBy: "Administrator",
          timestamp: Date.now()
        });
      }
    }
  }

  try {
    fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
  } catch (e) {}

  recalculateStats();
}

// Sequential Batch Insertion Pipeline: groups records into batches of 400 documents max per writeBatch(),
// processes sequentially with await batch.commit(), applies artificial delay between commits, and performs exponential backoff on code 8 (RESOURCE_EXHAUSTED).
async function pushToFirestoreInBatches(records: LicenseRecord[], isAppend: boolean = false): Promise<{ success: boolean; uploadedChunks: number; failedChunk?: number; remainingChunks?: number; error?: string; quotaExceeded?: boolean }> {
  if (!firestoreDb) {
    console.log("[Firebase] Cancelled push: Firestore is not connected.");
    return { success: true, uploadedChunks: 0 };
  }

  activeSyncStatus.isSyncing = true;
  activeSyncStatus.totalRecords = records.length;
  activeSyncStatus.processedRecords = 0;
  activeSyncStatus.error = null;
  activeSyncStatus.operation = "push";
  activeSyncStatus.startTime = Date.now();

  const CHUNK_SIZE = 500; // 500 records per chunk document (~80-120 KB per doc, far below 1MB doc limit)
  const BATCH_DOC_LIMIT = 8; // 8 chunk docs per batch (~700 KB - 1 MB payload, far below 10MB batch limit)
  const THROTTLE_DELAY_MS = 100; // Throttling delay between sequential commits to let gRPC write streams flush
  const chunksCollection = firestoreDb.collection("dataset_chunks");

  let existingTotalRecords = 0;
  let existingChunkCount = 0;
  let startChunkIndex = 0;

  if (isAppend) {
    try {
      const manifestDoc = await chunksCollection.doc("manifest").get();
      if (manifestDoc.exists) {
        const mData = manifestDoc.data();
        existingTotalRecords = mData?.totalRecords || 0;
        existingChunkCount = mData?.chunkCount || 0;
      }
    } catch (e: any) {
      if (isQuotaExceededError(e)) {
        console.warn("[Firebase] Quota limit reached while checking manifest doc in append mode.");
        activeSyncStatus.isSyncing = false;
        return {
          success: false,
          quotaExceeded: true,
          uploadedChunks: 0,
          error: "Firestore daily write quota reached (resource-exhausted). Data saved in-memory."
        };
      }
      console.warn("[Firebase] Warning reading existing manifest for append mode:", e);
    }
    startChunkIndex = existingChunkCount;
    console.log(`[Import] Mode: APPEND | New records: ${records.length} | Existing Chunks: ${existingChunkCount}`);
  } else {
    console.log(`[Import] Mode: OVERWRITE | Records: ${records.length}`);
    await clearFirestoreCollection();
    startChunkIndex = 0;
  }

  const numNewChunks = Math.ceil(records.length / CHUNK_SIZE);
  let uploadedChunksCount = 0;

  // Helper function to commit a single Firestore writeBatch with exponential backoff on code 8 / RESOURCE_EXHAUSTED
  async function commitBatchWithBackoff(batch: any, batchLabel: string): Promise<void> {
    const maxRetries = 5;
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      try {
        await batch.commit();
        return;
      } catch (err: any) {
        const isResourceExhausted = isQuotaExceededError(err) || err.code === 8 || err.code === "resource-exhausted";
        if (isResourceExhausted && attempt < maxRetries) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000) + Math.floor(Math.random() * 200);
          console.warn(`[Firebase] Write stream RESOURCE_EXHAUSTED (Code 8) on ${batchLabel}. Exponential backoff retry ${attempt}/${maxRetries} in ${delayMs}ms...`);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          console.error(`[Firebase] Batch commit failure on ${batchLabel} (attempt ${attempt}):`, err.message || err);
          throw err;
        }
      }
    }
  }

  try {
    // 1. Prepare chunk doc operations with clean lean records (omitting in-memory indexing keys)
    const chunkBatchList: { chunkId: number; docRef: any; data: any }[] = [];
    for (let c = 0; c < numNewChunks; c++) {
      const rawChunkRecords = records.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      const cleanChunkRecords = rawChunkRecords.map(r => ({
        sn: r.sn || "",
        serialNo: r.serialNo || r.sn || "",
        applicantId: r.applicantId || "",
        fullName: r.fullName || "",
        licenseNo: r.licenseNo || "",
        category: r.category || "",
        oldCode: r.oldCode || "",
        newCode: r.newCode || "",
        visitDate: r.visitDate || "",
        receivedBy: r.receivedBy || "",
        lotCode: r.lotCode || ""
      }));
      const targetChunkId = startChunkIndex + c;
      const docRef = chunksCollection.doc(`chunk_${targetChunkId}`);
      chunkBatchList.push({
        chunkId: targetChunkId,
        docRef,
        data: {
          chunkIndex: targetChunkId,
          records: cleanChunkRecords,
          updatedAt: Date.now()
        }
      });
    }

    // Partition chunk docs into small sub-batches of BATCH_DOC_LIMIT docs max to guarantee < 1.5MB per batch payload
    const batchedDocGroups: (typeof chunkBatchList)[] = [];
    for (let i = 0; i < chunkBatchList.length; i += BATCH_DOC_LIMIT) {
      batchedDocGroups.push(chunkBatchList.slice(i, i + BATCH_DOC_LIMIT));
    }

    // Process all document batches strictly sequentially using for...of with await batch.commit()
    let groupIndex = 0;
    for (const docGroup of batchedDocGroups) {
      groupIndex++;
      const currentBatch = firestoreDb.batch();

      for (const item of docGroup) {
        currentBatch.set(item.docRef, item.data);
      }

      const batchLabel = `Batch group ${groupIndex}/${batchedDocGroups.length} (${docGroup.length} chunk docs)`;
      console.log(`[Firebase] Sequentially committing ${batchLabel}...`);

      try {
        await commitBatchWithBackoff(currentBatch, batchLabel);
        uploadedChunksCount += docGroup.length;
        activeSyncStatus.processedRecords = Math.min(records.length, uploadedChunksCount * CHUNK_SIZE);

        // Rate-limiting throttle delay between sequential batch commits to allow gRPC write streams to flush
        await new Promise(res => setTimeout(res, THROTTLE_DELAY_MS));
      } catch (batchErr: any) {
        const isQuota = isQuotaExceededError(batchErr);
        const failedChunkIndex = docGroup[0]?.chunkId ?? 0;
        const remaining = numNewChunks - uploadedChunksCount;
        console.error(`[Firebase] Sequential batch commit failed at chunk_${failedChunkIndex} (quotaExceeded=${isQuota}):`, batchErr.message || batchErr);
        activeSyncStatus.error = batchErr.message || String(batchErr);
        activeSyncStatus.isSyncing = false;
        return {
          success: false,
          quotaExceeded: isQuota,
          uploadedChunks: uploadedChunksCount,
          failedChunk: failedChunkIndex,
          remainingChunks: remaining,
          error: isQuota
            ? "Firestore write stream quota exhausted (Code 8: RESOURCE_EXHAUSTED). Records remain safe in memory."
            : (batchErr.message || String(batchErr))
        };
      }
    }

    // Save/update manifest doc safely ONLY after all new chunks succeeded
    const finalTotalRecords = isAppend ? (existingTotalRecords + records.length) : records.length;
    const finalChunkCount = isAppend ? (existingChunkCount + numNewChunks) : numNewChunks;

    try {
      const manifestBatch = firestoreDb.batch();
      manifestBatch.set(chunksCollection.doc("manifest"), {
        totalRecords: finalTotalRecords,
        chunkCount: finalChunkCount,
        updatedAt: Date.now()
      });
      await commitBatchWithBackoff(manifestBatch, "Dataset Manifest Doc");
      console.log(`[Import] Manifest updated: totalRecords=${finalTotalRecords}, chunkCount=${finalChunkCount}`);
    } catch (mErr: any) {
      if (isQuotaExceededError(mErr)) {
        console.warn("[Firebase] Manifest update quota exceeded.");
      }
    }

    // Also push uploaded lots to Firestore config
    await pushLotsToFirestore().catch(e => console.warn("[Firebase] pushLotsToFirestore notice:", e?.message || e));

    activeSyncStatus.isSyncing = false;
    return {
      success: true,
      uploadedChunks: numNewChunks
    };
  } catch (err: any) {
    const isQuota = isQuotaExceededError(err);
    console.error("[Firebase] Sequential batch sync push error:", err);
    activeSyncStatus.error = err.message || String(err);
    activeSyncStatus.isSyncing = false;
    return {
      success: false,
      quotaExceeded: isQuota,
      uploadedChunks: uploadedChunksCount,
      error: err.message || String(err)
    };
  }
}

// Background sync downloader to pull remote Firestore chunks without full collection reads
async function pullFromFirestore(): Promise<{ success: boolean; count: number; quotaExceeded?: boolean; error?: string }> {
  if (!firestoreDb) {
    console.log("[Firebase] Cancelled pull: Firestore is not connected.");
    return { success: false, count: 0, error: "Firestore not connected" };
  }

  activeSyncStatus.isSyncing = true;
  activeSyncStatus.totalRecords = 0;
  activeSyncStatus.processedRecords = 0;
  activeSyncStatus.error = null;
  activeSyncStatus.operation = "pull";
  activeSyncStatus.startTime = Date.now();
  activeSyncStatus.alreadySynced = false;

  try {
    console.log("[Firebase] Checking remote dataset manifest in Firestore (single doc read)...");
    let records: LicenseRecord[] = [];

    const chunksCollection = firestoreDb.collection("dataset_chunks");
    let manifestDoc: any = null;
    try {
      manifestDoc = await chunksCollection.doc("manifest").get();
    } catch (mErr: any) {
      if (isQuotaExceededError(mErr)) {
        console.warn("[Firebase] Read quota exceeded reading dataset manifest. Using in-memory dataset.");
        activeSyncStatus.isSyncing = false;
        return { success: false, count: licensesCache.length, quotaExceeded: true, error: "Firestore read quota exceeded." };
      }
      throw mErr;
    }

    if (manifestDoc && manifestDoc.exists) {
      const manifest = manifestDoc.data();
      const chunkCount = manifest?.chunkCount || 0;
      const totalExpected = manifest?.totalRecords || 0;
      console.log(`[Firebase] Manifest found: ${chunkCount} chunks (${totalExpected.toLocaleString()} total records).`);

      // If in-memory cache already has complete data matching the manifest, SKIP redundant chunk reads!
      if (licensesCache.length >= totalExpected && totalExpected > 0) {
        console.log(`[Firebase] In-memory cache is already up-to-date (${licensesCache.length.toLocaleString()} records). Skipping chunk downloads to save Firestore quota!`);
        activeSyncStatus.isSyncing = false;
        activeSyncStatus.alreadySynced = true;
        cacheReady = true;
        startupError = null;
        return { success: true, count: licensesCache.length };
      }

      const CONCURRENCY = 6;
      for (let c = 0; c < chunkCount; c += CONCURRENCY) {
        const batchIndices = [];
        for (let j = c; j < Math.min(c + CONCURRENCY, chunkCount); j++) {
          batchIndices.push(j);
        }
        try {
          const docs = await Promise.all(
            batchIndices.map(idx => chunksCollection.doc(`chunk_${idx}`).get())
          );
          for (const chunkDoc of docs) {
            if (chunkDoc.exists) {
              const chunkData = chunkDoc.data();
              if (chunkData && Array.isArray(chunkData.records)) {
                records.push(...chunkData.records);
              }
            }
          }
          activeSyncStatus.processedRecords = records.length;
          activeSyncStatus.totalRecords = totalExpected || records.length;
        } catch (cErr: any) {
          if (isQuotaExceededError(cErr)) {
            console.warn(`[Firebase] Read quota exceeded at chunk batch ${c}. Preserving ${records.length} hydrated records and local cache.`);
            break;
          }
          throw cErr;
        }
      }
    } else {
      console.log("[Firebase] Manifest not found. Skipping legacy full-collection scan to preserve quota.");
    }

    if (records.length > 0) {
      // Sort records by sn numerically
      records.sort((a, b) => {
        const numA = parseInt(a.sn, 10);
        const numB = parseInt(b.sn, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return 0;
      });

      licensesCache = records;
      saveJsonDatabaseSafe(records);
      writeCsvDatabase(records);
      rebuildSearchIndexes();
      cacheReady = true;
      startupError = null;
      console.log(`[Firebase] Hydration complete: ${records.length.toLocaleString()} records loaded into memory.`);
    }

    await pullLotsFromFirestore();
    synchronizeDashboardAndLots();

    activeSyncStatus.isSyncing = false;
    return { success: true, count: licensesCache.length };
  } catch (err: any) {
    const isQuota = isQuotaExceededError(err);
    console.error("[Firebase] Sync pull error (quotaExceeded=" + isQuota + "):", err.message || err);
    activeSyncStatus.error = err.message || String(err);
    activeSyncStatus.isSyncing = false;

    if (licensesCache.length === 0) {
      loadDatabaseIntoCache();
      loadUploadedLotsIntoCache();
    }

    if (licensesCache.length > 0) {
      rebuildSearchIndexes();
      synchronizeDashboardAndLots();
      cacheReady = true;
      startupError = null;
    }
    return { success: false, count: licensesCache.length, quotaExceeded: isQuota, error: err.message || String(err) };
  }
}

// Helper to clear Firestore licenses chunk collection
async function clearFirestoreCollection() {
  if (!firestoreDb) return;
  try {
    console.log("[Firebase] Clearing chunked dataset and uploaded lots in Firestore...");
    const chunksCollection = firestoreDb.collection("dataset_chunks");
    let chunkCount = 0;
    try {
      const manifestDoc = await chunksCollection.doc("manifest").get();
      if (manifestDoc.exists) {
        const manifest = manifestDoc.data();
        chunkCount = manifest?.chunkCount || 0;
      }
    } catch (e) {}

    const maxChunksToDelete = Math.max(chunkCount, 50);
    const BATCH_LIMIT = 400;
    
    for (let c = 0; c < maxChunksToDelete; c += BATCH_LIMIT) {
      const batch = firestoreDb.batch();
      const end = Math.min(c + BATCH_LIMIT, maxChunksToDelete);
      for (let j = c; j < end; j++) {
        batch.delete(chunksCollection.doc(`chunk_${j}`));
      }
      if (c === 0) {
        batch.delete(chunksCollection.doc("manifest"));
      }
      try {
        await batch.commit();
        await new Promise(r => setTimeout(r, 100));
      } catch (delErr: any) {
        if (isQuotaExceededError(delErr)) {
          console.warn("[Firebase] Quota limit during batch delete chunk.");
          return;
        }
      }
    }
    console.log("[Firebase] Successfully cleared dataset_chunks in Firestore.");
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      console.warn("[Firebase] Quota reached during clear collection.");
      return;
    }
    console.error("[Firebase] Error clearing dataset_chunks:", err);
  }
}

// Background utility to automatically write data to Firestore on change if connected
function asyncPushToFirestoreIfConnected(records: LicenseRecord[], overwrite: boolean = false) {
  if (firestoreDb) {
    console.log(`[Firebase] Central DB connected. Pushing ${records.length} modified records to cloud (overwrite: ${overwrite})...`);
    const runSync = async () => {
      if (overwrite) {
        await clearFirestoreCollection();
      }
      await pushToFirestoreInBatches(records);
    };
    runSync().catch((e) => {
      console.warn("[Firebase] Background push notice:", e?.message || e);
    });
  }
}

// Pull uploaded lots from Firestore under config/uploaded_lots
async function pullLotsFromFirestore() {
  if (!firestoreDb) return;
  try {
    const docRef = firestoreDb.collection("config").doc("uploaded_lots");
    const doc = await docRef.get();
    if (doc.exists) {
      const data = doc.data();
      if (data && Array.isArray(data.lots) && data.lots.length > 0) {
        uploadedLotsCache = data.lots;
        try { fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8"); } catch (e) {}
        console.log(`[Firebase] Successfully pulled ${uploadedLotsCache.length} uploaded lots from Firestore.`);
        return;
      }
    }

    if (licensesCache.length > 0) {
      const lotCounts: Record<string, number> = {};
      for (const rec of licensesCache) {
        const code = rec.lotCode || "LOT-RESTORED";
        lotCounts[code] = (lotCounts[code] || 0) + 1;
      }
      const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      uploadedLotsCache = Object.entries(lotCounts).map(([code, count]) => ({
        id: code,
        name: `${code}.xlsx`,
        uploadDate: todayStr,
        records: count,
        status: "Active"
      }));
      try { fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8"); } catch (e) {}
      await pushLotsToFirestore();
    }
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      console.warn("[Firebase] Quota reached during pullLotsFromFirestore.");
      return;
    }
    console.warn("[Firebase] Error pulling uploaded lots from Firestore:", err);
  }
}

function writeCsvDatabase(records: LicenseRecord[]) {
  setImmediate(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
      }
      const tmpPath = `${CSV_DB_PATH}.tmp.${process.pid}.${Date.now()}`;
      const fd = fs.openSync(tmpPath, "w");
      fs.writeSync(fd, "SN,APPLICANT ID,FULL NAME,LICENSE NO,CATEGORY,OLD CODE,NEW CODE,VISIT DATE,RECEIVED BY,LOT CODE\n", undefined, "utf-8");

      const CHUNK = 5000;
      for (let i = 0; i < records.length; i += CHUNK) {
        let chunkStr = "";
        const end = Math.min(i + CHUNK, records.length);
        for (let j = i; j < end; j++) {
          const r = records[j];
          chunkStr += `"${(r.sn || "").replace(/"/g, '""')}","${(r.applicantId || "").replace(/"/g, '""')}","${(r.fullName || "").replace(/"/g, '""')}","${(r.licenseNo || "").replace(/"/g, '""')}","${(r.category || "").replace(/"/g, '""')}","${(r.oldCode || "").replace(/"/g, '""')}","${(r.newCode || "").replace(/"/g, '""')}","${(r.visitDate || "").replace(/"/g, '""')}","${(r.receivedBy || "").replace(/"/g, '""')}","${(r.lotCode || "").replace(/"/g, '""')}"\n`;
        }
        fs.writeSync(fd, chunkStr, undefined, "utf-8");
      }
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(tmpPath, CSV_DB_PATH);
    } catch (e) {
      // Non-fatal on ephemeral / stateless server environments
    }
  });
}

function parseCorruptedJsonArray(rawData: string): any[] | null {
  try {
    const parsed = JSON.parse(rawData);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}

  try {
    let lastPos = rawData.length;
    let attempts = 0;
    while (attempts < 100) {
      attempts++;
      const lastBraceIndex = rawData.lastIndexOf("}", lastPos - 1);
      if (lastBraceIndex === -1) break;

      let candidate = rawData.substring(0, lastBraceIndex + 1).trim();
      if (candidate.endsWith(",")) {
        candidate = candidate.slice(0, -1).trim();
      }
      if (!candidate.endsWith("]")) {
        candidate += "\n]";
      }

      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (err) {
        lastPos = lastBraceIndex;
      }
    }
  } catch (recErr) {}

  return null;
}

function loadDatabaseFromCsvFallback(): LicenseRecord[] {
  if (!fs.existsSync(CSV_DB_PATH)) return [];
  try {
    const content = fs.readFileSync(CSV_DB_PATH, "utf-8");
    const lines = content.split(/\r?\n/);
    if (lines.length <= 1) return [];

    const records: LicenseRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let c = 0; c < line.length; c++) {
        const char = line[c];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.replace(/^"|"$/g, '').replace(/""/g, '"'));
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.replace(/^"|"$/g, '').replace(/""/g, '"'));

      if (values.length >= 4) {
        records.push({
          sn: values[0] || String(records.length + 1),
          applicantId: values[1] || "",
          fullName: values[2] || "",
          licenseNo: values[3] || "",
          category: values[4] || "",
          oldCode: values[5] || "",
          newCode: values[6] || "",
          visitDate: values[7] || "",
          receivedBy: values[8] || "",
          lotCode: values[9] || ""
        });
      }
    }
    return records;
  } catch (err) {
    return [];
  }
}

// Load database into cache on startup (from local disk if available)
function loadDatabaseIntoCache() {
  try {
    let jsonRecords: LicenseRecord[] = [];
    let isCorruptedJson = false;

    if (fs.existsSync(JSON_DB_PATH)) {
      try {
        const rawData = fs.readFileSync(JSON_DB_PATH, "utf-8");
        try {
          const parsed = JSON.parse(rawData);
          if (Array.isArray(parsed)) {
            jsonRecords = parsed.map((r: any) => ({
              ...r,
              lotCode: r.lotCode || ""
            }));
          }
        } catch (jsonErr: any) {
          isCorruptedJson = true;
          const recovered = parseCorruptedJsonArray(rawData);
          if (Array.isArray(recovered)) {
            jsonRecords = recovered.map((r: any) => ({
              ...r,
              lotCode: r.lotCode || ""
            }));
          }
        }
      } catch (e) {}
    }

    let csvRecords: LicenseRecord[] = [];
    if (fs.existsSync(CSV_DB_PATH)) {
      csvRecords = loadDatabaseFromCsvFallback();
    }

    if (csvRecords.length > jsonRecords.length) {
      licensesCache = csvRecords;
      saveJsonDatabaseSafe(licensesCache);
    } else if (jsonRecords.length > 0) {
      licensesCache = jsonRecords;
      if (isCorruptedJson) {
        saveJsonDatabaseSafe(licensesCache);
      }
    } else {
      licensesCache = [];
    }

    rebuildSearchIndexes();
  } catch (error) {
    if (licensesCache.length === 0 && fs.existsSync(CSV_DB_PATH)) {
      licensesCache = loadDatabaseFromCsvFallback();
    }
    rebuildSearchIndexes();
  }
}

// In-memory rate limiting implementation for high security
interface RateLimitInfo {
  count: number;
  resetTime: number;
}
const rateLimitMap = new Map<string, RateLimitInfo>();

function rateLimiter(maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown_ip";
    const ipStr = Array.isArray(ip) ? ip[0] : String(ip);
    const now = Date.now();
    
    let info = rateLimitMap.get(ipStr);
    if (!info || now > info.resetTime) {
      info = { count: 1, resetTime: now + windowMs };
      rateLimitMap.set(ipStr, info);
      return next();
    }
    
    info.count++;
    if (info.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: "अत्यधिक अनुरोधहरू! कृपया केही समय पछि प्रयास गर्नुहोस् (Too many requests. Please try again later.)"
      });
    }
    
    next();
  };
}

// Input sanitization helper to prevent injection attacks
function sanitizeInput(str: string): string {
  return (str || "").replace(/[<>'"\\;]/g, "").trim();
}

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer-when-downgrade");
  next();
});

// JSON and URL-encoded payload limits
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Global API Middleware: Force Content-Type: application/json on all /api endpoints
app.use("/api", (req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Global Readiness Middleware to block data requests until startup hydration completes
app.use(["/api/stats", "/api/search", "/api/uploaded-lots", "/api/license", "/api/export", "/api/import"], (req, res, next) => {
  if (!startupComplete || !cacheReady) {
    return res.status(503).json({
      success: false,
      error: startupError || "Server Initializing. Dataset hydration in progress...",
      initializing: true,
      databaseReady,
      cacheReady,
      startupComplete
    });
  }
  next();
});

// Get list of uploaded lots from server database
app.get("/api/uploaded-lots", (req, res) => {
  synchronizeDashboardAndLots();
  res.json({ success: true, uploadedLots: uploadedLotsCache });
});

// Update list of uploaded lots in server database and sync with Firestore
app.post("/api/uploaded-lots", async (req, res) => {
  try {
    const { uploadedLots } = req.body;
    if (Array.isArray(uploadedLots)) {
      if ((uploadedLots.length === 0 && licensesCache.length > 0) || (uploadedLots.length < uploadedLotsCache.length)) {
        console.warn(`[Database] Resynchronizing server lots.`);
        synchronizeDashboardAndLots();
      } else if (uploadedLots.length >= uploadedLotsCache.length && uploadedLots.length > 0) {
        uploadedLotsCache = uploadedLots.map(lot => ({
          ...lot,
          id: lot.code || lot.id || "LOT-RESTORED",
          code: lot.code || lot.id || "LOT-RESTORED",
          name: lot.name || lot.fileName || `${lot.code || lot.id || 'LOT'}.xlsx`,
          fileName: lot.fileName || lot.name || `${lot.code || lot.id || 'LOT'}.xlsx`,
          uploadDate: lot.uploadDate || lot.dateTime || new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
          status: lot.status || "Active",
          uploadedBy: lot.uploadedBy || lot.by || "Administrator"
        }));
        try { fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8"); } catch (e) {}
        if (firestoreDb) {
          pushLotsToFirestore().catch(() => {});
        }
      }
      return res.json({ success: true, message: "Uploaded lots list saved successfully.", count: uploadedLotsCache.length, uploadedLots: uploadedLotsCache });
    } else {
      return res.status(400).json({ success: false, error: "Invalid uploadedLots data. Must be an array." });
    }
  } catch (error: any) {
    console.error("Error saving uploaded lots:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 1. Get statistics for the dashboard
app.get("/api/stats", (req, res) => {
  try {
    if (!cachedStats) {
      recalculateStats();
    }
    res.json({
      success: true,
      stats: cachedStats,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Search database in real-time
app.get("/api/search", rateLimiter(120, 60000), (req, res) => {
  try {
    const { q, page = "1", limit = "50", exact, available } = req.query;
    const rawQueryStr = typeof q === "string" ? q.trim() : "";
    const queryStr = sanitizeInput(rawQueryStr);
    const showOnlyAvailable = available === "true";
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 50;
    const startTime = Date.now();

    if (!queryStr) {
      let totalMatches = 0;
      const paginatedMatches: LicenseRecord[] = [];
      const startIndex = (pageNum - 1) * limitNum;
      const endIndex = startIndex + limitNum;

      if (showOnlyAvailable) {
        for (let i = 0; i < licensesCache.length; i++) {
          const rec = licensesCache[i];
          if (!rec.receivedBy || rec.receivedBy.trim() === "") {
            if (totalMatches >= startIndex && totalMatches < endIndex) {
              paginatedMatches.push(rec);
            }
            totalMatches++;
          }
        }
      } else {
        totalMatches = licensesCache.length;
        const items = licensesCache.slice(startIndex, endIndex);
        paginatedMatches.push(...items);
      }

      return res.json({
        success: true,
        results: paginatedMatches,
        totalMatches,
        totalInDb: licensesCache.length,
        searchTimeMs: Date.now() - startTime,
        page: pageNum,
        limit: limitNum,
      });
    }

    const normQuery = normalizeSearchStr(queryStr);
    const matchedSet = new Set<LicenseRecord>();

    // 1. Instant O(1) Hash Map Lookups for EXACT License Number and EXACT Applicant ID
    const licMatches = licenseNoIndex.get(normQuery);
    if (licMatches) {
      for (let i = 0; i < licMatches.length; i++) {
        const rec = licMatches[i];
        if (!showOnlyAvailable || !rec.receivedBy || rec.receivedBy.trim() === "") {
          matchedSet.add(rec);
        }
      }
    }

    const appMatches = applicantIdIndex.get(normQuery);
    if (appMatches) {
      for (let i = 0; i < appMatches.length; i++) {
        const rec = appMatches[i];
        if (!showOnlyAvailable || !rec.receivedBy || rec.receivedBy.trim() === "") {
          matchedSet.add(rec);
        }
      }
    }

    // 2. Fallback check: strict exact match on Applicant ID or License Number only
    if (matchedSet.size === 0) {
      const len = licensesCache.length;
      for (let i = 0; i < len; i++) {
        const rec = licensesCache[i];
        if (showOnlyAvailable && rec.receivedBy && rec.receivedBy.trim() !== "") {
          continue;
        }

        const normAppId = rec._nA || (rec._nA = normalizeSearchStr(rec.applicantId));
        const normLicNo = rec._nL || (rec._nL = normalizeSearchStr(rec.licenseNo));

        if (normLicNo === normQuery || normAppId === normQuery) {
          matchedSet.add(rec);
        }
      }
    }

    const matches = Array.from(matchedSet);
    const totalMatches = matches.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedMatches = matches.slice(startIndex, startIndex + limitNum);

    res.json({
      success: true,
      results: paginatedMatches,
      totalMatches,
      totalInDb: licensesCache.length,
      searchTimeMs: Date.now() - startTime,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Seed mock data disabled in production
app.post("/api/seed", rateLimiter(10, 60000), (req, res) => {
  res.status(400).json({
    success: false,
    error: "Mock data seeding is permanently disabled in production. The system uses only real records."
  });
});

// 3. Ephemeral In-Memory Streamed Chunk Processing for Lot Ingestion (200,000+ records)
interface ImportJob {
  id: string;
  status: "processing" | "completed" | "failed";
  progress: number;
  message: string;
  filename: string;
  method: string;
  lotCode: string;
  result?: any;
  error?: string;
  createdAt: number;
}

const importJobs = new Map<string, ImportJob>();

// Clean up old jobs after 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of importJobs.entries()) {
    if (now - job.createdAt > 3600000) {
      importJobs.delete(id);
    }
  }
}, 300000);

async function executeImportJob(
  jobId: string,
  buffer: Buffer,
  filename: string,
  method: string,
  requestedLotCode: string,
  uploadedBy: string
) {
  const startTime = Date.now();
  const job = importJobs.get(jobId);
  if (!job) return;

  try {
    job.message = "Parsing spreadsheet buffer in-memory...";
    job.progress = 10;

    let workbook: xlsx.WorkBook;
    try {
      workbook = xlsx.read(buffer, { type: "buffer" });
    } catch (parseErr: any) {
      job.status = "failed";
      job.error = `Failed to parse Excel/CSV spreadsheet: ${parseErr.message || parseErr}`;
      return;
    }

    const firstSheetName = workbook.SheetNames ? workbook.SheetNames[0] : "";
    if (!firstSheetName) {
      job.status = "failed";
      job.error = "The uploaded spreadsheet contains no sheets.";
      return;
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsx.utils.sheet_to_json<any[]>(worksheet, { header: 1 });

    if (!rawRows || rawRows.length < 2) {
      job.status = "failed";
      job.error = "The uploaded file is empty or contains no data rows.";
      return;
    }

    // Match column headers dynamically
    const headerRow = (rawRows[0] || []).map((h: any) => normalizeSearchStr(String(h || "")));
    let snCol = -1, applicantIdCol = -1, fullNameCol = -1, licenseNoCol = -1, categoryCol = -1;
    let oldCodeCol = -1, newCodeCol = -1, visitDateCol = -1, receivedByCol = -1;

    headerRow.forEach((h: string, idx: number) => {
      if (h.includes("sn") || h.includes("s.n") || h.includes("serial")) snCol = idx;
      if (h.includes("applicant") || h.includes("appl")) applicantIdCol = idx;
      if (h.includes("name") || h.includes("full")) fullNameCol = idx;
      if (h.includes("license") || h.includes("licence") || h.includes("lic")) licenseNoCol = idx;
      if (h.includes("cat") || h.includes("category")) categoryCol = idx;
      if (h.includes("old") || h.includes("oldcode")) oldCodeCol = idx;
      if (h.includes("new") || h.includes("newcode")) newCodeCol = idx;
      if (h.includes("visit") || h.includes("date")) visitDateCol = idx;
      if (h.includes("receive") || h.includes("by") || h.includes("user")) receivedByCol = idx;
    });

    if (applicantIdCol === -1 && licenseNoCol === -1) {
      job.status = "failed";
      job.error = "Could not find 'APPLICANT ID' or 'LICENSE NO' column in your sheet header.";
      return;
    }

    const parsedRecords: LicenseRecord[] = [];
    const numRows = rawRows.length;
    for (let i = 1; i < numRows; i++) {
      const row = rawRows[i];
      if (!row || row.length === 0) continue;
      const hasData = row.some((cell: any) => cell !== undefined && cell !== null && String(cell).trim() !== "");
      if (!hasData) continue;

      const record: LicenseRecord = {
        sn: snCol !== -1 && row[snCol] !== undefined ? String(row[snCol]).trim() : String(i),
        serialNo: snCol !== -1 && row[snCol] !== undefined ? String(row[snCol]).trim() : String(i),
        applicantId: applicantIdCol !== -1 && row[applicantIdCol] !== undefined ? String(row[applicantIdCol]).trim() : "",
        fullName: fullNameCol !== -1 && row[fullNameCol] !== undefined ? String(row[fullNameCol]).trim() : "",
        licenseNo: licenseNoCol !== -1 && row[licenseNoCol] !== undefined ? String(row[licenseNoCol]).trim() : "",
        category: categoryCol !== -1 && row[categoryCol] !== undefined ? String(row[categoryCol]).trim() : "",
        oldCode: oldCodeCol !== -1 && row[oldCodeCol] !== undefined ? String(row[oldCodeCol]).trim() : "",
        newCode: newCodeCol !== -1 && row[newCodeCol] !== undefined ? String(row[newCodeCol]).trim() : "",
        visitDate: visitDateCol !== -1 && row[visitDateCol] !== undefined ? String(row[visitDateCol]).trim() : "",
        receivedBy: receivedByCol !== -1 && row[receivedByCol] !== undefined ? String(row[receivedByCol]).trim() : "",
        lotCode: ""
      };
      parsedRecords.push(record);
    }

    if (parsedRecords.length === 0) {
      job.status = "failed";
      job.error = "No valid data rows could be parsed from the file.";
      return;
    }

    job.message = `Parsed ${parsedRecords.length.toLocaleString()} rows. Validating duplicates with O(1) indexed lookup...`;
    job.progress = 30;

    const isAppend = method === "append";
    const prevRecords = isAppend ? licensesCache.length : 0;

    // Determine Lot Code
    let lotCode = requestedLotCode;
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename.includes("2nd-lot") || lowerFilename.includes("2nd_lot")) {
      lotCode = "2nd-LOT";
    } else if (lowerFilename.includes("1st-lot") || lowerFilename.includes("1st_lot")) {
      lotCode = "1st-LOT";
    } else if (lowerFilename.includes("3rd-lot") || lowerFilename.includes("3rd_lot")) {
      lotCode = "3rd-LOT";
    } else if (!lotCode || lotCode === "LOT-2083-IMPORT") {
      const lotIndex = (uploadedLotsCache.length || 0) + 1;
      const s = ["th", "st", "nd", "rd"];
      const v = lotIndex % 100;
      const suffix = s[(v - 20) % 10] || s[v] || s[0];
      lotCode = `${lotIndex}${suffix}-LOT`;
    }

    // Quota-Optimized Fast Duplicate Detection: using indexed in-memory composite hash sets (0 DB reads!)
    const existingKeys = new Set<string>();
    if (isAppend) {
      for (let i = 0; i < licensesCache.length; i++) {
        const rec = licensesCache[i];
        if (rec.applicantId || rec.licenseNo || rec.fullName) {
          const k = `${normalizeSearchStr(rec.applicantId)}|${normalizeSearchStr(rec.fullName)}|${normalizeSearchStr(rec.licenseNo)}|${normalizeSearchStr(rec.category)}`;
          existingKeys.add(k);
        }
      }
    }

    const duplicates: LicenseRecord[] = [];
    const nonDuplicates: LicenseRecord[] = [];
    const batchKeys = new Set<string>();

    for (let i = 0; i < parsedRecords.length; i++) {
      const rec = parsedRecords[i];
      if (!rec.fullName && !rec.licenseNo && !rec.applicantId) {
        nonDuplicates.push(rec);
        continue;
      }
      const k = `${normalizeSearchStr(rec.applicantId)}|${normalizeSearchStr(rec.fullName)}|${normalizeSearchStr(rec.licenseNo)}|${normalizeSearchStr(rec.category)}`;
      if (existingKeys.has(k) || batchKeys.has(k)) {
        duplicates.push(rec);
      } else {
        batchKeys.add(k);
        nonDuplicates.push(rec);
      }
    }

    if (isAppend && nonDuplicates.length === 0) {
      job.status = "completed";
      job.progress = 100;
      job.message = "यो डाटाबेस पहिले नै सिङ्क गरिएको छ (It is already synced !!!)";
      job.result = {
        success: true,
        alreadySynced: true,
        message: "यो डाटाबेस पहिले नै सिङ्क गरिएको छ (It is already synced !!!)",
        total: 0,
        totalInDb: licensesCache.length,
        prevRecords: licensesCache.length,
        recentRecords: parsedRecords.length,
        duplicateFound: duplicates.length,
        duplicatesList: duplicates.slice(0, 50),
        uploadedLots: uploadedLotsCache,
        timeMs: Date.now() - startTime
      };
      return;
    }

    // Assign continuous SNs and lot code to newly accepted records
    const assignedRecords = nonDuplicates.map((r, idx) => ({
      ...r,
      sn: String(prevRecords + 1 + idx),
      serialNo: String(prevRecords + 1 + idx),
      lotCode: lotCode
    }));

    job.message = `Persisting ${assignedRecords.length.toLocaleString()} records into chunked storage...`;
    job.progress = 60;

    // Send small chunked database batches (500-1,000 records per chunk) to Firestore
    let firestoreSyncResult: { success: boolean; uploadedChunks: number; failedChunk?: number; remainingChunks?: number; error?: string; quotaExceeded?: boolean } = { success: true, uploadedChunks: 0 };
    if (firestoreDb) {
      if (!isAppend) {
        await clearFirestoreCollection();
      }
      firestoreSyncResult = await pushToFirestoreInBatches(assignedRecords, isAppend);
    }

    // Build Lot Entry
    const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const nepaliDateStr = getNepaliDateStr();
    const finalTotalRecords = prevRecords + assignedRecords.length;

    const lotEntry = {
      id: lotCode,
      code: lotCode,
      name: filename,
      fileName: filename,
      uploadDate: todayStr,
      nepaliDate: nepaliDateStr,
      prevRecords: prevRecords,
      records: assignedRecords.length,
      recentRecords: parsedRecords.length,
      duplicateFound: duplicates.length,
      totalRecordsAfter: finalTotalRecords,
      status: "Active",
      uploadedBy: uploadedBy || "Administrator",
      timestamp: Date.now(),
      duplicatesList: duplicates.length > 0 ? duplicates.slice(0, 50) : []
    };

    // Update Lot Cache
    if (!isAppend) {
      uploadedLotsCache = [lotEntry];
    } else {
      const existingIdx = uploadedLotsCache.findIndex(l => (l.id === lotCode || l.code === lotCode));
      if (existingIdx !== -1) {
        uploadedLotsCache[existingIdx] = {
          ...uploadedLotsCache[existingIdx],
          records: (uploadedLotsCache[existingIdx].records || 0) + assignedRecords.length,
          recentRecords: (uploadedLotsCache[existingIdx].recentRecords || 0) + parsedRecords.length,
          duplicateFound: (uploadedLotsCache[existingIdx].duplicateFound || 0) + duplicates.length,
          totalRecordsAfter: finalTotalRecords,
          uploadDate: todayStr,
          nepaliDate: nepaliDateStr,
          timestamp: Date.now()
        };
      } else {
        uploadedLotsCache.push(lotEntry);
      }
    }

    if (firestoreDb) {
      pushLotsToFirestore().catch(() => {});
    }
    try { fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8"); } catch (e) {}

    // Update RAM Cache & Search Indexes
    job.message = "Updating search indexes...";
    job.progress = 90;

    const finalCacheRecords = isAppend ? [...licensesCache, ...assignedRecords] : assignedRecords;
    licensesCache = finalCacheRecords;
    saveJsonDatabaseSafe(licensesCache);
    writeCsvDatabase(licensesCache);
    rebuildSearchIndexes();

    if (fs.existsSync(RESET_FLAG_PATH)) {
      try { fs.unlinkSync(RESET_FLAG_PATH); } catch (e) {}
    }

    job.status = "completed";
    job.progress = 100;
    job.message = `Successfully imported ${assignedRecords.length.toLocaleString()} records. Total dataset now: ${finalTotalRecords.toLocaleString()}`;
    job.result = {
      success: true,
      message: `Successfully uploaded & parsed ${assignedRecords.length.toLocaleString()} records from "${filename}"!`,
      total: assignedRecords.length,
      totalInDb: finalTotalRecords,
      prevRecords: prevRecords,
      recentRecords: parsedRecords.length,
      duplicateFound: duplicates.length,
      duplicatesList: duplicates.slice(0, 50),
      uploadedLots: uploadedLotsCache,
      lotEntry,
      timeMs: Date.now() - startTime,
      quotaExceeded: firestoreSyncResult.quotaExceeded,
      warning: firestoreSyncResult.error ? `Firestore note: ${firestoreSyncResult.error}` : undefined
    };
    console.log(`[ImportJob ${jobId}] Finished in ${Date.now() - startTime}ms. Final total: ${finalTotalRecords}`);
  } catch (err: any) {
    console.error(`[ImportJob ${jobId}] Failed with error:`, err);
    job.status = "failed";
    job.error = err.message || String(err);
  }
}

// File upload endpoint for continuous lot importation
app.post("/api/import", express.raw({ type: "*/*", limit: "100mb" }), async (req, res) => {
  req.setTimeout(600000); // 10 minutes timeout for large datasets
  res.setTimeout(600000);
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    const filename = (req.query.filename as string) || "imported_spreadsheet.xlsx";
    const method = (req.query.method as string) || "append";
    const requestedLotCode = (req.query.lotCode as string) || "";
    const uploadedBy = (req.query.uploadedBy as string) || "Administrator";
    const buffer = req.body;

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No file content uploaded.",
        message: "No file content uploaded."
      });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    importJobs.set(jobId, {
      id: jobId,
      status: "processing",
      progress: 5,
      message: "File received. Processing import in memory...",
      filename,
      method,
      lotCode: requestedLotCode,
      createdAt: Date.now()
    });

    // Start background in-memory processing
    executeImportJob(jobId, buffer, filename, method, requestedLotCode, uploadedBy).catch(err => {
      console.error(`[ImportJob ${jobId}] Unhandled error:`, err);
      const job = importJobs.get(jobId);
      if (job) {
        job.status = "failed";
        job.error = err.message || String(err);
      }
    });

    return res.json({
      success: true,
      status: "processing",
      jobId,
      message: "Import job started."
    });
  } catch (err: any) {
    console.error("[Import] Error initiating upload job:", err);
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// Import job status polling
app.get("/api/import/status", (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const jobId = req.query.jobId as string;
    if (!jobId || !importJobs.has(jobId)) {
      return res.status(404).json({ success: false, error: "Import job not found or expired." });
    }
    const job = importJobs.get(jobId)!;
    if (job.status === "completed") {
      return res.json({
        success: true,
        status: "completed",
        progress: 100,
        message: job.message,
        result: job.result
      });
    } else if (job.status === "failed") {
      return res.json({
        success: false,
        status: "failed",
        error: job.error || "Import failed"
      });
    } else {
      return res.json({
        success: true,
        status: "processing",
        progress: job.progress,
        message: job.message
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// ==========================================
// FIREBASE SYNC & CENTRAL DATABASE ENDPOINTS
// ==========================================

// Check the connected Firebase status
app.get("/api/firebase/status", async (req, res) => {
  try {
    if (!firestoreDb) {
      await initFirebase();
    }

    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const rootConfigPath = path.join(process.cwd(), "firebase_config.json");
    const appletConfigPath = path.join(process.cwd(), "firebase-applet-config.json");

    const hasConfig = fs.existsSync(configPath) || 
                      fs.existsSync(rootConfigPath) || 
                      fs.existsSync(appletConfigPath) || 
                      (!!process.env.FIREBASE_PROJECT_ID) ||
                      (!!process.env.GCP_PROJECT) ||
                      (!!process.env.GOOGLE_CLOUD_PROJECT) ||
                      (!!process.env.FIREBASE_CONFIG) ||
                      (!!process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    
    let projectId = activeProjectId;
    if (!projectId) {
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          projectId = config.projectId || config.project_id || "";
        } catch (e) {}
      } else if (fs.existsSync(appletConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(appletConfigPath, "utf-8"));
          projectId = config.projectId || config.project_id || "";
        } catch (e) {}
      } else {
        projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
      }
    }

    res.json({
      success: true,
      connected: !!firestoreDb,
      projectId,
      databaseId: activeDatabaseId || "",
      hasConfig,
      databaseReady,
      cacheReady,
      startupComplete,
      startupError,
      error: firebaseConfigError,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure new Firebase Admin settings dynamically
app.post("/api/firebase/config", async (req, res) => {
  try {
    const { projectId, clientEmail, privateKey } = req.body;

    if (!projectId || !clientEmail || !privateKey) {
      return res.status(400).json({ success: false, error: "Missing required config parameters." });
    }

    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const rootConfigPath = path.join(process.cwd(), "firebase_config.json");
    const payload = JSON.stringify({ projectId, clientEmail, privateKey }, null, 2);

    try { fs.writeFileSync(configPath, payload, "utf-8"); } catch (e) {}
    try { fs.writeFileSync(rootConfigPath, payload, "utf-8"); } catch (e) {}

    const success = await initFirebase();

    if (success) {
      if (licensesCache.length === 0) {
        pullFromFirestore().then(() => {
          console.log(`[Firebase] Auto-pulled ${licensesCache.length} records after config connect.`);
        }).catch(e => console.error("[Firebase] Error pulling after config connect:", e));
      }
      res.json({ success: true, message: "Firebase credentials configured and initialized successfully!" });
    } else {
      res.status(400).json({ success: false, error: firebaseConfigError || "Failed to initialize Firebase with provided credentials." });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Disconnect Firebase from the server
app.post("/api/firebase/disconnect", async (req, res) => {
  try {
    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const rootConfigPath = path.join(process.cwd(), "firebase_config.json");
    if (fs.existsSync(configPath)) {
      try { fs.unlinkSync(configPath); } catch (e) {}
    }
    if (fs.existsSync(rootConfigPath)) {
      try { fs.unlinkSync(rootConfigPath); } catch (e) {}
    }
    
    if (firebaseApp) {
      try {
        await deleteApp(firebaseApp);
      } catch (e) {}
      firebaseApp = null;
      firestoreDb = null;
    }
    
    firebaseConfigError = "Firebase disconnected by administrator.";
    res.json({ success: true, message: "Firebase integration credentials removed." });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger background synchronization: Local Cache -> Firestore
app.post("/api/firebase/sync/push", async (req, res) => {
  try {
    if (activeSyncStatus.isSyncing) {
      return res.json({ success: false, error: "A synchronization process is already running." });
    }
    if (!firestoreDb) {
      await initFirebase();
    }
    if (!firestoreDb) {
      return res.json({ success: false, error: "Firebase Admin is not connected. Push sync requires a connected Firestore database." });
    }

    pushToFirestoreInBatches(licensesCache).catch((e) => {
      console.warn("[Firebase] Push synchronization notice:", e?.message || e);
    });

    res.json({ success: true, message: "Background push to Firestore started!" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger background synchronization: Firestore -> Local Cache
app.post("/api/firebase/sync/pull", async (req, res) => {
  try {
    if (activeSyncStatus.isSyncing) {
      return res.json({ success: false, error: "A synchronization process is already running." });
    }
    if (!firestoreDb) {
      await initFirebase();
    }
    if (!firestoreDb) {
      return res.json({ success: false, error: "Firebase Admin is not connected. Pull sync requires a connected Firestore database." });
    }

    pullFromFirestore().catch((e) => {
      console.warn("[Firebase] Pull synchronization notice:", e?.message || e);
    });

    res.json({ success: true, message: "Background pull from Firestore started!" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Poll synchronization progress status
app.get("/api/firebase/sync/status", (req, res) => {
  res.json({
    success: true,
    status: activeSyncStatus,
  });
});

// 4. Export database back to CSV
app.get("/api/export", (req, res) => {
  try {
    if (licensesCache.length === 0 && !fs.existsSync(CSV_DB_PATH)) {
      return res.status(404).json({ success: false, error: "Database is empty. Please import data first." });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="nepal_printed_licenses_export.csv"`);

    if (fs.existsSync(CSV_DB_PATH)) {
      const fileStream = fs.createReadStream(CSV_DB_PATH);
      fileStream.pipe(res);
    } else {
      // Generate CSV from memory if disk file not present
      res.write("SN,APPLICANT ID,FULL NAME,LICENSE NO,CATEGORY,OLD CODE,NEW CODE,VISIT DATE,RECEIVED BY,LOT CODE\n");
      const records = licensesCache;
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        res.write(`"${(r.sn || "").replace(/"/g, '""')}","${(r.applicantId || "").replace(/"/g, '""')}","${(r.fullName || "").replace(/"/g, '""')}","${(r.licenseNo || "").replace(/"/g, '""')}","${(r.category || "").replace(/"/g, '""')}","${(r.oldCode || "").replace(/"/g, '""')}","${(r.newCode || "").replace(/"/g, '""')}","${(r.visitDate || "").replace(/"/g, '""')}","${(r.receivedBy || "").replace(/"/g, '""')}","${(r.lotCode || "").replace(/"/g, '""')}"\n`);
      }
      res.end();
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4.1. Mark a license as received / handed over to applicant
app.post("/api/license/receive", rateLimiter(45, 60000), (req, res) => {
  try {
    const { licenseNo, applicantId, receivedBy } = req.body;
    
    if (!licenseNo && !applicantId) {
      return res.status(400).json({ success: false, error: "Missing license number or applicant ID." });
    }

    let found = false;
    for (let i = 0; i < licensesCache.length; i++) {
      const rec = licensesCache[i];
      if ((licenseNo && rec.licenseNo === licenseNo) || (applicantId && rec.applicantId === applicantId)) {
        licensesCache[i].receivedBy = receivedBy || "";
        found = true;
        break;
      }
    }

    if (!found) {
      return res.status(404).json({ success: false, error: "License record not found." });
    }

    saveJsonDatabaseSafe(licensesCache);
    writeCsvDatabase(licensesCache);
    recalculateStats();
    asyncPushToFirestoreIfConnected(licensesCache);

    res.json({
      success: true,
      message: `Successfully marked license as received by "${receivedBy}"!`,
      record: licensesCache.find(r => r.licenseNo === licenseNo || r.applicantId === applicantId)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4.2. Hard Reset database (Clear all records)
app.post("/api/license/reset", rateLimiter(5, 60000), async (req, res) => {
  try {
    console.log("Hard resetting license database...");
    licensesCache = [];
    uploadedLotsCache = [];
    rebuildSearchIndexes();

    if (fs.existsSync(JSON_DB_PATH)) {
      try { fs.unlinkSync(JSON_DB_PATH); } catch (e) {}
    }
    if (fs.existsSync(CSV_DB_PATH)) {
      try { fs.unlinkSync(CSV_DB_PATH); } catch (e) {}
    }
    if (fs.existsSync(UPLOADED_LOTS_PATH)) {
      try { fs.unlinkSync(UPLOADED_LOTS_PATH); } catch (e) {}
    }

    try { fs.writeFileSync(RESET_FLAG_PATH, "true", "utf-8"); } catch (e) {}

    if (firestoreDb) {
      await clearFirestoreCollection();
      await pushLotsToFirestore();
    }

    res.json({
      success: true,
      message: "Database successfully cleared. All local cache and database files have been reset."
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4.3. Database Loss Recovery from Firestore
app.post("/api/license/recover", async (req, res) => {
  try {
    if (!firestoreDb) {
      return res.status(400).json({ success: false, error: "Firebase Admin is not connected. Recovery requires an active Firestore database." });
    }

    console.log("[Recovery] Pulling records from central Firestore database...");
    const result = await pullFromFirestore();
    await pullLotsFromFirestore();

    if (fs.existsSync(RESET_FLAG_PATH)) {
      try { fs.unlinkSync(RESET_FLAG_PATH); } catch (e) {}
    }

    res.json({
      success: true,
      message: `Successfully recovered ${licensesCache.length.toLocaleString()} records from central Firestore database.`,
      count: licensesCache.length,
      quotaExceeded: result.quotaExceeded
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4.4. Delete a specific lot of records and recalculate stats
app.post("/api/license/delete-lot", async (req, res) => {
  try {
    const { lotCode, count } = req.body;
    if (!lotCode) {
      return res.status(400).json({ success: false, error: "Missing lotCode parameter." });
    }

    console.log(`[Database] Request to delete lot: ${lotCode} (${count} records)`);

    const initialCount = licensesCache.length;
    licensesCache = licensesCache.filter(rec => rec.lotCode !== lotCode);
    const deletedCount = initialCount - licensesCache.length;
    rebuildSearchIndexes();

    console.log(`[Database] Successfully deleted ${deletedCount} records matching lotCode: ${lotCode}`);

    saveJsonDatabaseSafe(licensesCache);
    writeCsvDatabase(licensesCache);

    if (firestoreDb) {
      console.log(`[Database] Syncing deleted lot changes (${licensesCache.length} remaining) to Firestore...`);
      await clearFirestoreCollection();
      await pushToFirestoreInBatches(licensesCache);
      await pushLotsToFirestore();
    }

    res.json({
      success: true,
      message: `Successfully deleted lot "${lotCode}" and its ${deletedCount} associated records.`,
      deletedCount,
      totalInDb: licensesCache.length
    });
  } catch (error: any) {
    console.error("[Database] Error deleting lot:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Setup Vite dev server middleware or serve production assets
async function startServer() {
  console.log("=========================================");
  console.log(" PLSMS - Central Database Startup Routine ");
  console.log("=========================================");

  // Step 1: Load local disk backup into cache as immediate offline fallback
  loadDatabaseIntoCache();
  loadUploadedLotsIntoCache();
  console.log(`[Server] Initial Cache State: ${licensesCache.length.toLocaleString()} records in RAM cache.`);

  // Step 2 & 3: Quota-Optimized Firebase Initialization
  try {
    console.log("[Startup] Initializing Firebase connection...");
    const firebaseConnected = await initFirebase();

    if (firebaseConnected && firestoreDb) {
      databaseReady = true;
      console.log("[Startup] Firestore connection verified. Checking manifest (single doc read)...");

      let hasFirestoreData = false;
      let manifestCount = 0;
      try {
        const chunksCollection = firestoreDb.collection("dataset_chunks");
        const manifestDoc = await chunksCollection.doc("manifest").get();
        if (manifestDoc.exists) {
          hasFirestoreData = true;
          manifestCount = manifestDoc.data()?.totalRecords || 0;
        }
      } catch (mErr: any) {
        if (isQuotaExceededError(mErr)) {
          console.warn("[Startup] Manifest read quota reached. Operating on in-memory dataset.");
        } else {
          console.warn("[Startup] Firestore manifest check warning:", mErr.message || mErr);
        }
      }

      if (hasFirestoreData) {
        if (licensesCache.length >= manifestCount && licensesCache.length > 0) {
          console.log(`[Startup] RAM cache (${licensesCache.length.toLocaleString()}) matches or exceeds Firestore manifest (${manifestCount.toLocaleString()}). Skipping redundant chunk reads to conserve quota!`);
        } else {
          console.log(`[Startup] Hydrating dataset chunks from Firestore...`);
          await pullFromFirestore();
          await pullLotsFromFirestore();
        }
      } else {
        console.log("[Startup] Firestore manifest is empty or fresh. Checking for initial local records...");
        if (licensesCache.length > 0) {
          pushToFirestoreInBatches(licensesCache).catch(e => console.warn("[Startup] Background batch push warning:", e?.message || e));
          pushLotsToFirestore().catch(e => console.warn("[Startup] Push lots warning:", e?.message || e));
        }
      }
    } else {
      console.warn(`[Startup] Firebase connection note: ${firebaseConfigError || "Firestore not connected"}. Running on in-memory cache.`);
    }
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      console.warn("[Startup] Firestore quota limit reached during startup. Operating on in-memory cache fallback.");
    } else {
      console.error("[Startup] Firestore startup hydration warning:", err.message || err);
    }
  }

  // Step 4: Verify search indexes and run startup data integrity audit
  rebuildSearchIndexes();
  synchronizeDashboardAndLots();

  const firestoreCount = licensesCache.length;
  const dashboardCount = cachedStats?.total || licensesCache.length;
  const uploadHistoryTotal = uploadedLotsCache.reduce((sum, l) => sum + (l.recentRecords !== undefined ? l.recentRecords : (l.records || 0)), 0);

  console.log("=========================================");
  console.log("      STARTUP DATA INTEGRITY AUDIT       ");
  console.log("=========================================");
  console.log(`Licenses In-Memory:       ${firestoreCount.toLocaleString()}`);
  console.log(`Dashboard Records:        ${dashboardCount.toLocaleString()}`);
  console.log(`Upload History Total:     ${uploadHistoryTotal.toLocaleString()}`);
  console.log("=========================================");

  if (licensesCache.length > 0) {
    cacheReady = true;
    startupError = null;
  } else {
    cacheReady = true;
  }

  startupComplete = true;

  // Global API Error Handler to guarantee JSON responses for all /api endpoints
  app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[API Error Handler]", err);
    if (res.headersSent) {
      return next(err);
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: err.message || "An unexpected server error occurred.",
      message: err.message || "An unexpected server error occurred."
    });
  });

  // Unmatched API catch-all handler: prevent any /api request from falling through to SPA HTML
  app.all("/api/*", (req: express.Request, res: express.Response) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      message: `API route not found: ${req.method} ${req.originalUrl}`
    });
  });

  // Step 5: Mount Vite middleware or static serve
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Step 6: Start Express HTTP listener
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Server Ready and Listening on http://0.0.0.0:${PORT}`);
    console.log(`[Server] Active Records in RAM Cache: ${licensesCache.length.toLocaleString()}`);
  });
}

startServer();
