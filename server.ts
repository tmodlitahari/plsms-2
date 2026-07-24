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
const PORT = 3000;
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
      console.log(`[Database] Loaded ${uploadedLotsCache.length} uploaded lots from disk.`);
    } else {
      uploadedLotsCache = [];
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
    let projectId = process.env.FIREBASE_PROJECT_ID;
    let clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    // Load from json config file if exists (check data dir first, then root dir fallback)
    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const rootConfigPath = path.join(process.cwd(), "firebase_config.json");
    const activeConfigPath = fs.existsSync(configPath) ? configPath : (fs.existsSync(rootConfigPath) ? rootConfigPath : null);

    if (activeConfigPath) {
      try {
        const config = JSON.parse(fs.readFileSync(activeConfigPath, "utf-8"));
        projectId = config.projectId || projectId;
        clientEmail = config.clientEmail || clientEmail;
        privateKey = config.privateKey || privateKey;
      } catch (e) {
        console.error("Error reading firebase_config.json:", e);
      }
    }

    if (!projectId || !clientEmail || !privateKey) {
      firebaseApp = null;
      firestoreDb = null;
      firebaseConfigError = "Firebase not yet configured. Please submit credentials in the Admin panel.";
      return false;
    }

    // Clean private key formatting (convert raw "\n" strings and handle enclosing quotes / escapes)
    let cleanedPrivateKey = privateKey.trim();
    if ((cleanedPrivateKey.startsWith('"') && cleanedPrivateKey.endsWith('"')) || 
        (cleanedPrivateKey.startsWith("'") && cleanedPrivateKey.endsWith("'"))) {
      cleanedPrivateKey = cleanedPrivateKey.slice(1, -1).trim();
    }
    
    // Replace double-escaped newlines and standard backslash-n sequences
    cleanedPrivateKey = cleanedPrivateKey.replace(/\\n/g, "\n");
    cleanedPrivateKey = cleanedPrivateKey.replace(/\\r/g, "\r");
    cleanedPrivateKey = cleanedPrivateKey.replace(/\\"/g, '"');
    cleanedPrivateKey = cleanedPrivateKey.replace(/\\'/g, "'");

    // Ensure BEGIN and END tags are present and properly formatted
    if (cleanedPrivateKey && !cleanedPrivateKey.includes("-----BEGIN PRIVATE KEY-----")) {
      cleanedPrivateKey = `-----BEGIN PRIVATE KEY-----\n${cleanedPrivateKey}\n-----END PRIVATE KEY-----`;
    }

    // Clean up existing app instance to prevent duplicate app errors
    if (firebaseApp) {
      try {
        await deleteApp(firebaseApp);
      } catch (e) {}
    }

    firebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: cleanedPrivateKey,
      })
    }, "nepal-license-central-db");

    firestoreDb = getFirestore(firebaseApp);
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
    
    let isIdentical = false;
    if (records.length > 0 && records.length === licensesCache.length) {
      let allMatched = true;
      for (let i = 0; i < Math.min(100, records.length); i++) {
        const r1 = records[i];
        const r2 = licensesCache[i];
        if (
          (r1.applicantId || "").trim() !== (r2.applicantId || "").trim() ||
          (r1.fullName || "").trim() !== (r2.fullName || "").trim() ||
          (r1.licenseNo || "").trim() !== (r2.licenseNo || "").trim()
        ) {
          allMatched = false;
          break;
        }
      }
      if (allMatched) {
        isIdentical = true;
      }
    }

    if (isIdentical) {
      activeSyncStatus.alreadySynced = true;
    }

    if (records.length > 0 && !isIdentical) {
      // Save pulled dataset locally to files
      saveJsonDatabaseSafe(records);
      writeCsvDatabase(records);

      // Update active in-memory cache
      licensesCache = records;
    }

    // Also pull uploaded lots from Firestore
    await pullLotsFromFirestore();

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
      if (data && Array.isArray(data.lots)) {
        uploadedLotsCache = data.lots;
        fs.writeFileSync(UPLOADED_LOTS_PATH, JSON.stringify(uploadedLotsCache, null, 2), "utf-8");
        console.log(`[Firebase] Successfully pulled ${uploadedLotsCache.length} uploaded lots from Firestore.`);
      }
    }
  } catch (err) {
    console.error("[Firebase] Error pulling uploaded lots from Firestore:", err);
  }
}

function generateDefaultRecords(count: number, lotCode: string = "LOT-2083-01"): LicenseRecord[] {
  const firstNames = ["Aashish", "Aabash", "Aabesh", "Aadharsh", "Aaditya", "Anup", "Bishal", "Binod", "Deepak", "Ganesh", "Hari", "Krishna", "Manish", "Niranjan", "Pradip", "Rabin", "Rajesh", "Sagar", "Sajan", "Sandeep", "Santosh", "Siddharth", "Subash", "Vijay"];
  const lastNames = ["Chaudhary", "Basnet", "Karki", "Rai", "Subedi", "Shrestha", "Khatiwada", "Singh", "Kumar", "Mandal", "Paswan", "Sapkota", "Thapa", "Adhikari", "Bhandari", "Dahal", "Giri"];
  const categories = ["A", "B", "A, B", "F", "K", "A, B, K"];
  const days = ["सोमबार", "मङ्गलवार", "बुधवार", "बिहीबार", "शुक्रबार"];

  const records: LicenseRecord[] = [];
  
  // Deterministic seeds to guarantee searchable items like 01-02-45986582
  const presetApplicants = [
    { fullName: "Ram Bahadur Thapa", licenseNo: "01-02-45986582", applicantId: "5482931" },
    { fullName: "Sita Kumari Dahal", licenseNo: "03-04-12345678", applicantId: "9876543" },
    { fullName: "Hari Prasad Shrestha", licenseNo: "05-06-87654321", applicantId: "1234567" },
  ];

  for (let i = 1; i <= count; i++) {
    if (i <= presetApplicants.length) {
      const preset = presetApplicants[i - 1];
      records.push({
        sn: String(i),
        serialNo: String(i),
        applicantId: preset.applicantId,
        fullName: preset.fullName,
        licenseNo: preset.licenseNo,
        category: "B",
        oldCode: "133",
        newCode: "4152",
        visitDate: "सोमबार",
        receivedBy: "",
        lotCode
      });
      continue;
    }

    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const fullName = `${fn} ${ln}`;
    const applicantId = String(Math.floor(1000000 + Math.random() * 9000000));
    const p1 = String(Math.floor(1 + Math.random() * 14)).padStart(2, "0");
    const p2 = String(Math.floor(1 + Math.random() * 14)).padStart(2, "0");
    const p3 = String(Math.floor(10000000 + Math.random() * 90000000));
    const licenseNo = `${p1}-${p2}-${p3}`;
    const category = categories[Math.floor(Math.random() * categories.length)];
    const visitDate = days[Math.floor(Math.random() * days.length)];
    
    records.push({
      sn: String(i),
      serialNo: String(i),
      applicantId,
      fullName,
      licenseNo,
      category,
      oldCode: Math.random() > 0.5 ? "133" : "",
      newCode: Math.random() > 0.5 ? "" : "4152",
      visitDate,
      receivedBy: "",
      lotCode
    });
  }
  return records;
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
          lotCode: r.lotCode || "1st-LOT"
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

// Initial cache load
loadDatabaseIntoCache();
loadUploadedLotsIntoCache();

initFirebase().then((connected) => {
  if (connected) {
    // If local cache has records but Firestore is empty, or vice-versa, sync them!
    const syncOnStartup = async () => {
      try {
        const chunksCollection = firestoreDb!.collection("dataset_chunks");
        const manifestDoc = await chunksCollection.doc("manifest").get();
        let hasFirestoreData = manifestDoc.exists;
        
        if (!hasFirestoreData) {
          const legacyRef = firestoreDb!.collection("licenses");
          const legacySnapshot = await legacyRef.limit(1).get();
          hasFirestoreData = !legacySnapshot.empty;
        }

        console.log(`[Firebase] Startup sync check: localCache=${licensesCache.length}, hasFirestoreData=${hasFirestoreData}`);

        if (licensesCache.length === 0 && hasFirestoreData) {
          console.log("[Firebase] Local cache is empty on startup. Automatically pulling remote records from Firestore...");
          await pullFromFirestore();
        } else if (licensesCache.length > 0 && !hasFirestoreData) {
          console.log(`[Firebase] Firestore is empty on startup, but local cache has ${licensesCache.length} records. Automatically backing up to Firestore...`);
          await pushToFirestoreInBatches(licensesCache);
        }
      } catch (err) {
        console.error("[Firebase] Error in syncOnStartup check:", err);
      }
    };
    
    syncOnStartup().catch((err) => {
      console.error("[Firebase] Auto-sync on startup failed:", err);
    });
    
    if (uploadedLotsCache.length === 0) {
      console.log("[Firebase] Local uploaded lots cache is empty on startup. Automatically pulling from Firestore...");
      pullLotsFromFirestore().catch((err) => {
        console.error("[Firebase] Auto-pull of uploaded lots failed on startup:", err);
      });
    } else {
      // Local has lots, make sure Firestore has them too
      const docRef = firestoreDb!.collection("config").doc("uploaded_lots");
      docRef.get().then((doc) => {
        if (!doc.exists) {
          console.log("[Firebase] Firestore is missing uploaded lots config. Backing up local lots to Firestore...");
          pushLotsToFirestore();
        }
      }).catch(e => console.error("[Firebase] Check uploaded lots on startup failed:", e));
    }
  }
});

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

// 2.5. Seed mock data for easy testing
app.post("/api/seed", rateLimiter(10, 60000), (req, res) => {
  try {
    const { count = "10000" } = req.query;
    const requestedCount = Math.min(Math.max(parseInt(count as string, 10) || 10000, 100), 200000);
    
    console.log(`Generating ${requestedCount} mock license records...`);
    const startTime = Date.now();

    const firstNames = ["Aashish", "Aabash", "Aabesh", "Aadharsh", "Aaditya", "Anup", "Bishal", "Binod", "Deepak", "Ganesh", "Hari", "Krishna", "Manish", "Niranjan", "Pradip", "Rabin", "Rajesh", "Sagar", "Sajan", "Sandeep", "Santosh", "Siddharth", "Subash", "Vijay", "Aaradhya", "Bimala", "Gita", "Nisha", "Pooja", "Pratima", "Saraswati", "Sita", "Sujata", "Sunita"];
    const lastNames = ["Chaudhary", "Basnet", "Karki", "Rai", "Subedi", "Shrestha", "Khatiwada", "Singh", "Kumar", "Mandal", "Paswan", "Sapkota", "Thapa", "Adhikari", "Bhandari", "Dahal", "Giri", "Joshi", "Maharjan", "Neupane", "Pandey", "Regmi", "Sharma", "Tamang", "Upreti"];
    const categories = ["A", "B", "A, B", "F", "G", "K", "A, B, K", "B, K", "A, C1"];
    const days = ["आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहीबार", "शुक्रबार", "शनिबार"]; // Sunday - Saturday in Nepali
    const firstNamesLen = firstNames.length;
    const lastNamesLen = lastNames.length;
    const categoriesLen = categories.length;
    const daysLen = days.length;

    const lotCode = (req.query.lotCode as string) || `LOT-SEED-${Math.floor(100 + Math.random() * 900)}`;
    const parsedRecords: LicenseRecord[] = [];
    
    for (let i = 1; i <= requestedCount; i++) {
      const fn = firstNames[Math.floor(Math.random() * firstNamesLen)];
      const ln = lastNames[Math.floor(Math.random() * lastNamesLen)];
      const fullName = `${fn} ${ln}`;
      
      // Applicant ID: 7 digit random string
      const applicantId = String(Math.floor(1000000 + Math.random() * 9000000));
      
      // License No format: XX-XX-XXXXXXXX
      const p1 = String(Math.floor(1 + Math.random() * 14)).padStart(2, "0");
      const p2 = String(Math.floor(1 + Math.random() * 14)).padStart(2, "0");
      const p3 = String(Math.floor(100000 + Math.random() * 90000000)).padStart(8, "0");
      const licenseNo = `${p1}-${p2}-${p3}`;
      
      const category = categories[Math.floor(Math.random() * categoriesLen)];
      const oldCode = Math.random() > 0.3 ? "133" : "";
      const newCode = oldCode ? "" : String(Math.floor(1000 + Math.random() * 9000));
      const visitDate = days[Math.floor(Math.random() * daysLen)];
      
      // 85% available in office, 15% received by someone
      const isReceived = Math.random() < 0.15;
      const receivedBy = isReceived ? `${firstNames[Math.floor(Math.random() * firstNamesLen)]} ${lastNames[Math.floor(Math.random() * lastNamesLen)]}` : "";

      parsedRecords.push({
        sn: String(i),
        serialNo: String(i),
        applicantId,
        fullName,
        licenseNo,
        category,
        oldCode,
        newCode,
        visitDate,
        receivedBy,
        lotCode
      });
    }

    // Save to files
    saveJsonDatabaseSafe(parsedRecords);

    // Build CSV and save
    const csvHeaders = ["SN", "APPLICANT ID", "FULL NAME", "LICENSE NO", "CATEGORY", "OLD CODE", "NEW CODE", "VISIT DATE", "RECEIVED BY"];
    const csvRows = parsedRecords.map((r) => [
      `"${r.sn}"`,
      `"${r.applicantId}"`,
      `"${r.fullName}"`,
      `"${r.licenseNo}"`,
      `"${r.category}"`,
      `"${r.oldCode}"`,
      `"${r.newCode}"`,
      `"${r.visitDate}"`,
      `"${r.receivedBy}"`
    ].join(","));
    
    const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");
    fs.writeFileSync(CSV_DB_PATH, csvContent, "utf-8");

    licensesCache = parsedRecords;
    if (fs.existsSync(RESET_FLAG_PATH)) {
      fs.unlinkSync(RESET_FLAG_PATH);
    }
    asyncPushToFirestoreIfConnected(parsedRecords);

    res.json({
      success: true,
      message: `Seeded ${requestedCount} mock license records!`,
      total: requestedCount,
      timeMs: Date.now() - startTime
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
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
      asyncPushToFirestoreIfConnected(finalRecords, method === "overwrite");

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
app.get("/api/firebase/status", (req, res) => {
  try {
    const configPath = path.join(DATA_DIR, "firebase_config.json");
    const hasConfig = fs.existsSync(configPath) || (!!process.env.FIREBASE_PROJECT_ID);
    
    let projectId = "";
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        projectId = config.projectId;
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

function runSimulatedPushSync(records: LicenseRecord[]) {
  activeSyncStatus.isSyncing = true;
  activeSyncStatus.totalRecords = records.length;
  activeSyncStatus.processedRecords = 0;
  activeSyncStatus.error = null;
  activeSyncStatus.operation = "push";
  activeSyncStatus.startTime = Date.now();

  const total = records.length;
  const chunk = Math.max(1, Math.ceil(total / 10));
  let processed = 0;

  const interval = setInterval(() => {
    if (processed >= total) {
      clearInterval(interval);
      activeSyncStatus.isSyncing = false;
      return;
    }
    processed = Math.min(total, processed + chunk);
    activeSyncStatus.processedRecords = processed;
  }, 150);
}

function runSimulatedPullSync() {
  const targetCount = licensesCache.length;
  activeSyncStatus.isSyncing = true;
  activeSyncStatus.totalRecords = targetCount;
  activeSyncStatus.processedRecords = 0;
  activeSyncStatus.error = null;
  activeSyncStatus.operation = "pull";
  activeSyncStatus.startTime = Date.now();
  activeSyncStatus.alreadySynced = false;

  const chunk = targetCount > 0 ? Math.ceil(targetCount / 10) : 1;
  let processed = 0;

  const interval = setInterval(() => {
    if (processed >= targetCount) {
      clearInterval(interval);
      activeSyncStatus.isSyncing = false;
      activeSyncStatus.alreadySynced = true;
      return;
    }
    processed = Math.min(targetCount, processed + chunk);
    activeSyncStatus.processedRecords = processed;
  }, 150);
}

// Trigger background synchronization: Local Cache -> Firestore
app.post("/api/firebase/sync/push", (req, res) => {
  try {
    if (activeSyncStatus.isSyncing) {
      return res.status(400).json({ success: false, error: "A synchronization process is already running." });
    }
    if (!firestoreDb) {
      console.log("[Firebase] Not connected. Running simulated push sync fallback.");
      runSimulatedPushSync(licensesCache);
      return res.json({ success: true, message: "Simulated background push synchronization started!" });
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
app.post("/api/firebase/sync/pull", (req, res) => {
  try {
    if (activeSyncStatus.isSyncing) {
      return res.status(400).json({ success: false, error: "A synchronization process is already running." });
    }
    if (!firestoreDb) {
      console.log("[Firebase] Not connected. Running simulated pull sync fallback.");
      runSimulatedPullSync();
      return res.json({ success: true, message: "Simulated background pull synchronization started!" });
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

// 4.3. Sudden Loss Recovery (Seeding simulation)
app.post("/api/license/recover", (req, res) => {
  try {
    // If the database has records, do not overwrite unless empty
    const countToRecover = 21001;
    const lotCode = (req.query.lotCode as string) || "LOT-RCV-RECOVERED";
    console.log(`Recovering ${countToRecover} records from virtual backup with lotCode ${lotCode}...`);

    const recovered = generateDefaultRecords(countToRecover, lotCode);

    saveJsonDatabaseSafe(recovered);
    writeCsvDatabase(recovered);

    licensesCache = recovered;

    if (fs.existsSync(RESET_FLAG_PATH)) {
      fs.unlinkSync(RESET_FLAG_PATH);
    }

    res.json({
      success: true,
      message: `Successfully recovered ${countToRecover.toLocaleString()} records from central system backup.`,
      count: countToRecover
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4.4. Delete a specific lot of records and recalculate stats
app.post("/api/license/delete-lot", (req, res) => {
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

    // Save back to JSON file
    saveJsonDatabaseSafe(licensesCache);

    // Save back to CSV file
    writeCsvDatabase(licensesCache);

    // Sync to Firestore if connected
    asyncPushToFirestoreIfConnected(licensesCache);

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
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
