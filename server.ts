import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import * as xlsx from "xlsx";
import { initializeApp, cert, deleteApp, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

// Define the interface matching the license schema in the image
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
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATA_DIR = path.join(process.cwd(), "data");
const JSON_DB_PATH = path.join(DATA_DIR, "license_db.json");
const CSV_DB_PATH = path.join(DATA_DIR, "license_db.csv");
const RESET_FLAG_PATH = path.join(DATA_DIR, ".database_reset_flag");
const UPLOADED_LOTS_PATH = path.join(DATA_DIR, "uploaded_lots.json");

// In-memory database for lightning fast searching
let licensesCache: LicenseRecord[] = [];
let uploadedLotsCache: any[] = [];

function saveJsonDatabaseSafe(records: LicenseRecord[]) {
  try {
    const tmpPath = `${JSON_DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2), "utf-8");
    fs.renameSync(tmpPath, JSON_DB_PATH);
  } catch (err) {
    console.error("Error saving JSON database safely:", err);
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(records, null, 2), "utf-8");
  }
}

function loadUploadedLotsIntoCache() {
  try {
    if (fs.existsSync(UPLOADED_LOTS_PATH)) {
      const rawData = fs.readFileSync(UPLOADED_LOTS_PATH, "utf-8");
      uploadedLotsCache = JSON.parse(rawData);
      if (licensesCache.length === 0 && uploadedLotsCache.length > 0) {
        console.log("[Database] Database cache is empty (0 records). Clearing ghost uploaded lots.");
        uploadedLotsCache = [];
        fs.writeFileSync(UPLOADED_LOTS_PATH, "[]", "utf-8");
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
        name: `${code}.xlsx`,
        uploadDate: todayStr,
        records: count,
        status: "Active"
      }));
      fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
      console.log(`[Database] Synthesized ${uploadedLotsCache.length} uploaded lot entries from active licenses.`);
    }
  } catch (error) {
    console.error("Error loading uploaded lots into cache:", error);
    uploadedLotsCache = [];
  }
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

let firebaseApp: App | null = null;
let firestoreDb: Firestore | null = null;
let firebaseConfigError: string | null = null;

// Function to initialize or re-initialize Firebase Admin dynamically
async function initFirebase(): Promise<boolean> {
  try {
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    let clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    // Load from json config files if existing
    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const rootConfigPath = path.join(process.cwd(), "firebase_config.json");
    const appletConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
    
    const activeConfigPath = fs.existsSync(configPath) 
      ? configPath 
      : (fs.existsSync(rootConfigPath) 
        ? rootConfigPath 
        : (fs.existsSync(appletConfigPath) ? appletConfigPath : null));

    let databaseId: string | undefined = process.env.FIREBASE_DATABASE_ID;

    if (activeConfigPath) {
      try {
        const config = JSON.parse(fs.readFileSync(activeConfigPath, "utf-8"));
        projectId = config.projectId || config.project_id || projectId;
        clientEmail = config.clientEmail || config.client_email || clientEmail;
        privateKey = config.privateKey || config.private_key || privateKey;
        databaseId = config.firestoreDatabaseId || config.databaseId || config.database_id || databaseId;
      } catch (e) {
        console.error("Error reading Firebase config file:", e);
      }
    }

    if (!projectId) {
      firebaseApp = null;
      firestoreDb = null;
      firebaseConfigError = "Firebase project ID not found. Please submit credentials in the Admin panel.";
      return false;
    }

    // Clean up existing app instance to prevent duplicate app errors
    if (firebaseApp) {
      try {
        await deleteApp(firebaseApp);
      } catch (e) {}
    }

    if (clientEmail && privateKey) {
      // Clean private key formatting
      let cleanedPrivateKey = privateKey.trim();
      if ((cleanedPrivateKey.startsWith('"') && cleanedPrivateKey.endsWith('"')) || 
          (cleanedPrivateKey.startsWith("'") && cleanedPrivateKey.endsWith("'"))) {
        cleanedPrivateKey = cleanedPrivateKey.slice(1, -1).trim();
      }
      
      cleanedPrivateKey = cleanedPrivateKey.replace(/\\n/g, "\n");
      cleanedPrivateKey = cleanedPrivateKey.replace(/\\r/g, "\r");
      cleanedPrivateKey = cleanedPrivateKey.replace(/\\"/g, '"');
      cleanedPrivateKey = cleanedPrivateKey.replace(/\\'/g, "'");

      if (cleanedPrivateKey && !cleanedPrivateKey.includes("-----BEGIN PRIVATE KEY-----")) {
        cleanedPrivateKey = `-----BEGIN PRIVATE KEY-----\n${cleanedPrivateKey}\n-----END PRIVATE KEY-----`;
      }

      firebaseApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: cleanedPrivateKey,
        })
      }, "nepal-license-central-db");
    } else {
      // Default application credentials / project initialization
      firebaseApp = initializeApp({ projectId }, "nepal-license-central-db");
    }

    if (databaseId) {
      firestoreDb = getFirestore(firebaseApp, databaseId);
    } else {
      firestoreDb = getFirestore(firebaseApp);
    }
    firebaseConfigError = null;
    console.log(`[Firebase] Admin initialized successfully for project: ${projectId}`);
    return true;
  } catch (error: any) {
    console.error("[Firebase] Initialization failed:", error);
    firebaseApp = null;
    firestoreDb = null;
    firebaseConfigError = error.message || String(error);
    return false;
  }
}

// Background sync uploader to push local cache to Firestore
// Background sync uploader to push local cache to Firestore
async function pushToFirestoreInBatches(records: LicenseRecord[]) {
  if (!firestoreDb) {
    console.log("[Firebase] Cancelled push: Firestore is not connected.");
    return;
  }

  activeSyncStatus.isSyncing = true;
  activeSyncStatus.totalRecords = records.length;
  activeSyncStatus.processedRecords = 0;
  activeSyncStatus.error = null;
  activeSyncStatus.operation = "push";
  activeSyncStatus.startTime = Date.now();

  try {
    console.log(`[Firebase] Starting chunked backup of ${records.length} records to Firestore...`);
    
    // Chunked storage in dataset_chunks collection for instant, 100% reliable backup
    const CHUNK_SIZE = 3000;
    const totalChunks = Math.ceil(records.length / CHUNK_SIZE);
    const chunksCollection = firestoreDb.collection("dataset_chunks");
    
    for (let c = 0; c < totalChunks; c++) {
      const chunkRecords = records.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      await chunksCollection.doc(`chunk_${c}`).set({
        chunkIndex: c,
        records: chunkRecords,
        updatedAt: Date.now()
      });
      activeSyncStatus.processedRecords = Math.min(records.length, (c + 1) * CHUNK_SIZE);
    }

    // Save manifest doc
    await chunksCollection.doc("manifest").set({
      totalRecords: records.length,
      chunkCount: totalChunks,
      updatedAt: Date.now()
    });

    // Also push uploaded lots to Firestore config
    await pushLotsToFirestore();

    console.log(`[Firebase] Chunked dataset backup complete successfully (${totalChunks} chunks, ${records.length} records)!`);
    activeSyncStatus.isSyncing = false;
  } catch (err: any) {
    console.error("[Firebase] Sync push error:", err);
    activeSyncStatus.error = err.message || String(err);
    activeSyncStatus.isSyncing = false;
  }
}

// Background sync downloader to pull remote Firestore data to local cache
async function pullFromFirestore() {
  if (!firestoreDb) {
    console.log("[Firebase] Cancelled pull: Firestore is not connected.");
    return;
  }

  activeSyncStatus.isSyncing = true;
  activeSyncStatus.totalRecords = 0;
  activeSyncStatus.processedRecords = 0;
  activeSyncStatus.error = null;
  activeSyncStatus.operation = "pull";
  activeSyncStatus.startTime = Date.now();
  activeSyncStatus.alreadySynced = false;

  try {
    console.log("[Firebase] Pulling remote dataset from Firestore...");
    let records: LicenseRecord[] = [];

    // Check if chunked manifest exists
    const chunksCollection = firestoreDb.collection("dataset_chunks");
    const manifestDoc = await chunksCollection.doc("manifest").get();

    if (manifestDoc.exists) {
      const manifest = manifestDoc.data();
      const chunkCount = manifest?.chunkCount || 0;
      console.log(`[Firebase] Found chunked dataset manifest with ${chunkCount} chunks (${manifest?.totalRecords} records)...`);
      
      for (let c = 0; c < chunkCount; c++) {
        const chunkDoc = await chunksCollection.doc(`chunk_${c}`).get();
        if (chunkDoc.exists) {
          const chunkData = chunkDoc.data();
          if (chunkData && Array.isArray(chunkData.records)) {
            records.push(...chunkData.records);
          }
        }
        activeSyncStatus.processedRecords = records.length;
        activeSyncStatus.totalRecords = manifest?.totalRecords || records.length;
      }
    } else {
      // Fallback to legacy individual doc query if manifest not present
      console.log("[Firebase] Manifest not found. Falling back to individual licenses collection query...");
      const collectionRef = firestoreDb.collection("licenses");
      let snapshot = await collectionRef.limit(5000).get();
      while (!snapshot.empty) {
        snapshot.docs.forEach((doc) => {
          records.push(doc.data() as LicenseRecord);
        });
        activeSyncStatus.processedRecords = records.length;
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        snapshot = await collectionRef.startAfter(lastDoc).limit(5000).get();
      }
    }

    // Sort records by sn numerically if sn exists
    records.sort((a, b) => {
      const numA = parseInt(a.sn, 10);
      const numB = parseInt(b.sn, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return 0;
    });

    console.log(`[Firebase] Pull complete. Loaded ${records.length} records.`);
    
    if (records.length > 0) {
      // Save pulled dataset locally as secondary backup files
      saveJsonDatabaseSafe(records);
      writeCsvDatabase(records);

      // Update active in-memory cache from Firestore (Single Source of Truth)
      licensesCache = records;
      console.log(`[Firebase] In-memory licensesCache updated with ${records.length} records from Firestore.`);
    } else {
      console.log("[Firebase] Firestore pulled 0 records.");
    }

    // Also pull uploaded lots from Firestore
    await pullLotsFromFirestore();

    // If uploaded lots cache is empty but we have licenses, auto-synthesize uploaded lots metadata from actual records
    if (uploadedLotsCache.length === 0 && licensesCache.length > 0) {
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
      fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
      await pushLotsToFirestore();
    }

    activeSyncStatus.isSyncing = false;
  } catch (err: any) {
    console.error("[Firebase] Sync pull error:", err);
    activeSyncStatus.error = err.message || String(err);
    activeSyncStatus.isSyncing = false;
  }
}

// Helper to clear Firestore licenses collection
async function clearFirestoreCollection() {
  if (!firestoreDb) return;
  try {
    console.log("[Firebase] Clearing chunked dataset and uploaded lots in Firestore...");
    const chunksCollection = firestoreDb.collection("dataset_chunks");
    const manifestDoc = await chunksCollection.doc("manifest").get();
    if (manifestDoc.exists) {
      const manifest = manifestDoc.data();
      const chunkCount = manifest?.chunkCount || 0;
      for (let c = 0; c < chunkCount; c++) {
        await chunksCollection.doc(`chunk_${c}`).delete().catch(() => {});
      }
      await chunksCollection.doc("manifest").delete().catch(() => {});
    }
    console.log("[Firebase] Successfully cleared dataset_chunks in Firestore.");
  } catch (err) {
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
      console.error("[Firebase] Background push failed:", e);
    });
  }
}

// Backup uploaded lots to Firestore under config/uploaded_lots
async function pushLotsToFirestore() {
  if (!firestoreDb) return;
  try {
    const docRef = firestoreDb.collection("config").doc("uploaded_lots");
    await docRef.set({ lots: uploadedLotsCache, updatedAt: Date.now() });
    console.log(`[Firebase] Successfully backed up ${uploadedLotsCache.length} uploaded lots to Firestore.`);
  } catch (err) {
    console.error("[Firebase] Error backing up uploaded lots to Firestore:", err);
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
        fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
        console.log(`[Firebase] Successfully pulled ${uploadedLotsCache.length} uploaded lots from Firestore.`);
        return;
      }
    }

    // Fallback: If uploaded lots doc is missing or empty, but licensesCache has records, synthesize lot list
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
      fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
      await pushLotsToFirestore();
      console.log(`[Firebase] Synthesized and backed up ${uploadedLotsCache.length} lots from active license records.`);
    }
  } catch (err) {
    console.error("[Firebase] Error pulling uploaded lots from Firestore:", err);
  }
}

function writeCsvDatabase(records: LicenseRecord[]) {
  const csvHeaders = ["SN", "APPLICANT ID", "FULL NAME", "LICENSE NO", "CATEGORY", "OLD CODE", "NEW CODE", "VISIT DATE", "RECEIVED BY"];
  const csvRows = records.map((r) => [
    `"${(r.sn || "").replace(/"/g, '""')}"`,
    `"${(r.applicantId || "").replace(/"/g, '""')}"`,
    `"${(r.fullName || "").replace(/"/g, '""')}"`,
    `"${(r.licenseNo || "").replace(/"/g, '""')}"`,
    `"${(r.category || "").replace(/"/g, '""')}"`,
    `"${(r.oldCode || "").replace(/"/g, '""')}"`,
    `"${(r.newCode || "").replace(/"/g, '""')}"`,
    `"${(r.visitDate || "").replace(/"/g, '""')}"`,
    `"${(r.receivedBy || "").replace(/"/g, '""')}"`
  ].join(","));
  const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
  fs.writeFileSync(CSV_DB_PATH, csvContent, "utf-8");
}

// Load database into cache on startup
function loadDatabaseIntoCache() {
  try {
    if (fs.existsSync(JSON_DB_PATH)) {
      console.log("Loading license database into memory...");
      const startTime = Date.now();
      const rawData = fs.readFileSync(JSON_DB_PATH, "utf-8");
      const parsed = JSON.parse(rawData);
      
      if (Array.isArray(parsed)) {
        licensesCache = parsed.map((r: any) => ({
          ...r,
          lotCode: r.lotCode || ""
        }));
        console.log(`Successfully loaded ${licensesCache.length} licenses in ${Date.now() - startTime}ms.`);
      }
    } else {
      console.log("No existing database found. Initializing empty database.");
      licensesCache = [];
    }
  } catch (error) {
    console.error("Error reading database file:", error);
    licensesCache = [];
  }
}

// Helper to normalize strings for robust searching
function normalizeSearchStr(str: string): string {
  return (str || "").toLowerCase().trim().replace(/[-\s]/g, "");
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

// Increase JSON payload limit to handle large search responses if needed
app.use(express.json({ limit: "10mb" }));

// Get list of uploaded lots from server database
app.get("/api/uploaded-lots", (req, res) => {
  res.json({ success: true, uploadedLots: uploadedLotsCache });
});

// Update list of uploaded lots in server database and sync with Firestore
app.post("/api/uploaded-lots", async (req, res) => {
  try {
    const { uploadedLots } = req.body;
    if (Array.isArray(uploadedLots)) {
      uploadedLotsCache = uploadedLots;
      fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
      
      // Push back up to Firestore if connected
      if (firestoreDb) {
        pushLotsToFirestore().catch(e => console.error("[Firebase] Async pushLotsToFirestore failed:", e));
      }
      
      return res.json({ success: true, message: "Uploaded lots list saved successfully.", count: uploadedLotsCache.length });
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
    const total = licensesCache.length;
    let availableCount = 0;
    let receivedCount = 0;
    const categoryCounts: Record<string, number> = {};

    for (let i = 0; i < total; i++) {
      const rec = licensesCache[i];
      // If "receivedBy" is empty, it means the license is available in the office for pickup
      if (rec.receivedBy && rec.receivedBy.trim() !== "") {
        receivedCount++;
      } else {
        availableCount++;
      }

      const cat = (rec.category || "Unknown").trim().toUpperCase();
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }

    res.json({
      success: true,
      stats: {
        total,
        available: availableCount,
        handedOver: receivedCount,
        categories: categoryCounts,
      },
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

    // Determine the source collection to query
    const sourceRecords = showOnlyAvailable 
      ? licensesCache.filter((r) => !r.receivedBy || r.receivedBy.trim() === "")
      : licensesCache;

    if (!queryStr) {
      // Return paginated list of the source records when query is empty!
      const totalMatches = sourceRecords.length;
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedMatches = sourceRecords.slice(startIndex, startIndex + limitNum);

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
    const isExact = exact === "true";
    const matches: LicenseRecord[] = [];

    // Highly optimized loop to search through records
    for (let i = 0; i < sourceRecords.length; i++) {
      const rec = sourceRecords[i];
      
      let isMatch = false;
      if (isExact) {
        // Enforce exact matches of the entire field (useful for public card inquiries)
        const normAppId = normalizeSearchStr(rec.applicantId);
        const normLicNo = normalizeSearchStr(rec.licenseNo);
        const normName = normalizeSearchStr(rec.fullName);
        const matchApplicantId = normAppId === normQuery || (normQuery.length >= 4 && normAppId.includes(normQuery));
        const matchLicenseNo = normLicNo === normQuery || (normQuery.length >= 4 && normLicNo.includes(normQuery));
        const matchName = normQuery.length >= 3 && normName.includes(normQuery);
        isMatch = matchApplicantId || matchLicenseNo || matchName;
      } else {
        // Partial matches allowed (useful for administrative back-office lookups)
        const matchApplicantId = normalizeSearchStr(rec.applicantId).includes(normQuery);
        const matchLicenseNo = normalizeSearchStr(rec.licenseNo).includes(normQuery);
        const matchFullName = normalizeSearchStr(rec.fullName).includes(normQuery);
        isMatch = matchApplicantId || matchLicenseNo || matchFullName;
      }

      if (isMatch) {
        matches.push(rec);
      }
    }

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

// 2.5. Seed mock data disabled in production
app.post("/api/seed", rateLimiter(10, 60000), (req, res) => {
  res.status(400).json({
    success: false,
    error: "Mock data seeding is permanently disabled in production. The system uses only real records."
  });
});

// 3. Import CSV/Excel database
// We use express.raw to support large direct binary/text uploads up to 100MB
app.post(
  "/api/import",
  express.raw({ limit: "150mb", type: "*/*" }),
  async (req, res) => {
    try {
      const filename = req.query.filename as string || "database.xlsx";
      const buffer = req.body;

      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ success: false, error: "Empty file uploaded." });
      }

      console.log(`Received upload: ${filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
      const startTime = Date.now();

      // Parse with xlsx - supports both CSV and XLSX
      const workbook = xlsx.read(buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert sheet to raw array of arrays for custom robust headers parsing
      const rawRows = xlsx.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
      
      if (rawRows.length < 2) {
        return res.status(400).json({ success: false, error: "The uploaded sheet does not contain enough data." });
      }

      // Identify header index and map them to our internal fields
      const headers = rawRows[0].map((h: any) => String(h || "").trim().toUpperCase());
      
      // Map columns
      const snCol = headers.findIndex((h) => h === "SN" || h === "S.N." || h === "S.NO." || h === "SERIAL");
      const applicantIdCol = headers.findIndex((h) => h.includes("APPLICANT ID") || h.includes("APPLICANT_ID") || h.includes("APPLICANTID"));
      const fullNameCol = headers.findIndex((h) => h.includes("FULL NAME") || h.includes("FULL_NAME") || h.includes("NAME"));
      const licenseNoCol = headers.findIndex((h) => h.includes("LICENSE NO") || h.includes("LICENSE_NO") || h.includes("LICENSE NUMBER") || h.includes("LICENSE"));
      const categoryCol = headers.findIndex((h) => h.includes("CATEGORY") || h.includes("CLASS"));
      const oldCodeCol = headers.findIndex((h) => h.includes("OLD CODE") || h.includes("OLD_CODE"));
      const newCodeCol = headers.findIndex((h) => h.includes("NEW CODE") || h.includes("NEW_CODE"));
      const visitDateCol = headers.findIndex((h) => h.includes("VISIT DATE") || h.includes("VISIT_DATE") || h.includes("VISIT"));
      const receivedByCol = headers.findIndex((h) => h.includes("RECEIVED BY") || h.includes("RECEIVED_BY") || h.includes("RECEIVED"));

      // Let's print out the column indices found for debugging
      console.log("Column Mapping Detected:", {
        snCol, applicantIdCol, fullNameCol, licenseNoCol, categoryCol, oldCodeCol, newCodeCol, visitDateCol, receivedByCol
      });

      // We need at least Applicant ID or License Number and Full Name to build a functional search database
      if (applicantIdCol === -1 && licenseNoCol === -1) {
        return res.status(400).json({
          success: false,
          error: "Could not find 'APPLICANT ID' or 'LICENSE NO' column in your sheet header. Please make sure the headers match the specified columns.",
        });
      }

      const lotCode = (req.query.lotCode as string) || "LOT-2083-IMPORT";
      const parsedRecords: LicenseRecord[] = [];
      
      for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        // Skip rows that are entirely empty
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
          lotCode
        };

        parsedRecords.push(record);
      }

      // Ensure cache is populated
      if (licensesCache.length === 0 && fs.existsSync(JSON_DB_PATH)) {
        try {
          licensesCache = JSON.parse(fs.readFileSync(JSON_DB_PATH, "utf-8"));
        } catch (e) {}
      }

      // Check if the uploaded records match the current database perfectly
      let isAlreadySynced = false;
      if (licensesCache.length > 0 && parsedRecords.length === licensesCache.length) {
        let allMatched = true;
        for (let i = 0; i < parsedRecords.length; i++) {
          const r1 = parsedRecords[i];
          const r2 = licensesCache[i];
          if (
            (r1.applicantId || "").trim() !== (r2.applicantId || "").trim() ||
            (r1.fullName || "").trim() !== (r2.fullName || "").trim() ||
            (r1.licenseNo || "").trim() !== (r2.licenseNo || "").trim() ||
            (r1.category || "").trim() !== (r2.category || "").trim() ||
            (r1.oldCode || "").trim() !== (r2.oldCode || "").trim() ||
            (r1.newCode || "").trim() !== (r2.newCode || "").trim()
          ) {
            allMatched = false;
            break;
          }
        }
        if (allMatched) {
          isAlreadySynced = true;
        }
      }

      if (isAlreadySynced) {
        if (uploadedLotsCache.length === 0) {
          const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
          uploadedLotsCache = [{
            id: lotCode,
            name: filename,
            uploadDate: todayStr,
            records: licensesCache.length,
            status: "Active"
          }];
          fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
          if (firestoreDb) {
            pushLotsToFirestore().catch(() => {});
          }
        }
        return res.json({
          success: true,
          alreadySynced: true,
          message: "It is already synced !!!",
          total: licensesCache.length,
          totalInDb: licensesCache.length,
          prevRecords: licensesCache.length,
          recentRecords: 0,
          duplicateFound: 0,
          duplicatesList: [],
          timeMs: Date.now() - startTime,
        });
      }

      const method = req.query.method as string || "overwrite";
      let finalRecords: LicenseRecord[] = [];

      const prevRecords = method === "append" ? licensesCache.length : 0;
      const duplicates: LicenseRecord[] = [];
      const nonDuplicates: LicenseRecord[] = [];

      if (method === "append") {
        // In append mode, we DO NOT filter out duplicates or skip records!
        // All non-empty rows in the uploaded lot spreadsheet must be appended starting from the last bottom row (the first empty row onwards)
        // so that no valuable records are lost in the lot-wise upload process.
        nonDuplicates.push(...parsedRecords);
        
        const adjustedParsed = nonDuplicates.map((r, idx) => ({
          ...r,
          sn: String(prevRecords + 1 + idx),
          serialNo: String(prevRecords + 1 + idx)
        }));
        finalRecords = [...licensesCache, ...adjustedParsed];
      } else {
        // In overwrite mode, we filter out duplicates within the uploaded file itself to clean it up
        const seenInThisFile = new Set<string>();
        for (const rec of parsedRecords) {
          if (!rec.fullName && !rec.licenseNo && !rec.applicantId) {
            nonDuplicates.push(rec);
            continue;
          }
          const key = `${normalizeSearchStr(rec.applicantId)}|${normalizeSearchStr(rec.fullName)}|${normalizeSearchStr(rec.licenseNo)}|${normalizeSearchStr(rec.category)}`;
          if (seenInThisFile.has(key)) {
            duplicates.push(rec);
          } else {
            seenInThisFile.add(key);
            nonDuplicates.push(rec);
          }
        }
        
        finalRecords = nonDuplicates.map((r, idx) => ({
          ...r,
          sn: String(1 + idx),
          serialNo: String(1 + idx)
        }));
      }

      const totalParsed = parsedRecords.length;
      console.log(`Parsed ${totalParsed} rows in ${Date.now() - startTime}ms. Method: ${method}, Duplicates: ${duplicates.length}, Final size: ${finalRecords.length}`);

      // Write parsed records to JSON database (fast load)
      saveJsonDatabaseSafe(finalRecords);

      // Build CSV representation and save to CSV database (for easy high-speed exports)
      const csvHeaders = ["SN", "APPLICANT ID", "FULL NAME", "LICENSE NO", "CATEGORY", "OLD CODE", "NEW CODE", "VISIT DATE", "RECEIVED BY"];
      const csvRows = finalRecords.map((r) => [
        `"${(r.sn || "").replace(/"/g, '""')}"`,
        `"${(r.applicantId || "").replace(/"/g, '""')}"`,
        `"${(r.fullName || "").replace(/"/g, '""')}"`,
        `"${(r.licenseNo || "").replace(/"/g, '""')}"`,
        `"${(r.category || "").replace(/"/g, '""')}"`,
        `"${(r.oldCode || "").replace(/"/g, '""')}"`,
        `"${(r.newCode || "").replace(/"/g, '""')}"`,
        `"${(r.visitDate || "").replace(/"/g, '""')}"`,
        `"${(r.receivedBy || "").replace(/"/g, '""')}"`
      ].join(","));
      
      const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
      fs.writeFileSync(CSV_DB_PATH, csvContent, "utf-8");

      // Refresh in-memory cache
      licensesCache = finalRecords;
      if (fs.existsSync(RESET_FLAG_PATH)) {
        fs.unlinkSync(RESET_FLAG_PATH);
      }

      // Update uploaded lots metadata automatically
      const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      const lotEntry = {
        id: lotCode,
        name: filename,
        uploadDate: todayStr,
        records: nonDuplicates.length,
        status: "Active"
      };

      if (method === "overwrite") {
        uploadedLotsCache = [lotEntry];
      } else {
        const existingIdx = uploadedLotsCache.findIndex(l => l.id === lotCode);
        if (existingIdx !== -1) {
          uploadedLotsCache[existingIdx] = {
            ...uploadedLotsCache[existingIdx],
            records: (uploadedLotsCache[existingIdx].records || 0) + nonDuplicates.length,
            uploadDate: todayStr
          };
        } else {
          uploadedLotsCache.push(lotEntry);
        }
      }
      fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");

      // Write directly to Firestore as Single Source of Truth
      if (firestoreDb) {
        console.log(`[Import] Synchronizing ${finalRecords.length} records directly to Firestore as Single Source of Truth...`);
        if (method === "overwrite") {
          await clearFirestoreCollection();
        }
        await pushToFirestoreInBatches(finalRecords);
        await pushLotsToFirestore();
      }

      res.json({
        success: true,
        message: `Imported ${nonDuplicates.length} new records. skipped ${duplicates.length} duplicate records successfully!`,
        total: nonDuplicates.length,
        totalInDb: finalRecords.length,
        prevRecords: prevRecords,
        recentRecords: totalParsed,
        duplicateFound: duplicates.length,
        duplicatesList: duplicates,
        timeMs: Date.now() - startTime,
      });
    } catch (error: any) {
      console.error("Error importing data:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

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
                      (!!process.env.FIREBASE_PROJECT_ID);
    
    let projectId = "";
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
    } else if (process.env.FIREBASE_PROJECT_ID) {
      projectId = process.env.FIREBASE_PROJECT_ID;
    }

    res.json({
      success: true,
      connected: !!firestoreDb,
      projectId,
      hasConfig,
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

    fs.writeFileSync(configPath, payload, "utf-8");
    try {
      fs.writeFileSync(rootConfigPath, payload, "utf-8");
    } catch (e) {}

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
      fs.unlinkSync(configPath);
    }
    if (fs.existsSync(rootConfigPath)) {
      fs.unlinkSync(rootConfigPath);
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

    // Run asynchronously to not block the server/client response
    pushToFirestoreInBatches(licensesCache).catch((e) => {
      console.error("[Firebase] Push synchronization failed:", e);
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

    // Run asynchronously to not block the server/client response
    pullFromFirestore().catch((e) => {
      console.error("[Firebase] Pull synchronization failed:", e);
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
    if (!fs.existsSync(CSV_DB_PATH)) {
      return res.status(404).json({ success: false, error: "Database is empty. Please import data first." });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="nepal_printed_licenses_export.csv"`);
    
    const fileStream = fs.createReadStream(CSV_DB_PATH);
    fileStream.pipe(res);
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

    // Save back to JSON file
    saveJsonDatabaseSafe(licensesCache);

    // Save back to CSV file
    const csvHeaders = ["SN", "APPLICANT ID", "FULL NAME", "LICENSE NO", "CATEGORY", "OLD CODE", "NEW CODE", "VISIT DATE", "RECEIVED BY"];
    const csvRows = licensesCache.map((r) => [
      `"${(r.sn || "").replace(/"/g, '""')}"`,
      `"${(r.applicantId || "").replace(/"/g, '""')}"`,
      `"${(r.fullName || "").replace(/"/g, '""')}"`,
      `"${(r.licenseNo || "").replace(/"/g, '""')}"`,
      `"${(r.category || "").replace(/"/g, '""')}"`,
      `"${(r.oldCode || "").replace(/"/g, '""')}"`,
      `"${(r.newCode || "").replace(/"/g, '""')}"`,
      `"${(r.visitDate || "").replace(/"/g, '""')}"`,
      `"${(r.receivedBy || "").replace(/"/g, '""')}"`
    ].join(","));
    const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
    fs.writeFileSync(CSV_DB_PATH, csvContent, "utf-8");

    // Async push update to Firestore if connected
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
app.post("/api/license/reset", rateLimiter(5, 60000), (req, res) => {
  try {
    console.log("Hard resetting license database...");
    licensesCache = [];
    uploadedLotsCache = [];

    if (fs.existsSync(JSON_DB_PATH)) {
      fs.unlinkSync(JSON_DB_PATH);
    }
    if (fs.existsSync(CSV_DB_PATH)) {
      fs.unlinkSync(CSV_DB_PATH);
    }
    if (fs.existsSync(UPLOADED_LOTS_PATH)) {
      fs.unlinkSync(UPLOADED_LOTS_PATH);
    }

    // Explicit reset flag to prevent auto-seeding on next reboot
    fs.writeFileSync(RESET_FLAG_PATH, "true", "utf-8");

    // Sync clear to Firestore if connected
    if (firestoreDb) {
      clearFirestoreCollection().catch(e => console.error("[Firebase] Async clearFirestoreCollection failed:", e));
      pushLotsToFirestore().catch(e => console.error("[Firebase] Async pushLotsToFirestore failed:", e));
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
    await pullFromFirestore();
    await pullLotsFromFirestore();

    if (fs.existsSync(RESET_FLAG_PATH)) {
      fs.unlinkSync(RESET_FLAG_PATH);
    }

    res.json({
      success: true,
      message: `Successfully recovered ${licensesCache.length.toLocaleString()} records from central Firestore database.`,
      count: licensesCache.length
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
    // Keep records that don't match the deleted lotCode
    licensesCache = licensesCache.filter(rec => rec.lotCode !== lotCode);
    const deletedCount = initialCount - licensesCache.length;

    console.log(`[Database] Successfully deleted ${deletedCount} records matching lotCode: ${lotCode}`);

    // Save back to JSON file (secondary backup)
    saveJsonDatabaseSafe(licensesCache);

    // Save back to CSV file (secondary backup)
    writeCsvDatabase(licensesCache);

    // Sync to Firestore if connected
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

  // 1. Load local cache into RAM immediately so server is instantly ready
  loadDatabaseIntoCache();
  loadUploadedLotsIntoCache();
  console.log(`[Server] Local Cache Initialized: ${licensesCache.length.toLocaleString()} records active in RAM cache.`);

  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Server Ready on http://0.0.0.0:${PORT}`);
    console.log("[Server] Dashboard Ready");
    console.log("[Server] Search Ready");
    console.log("[Server] Reports Ready");
  });

  // 2. Initialize Firebase Admin SDK and sync in background (non-blocking)
  (async () => {
    try {
      const firebaseConnected = await initFirebase();
      if (firebaseConnected && firestoreDb) {
        console.log("[Firebase] Firestore Connected successfully.");

        // Check if dataset exists in Firestore
        const chunksCollection = firestoreDb.collection("dataset_chunks");
        const manifestDoc = await chunksCollection.doc("manifest").get();
        let hasFirestoreData = manifestDoc.exists;

        if (!hasFirestoreData) {
          const legacyRef = firestoreDb.collection("licenses");
          const legacySnapshot = await legacyRef.limit(1).get();
          hasFirestoreData = !legacySnapshot.empty;
        }

        if (hasFirestoreData) {
          console.log("[Firebase] Production dataset found in Firestore. Loading records directly from Firestore into cache...");
          await pullFromFirestore();
          await pullLotsFromFirestore();
          console.log(`[Firebase] Loaded ${licensesCache.length.toLocaleString()} license records from Firestore.`);
        } else {
          console.log("[Firebase] Firestore is empty on startup. Checking for local dataset fallback...");
          if (licensesCache.length > 0) {
            console.log(`[Firebase] Migrating ${licensesCache.length.toLocaleString()} local records to Firestore...`);
            await pushToFirestoreInBatches(licensesCache);
            await pushLotsToFirestore();
          }
        }
      } else {
        console.log("[Firebase] Firestore not connected. Using local backup database.");
      }
    } catch (err) {
      console.error("[Firebase] Error during background Firestore startup sync:", err);
    }
  })();
}

startServer();
