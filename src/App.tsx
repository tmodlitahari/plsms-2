import React, { useState, useEffect, useRef } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import PublicSearchPortal from "./components/PublicSearchPortal";
import OfficeAdminPanel from "./components/OfficeAdminPanel";

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

interface Stats {
  total: number;
  available: number;
  handedOver: number;
  categories: Record<string, number>;
}

// Dynamic helper to calculate Nepalese Bikram Sambat date and live time in Nepali language
const getNepaliLiveDateTime = () => {
  const now = new Date();
  
  // Day of week in Nepali
  const daysOfWeek = [
    "आइतबार", // Sunday
    "सोमबार", // Monday
    "मङ्गलबार", // Tuesday
    "बुधबार", // Wednesday
    "बिहीबार", // Thursday
    "शुक्रबार", // Friday
    "शनिबार"  // Saturday
  ];
  const dayName = daysOfWeek[now.getDay()];

  // Reference point: July 17, 2026 AD is exactly Shrawan 1, 2083 BS (Friday).
  const refDate = new Date("2026-07-17T00:00:00");
  const msDiff = now.getTime() - refDate.getTime();
  const dayDiff = Math.floor(msDiff / (1000 * 60 * 60 * 24));

  const monthsBS = [
    { name: "वैशाख", days: 31 },
    { name: "जेठ", days: 32 },
    { name: "असार", days: 31 },
    { name: "साउन", days: 32 },
    { name: "भदौ", days: 31 },
    { name: "असोज", days: 31 },
    { name: "कात्तिक", days: 30 },
    { name: "मंसिर", days: 29 },
    { name: "पुस", days: 30 },
    { name: "माघ", days: 29 },
    { name: "फागुन", days: 30 },
    { name: "चैत", days: 30 },
  ];

  let bsYear = 2083;
  let bsMonthIdx = 3; // Saun (Saawan)
  let bsDay = 1 + dayDiff;

  if (bsDay > 0) {
    while (bsDay > monthsBS[bsMonthIdx].days) {
      bsDay -= monthsBS[bsMonthIdx].days;
      bsMonthIdx = (bsMonthIdx + 1) % 12;
      if (bsMonthIdx === 0) bsYear++;
    }
  } else {
    while (bsDay <= 0) {
      bsMonthIdx = (bsMonthIdx - 1 + 12) % 12;
      if (bsMonthIdx === 11) bsYear--;
      bsDay += monthsBS[bsMonthIdx].days;
    }
  }

  const monthName = monthsBS[bsMonthIdx].name;

  const toNepaliDigits = (num: number | string) => {
    const nepaliDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
    return num.toString().split('').map(digit => {
      const d = parseInt(digit);
      return isNaN(d) ? digit : nepaliDigits[d];
    }).join('');
  };

  let hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  
  let timePeriod = "बिहान"; // AM
  if (hours >= 12 && hours < 16) {
    timePeriod = "दिउँसो"; // Afternoon
  } else if (hours >= 16 && hours < 20) {
    timePeriod = "बेलुका"; // Evening
  } else if (hours >= 20 || hours < 5) {
    timePeriod = "राती"; // Night
  }

  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeString = `${toNepaliDigits(pad(hours))}:${toNepaliDigits(pad(minutes))}:${toNepaliDigits(pad(seconds))}`;

  return {
    dateString: `${dayName} ${toNepaliDigits(bsDay)} ${monthName} ${toNepaliDigits(bsYear)}`,
    timeString: `${timeString} ${timePeriod}`,
  };
};

export default function App() {
  // Navigation & Routing state
  const [route, setRoute] = useState<"public" | "admin">(() => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    if (path === "/plsms" || path.endsWith("/plsms") || hash.includes("plsms")) {
      return "admin";
    }
    return "public";
  });

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const targetRoute = (path === "/plsms" || path.endsWith("/plsms") || hash.includes("plsms")) ? "admin" : "public";
      setRoute((prev) => (prev !== targetRoute ? targetRoute : prev));
    };

    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    
    // Check periodically for URL changes (e.g. from history pushState)
    const interval = setInterval(handleLocationChange, 400);

    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
      clearInterval(interval);
    };
  }, []);

  const handleLogout = () => {
    window.history.pushState({}, "", "/");
    setRoute("public");
  };

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [results, setResults] = useState<LicenseRecord[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(1); // Single lookup focused limit
  const [totalInDb, setTotalInDb] = useState(0);

  // Live Nepalese Calendar & Time
  const [nepaliTime, setNepaliTime] = useState(() => getNepaliLiveDateTime());

  // Visitor search counter
  const [visitorCount, setVisitorCount] = useState<number>(() => {
    const cached = localStorage.getItem("nepal_dmv_visitor_count");
    if (cached) {
      const parsed = parseInt(cached);
      return isNaN(parsed) ? 142 : parsed;
    }
    return 142;
  });

  const incrementVisitorCount = () => {
    setVisitorCount((prev) => {
      const next = prev + 1;
      localStorage.setItem("nepal_dmv_visitor_count", next.toString());
      return next;
    });
  };

  // Statistics State
  const [stats, setStats] = useState<Stats | null>(null);

  // Admin upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ 
    success: boolean; 
    message: string; 
    count?: number; 
    fileName?: string; 
    method?: "append" | "overwrite"; 
    lotCode?: string;
    fileType?: string;
    prevRecords?: number;
    recentRecords?: number;
    duplicateFound?: number;
    totalRecordsAfter?: number;
    duplicatesList?: any[];
    alreadySynced?: boolean;
  } | null>(null);
  const [loadMethod, setLoadMethod] = useState<"append" | "overwrite">("append");

  // Drag-and-drop file upload state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Firebase configurations & Sync State
  const [firebaseStatus, setFirebaseStatus] = useState<{
    connected: boolean;
    projectId: string;
    hasConfig: boolean;
    error: string | null;
  } | null>(null);
  
  const [firebaseSyncProgress, setFirebaseSyncProgress] = useState<{
    isSyncing: boolean;
    totalRecords: number;
    processedRecords: number;
    error: string | null;
    operation: "push" | "pull" | "";
    startTime: number;
    alreadySynced?: boolean;
  } | null>(null);

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  
  // Credentials input
  const [fbProjectIdInput, setFbProjectIdInput] = useState("");
  const [fbClientEmailInput, setFbClientEmailInput] = useState("");
  const [fbPrivateKeyInput, setFbPrivateKeyInput] = useState("");
  const [fbError, setFbError] = useState<string | null>(null);
  const [fbSuccessMsg, setFbSuccessMsg] = useState<string | null>(null);

  // Helper for safe JSON fetching
  const safeFetchJson = async (url: string, options?: RequestInit) => {
    const res = await fetch(url, options);
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 100)}`);
    }
    return await res.json();
  };

  // Load stats and database size
  const fetchStats = async () => {
    try {
      const data = await safeFetchJson("/api/stats");
      if (data && data.success && data.stats) {
        setStats(data.stats);
        setTotalInDb(data.stats.total);
      }
    } catch (e) {
      console.warn("Error fetching statistics:", e);
    }
  };

  // Fetch Firebase state
  const fetchFirebaseStatus = async () => {
    try {
      const data = await safeFetchJson("/api/firebase/status");
      if (data && data.success) {
        setFirebaseStatus(data);
        if (data.projectId) {
          setFbProjectIdInput(data.projectId);
        }

        // If server lost config due to container reboot, restore from client localStorage
        if (!data.hasConfig || !data.connected) {
          const savedCreds = localStorage.getItem("nepal_dmv_fb_credentials");
          if (savedCreds) {
            try {
              const { projectId, clientEmail, privateKey } = JSON.parse(savedCreds);
              if (projectId && clientEmail && privateKey) {
                console.log("[Client] Auto-restoring Firebase config to server from localStorage...");
                const configData = await safeFetchJson("/api/firebase/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectId, clientEmail, privateKey }),
                });
                if (configData && configData.success) {
                  setTimeout(() => {
                    fetchFirebaseStatus();
                    fetchFirebaseSyncProgress();
                    fetchStats();
                  }, 800);
                }
              }
            } catch (err) {
              console.error("Error auto-restoring Firebase config:", err);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Error checking Firebase status:", e);
    }
  };

  // Fetch dynamic sync progress
  const fetchFirebaseSyncProgress = async () => {
    try {
      const data = await safeFetchJson("/api/firebase/sync/status");
      if (data && data.success) {
        setFirebaseSyncProgress(data.status);
      }
    } catch (e) {
      console.warn("Error checking sync progress:", e);
    }
  };

  // Configure Firebase Admin parameters
  const handleSaveFirebaseConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setFbError(null);
    setFbSuccessMsg(null);
    setIsSavingConfig(true);

    try {
      const res = await fetch("/api/firebase/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: fbProjectIdInput.trim(),
          clientEmail: fbClientEmailInput.trim(),
          privateKey: fbPrivateKeyInput.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Save credentials in localStorage for automatic recovery if container restarts
        localStorage.setItem("nepal_dmv_fb_credentials", JSON.stringify({
          projectId: fbProjectIdInput.trim(),
          clientEmail: fbClientEmailInput.trim(),
          privateKey: fbPrivateKeyInput.trim(),
        }));
        setFbSuccessMsg("Firebase Central Database successfully configured and connected!");
        fetchFirebaseStatus();
        fetchStats();
        setTimeout(() => {
          setShowConfigModal(false);
          setFbSuccessMsg(null);
        }, 1500);
      } else {
        setFbError(data.error || "Configuration failed. Please check credentials.");
      }
    } catch (err: any) {
      setFbError(err.message || "An error occurred while saving configuration.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Disconnect Firebase configuration
  const handleDisconnectFirebase = async () => {
    if (!window.confirm("Are you sure you want to disconnect the Firebase integration?")) return;
    try {
      const res = await fetch("/api/firebase/disconnect", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        localStorage.removeItem("nepal_dmv_fb_credentials");
        setFbProjectIdInput("");
        setFbClientEmailInput("");
        setFbPrivateKeyInput("");
        fetchFirebaseStatus();
        fetchFirebaseSyncProgress();
        fetchStats();
      }
    } catch (err) {
      console.error("Error disconnecting Firebase:", err);
    }
  };

  // Trigger push sync
  const handleFirebasePushSync = async () => {
    try {
      const res = await fetch("/api/firebase/sync/push", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        fetchFirebaseSyncProgress();
      } else {
        console.error(data.error || "Failed to start synchronization.");
      }
    } catch (err: any) {
      console.error(err.message || "Error running sync push.");
    }
  };

  // Trigger pull sync
  const handleFirebasePullSync = async () => {
    try {
      const res = await fetch("/api/firebase/sync/pull", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        fetchFirebaseSyncProgress();
      } else {
        console.error(data.error || "Failed to start synchronization.");
      }
    } catch (err: any) {
      console.error(err.message || "Error running sync pull.");
    }
  };

  // Initial effect
  useEffect(() => {
    fetchStats();
    fetchFirebaseStatus();
    fetchFirebaseSyncProgress();
  }, []);

  // Update live clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setNepaliTime(getNepaliLiveDateTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Poll for active sync updates
  useEffect(() => {
    let intervalId: any = null;
    if (firebaseSyncProgress?.isSyncing) {
      intervalId = setInterval(() => {
        fetchFirebaseSyncProgress();
        fetchStats();
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [firebaseSyncProgress?.isSyncing]);

  // Form submission handler
  const handleSearchSubmit = (e?: React.FormEvent, overrideQuery?: string) => {
    if (e) e.preventDefault();
    const queryToUse = overrideQuery !== undefined ? overrideQuery.trim() : searchQueryInput.trim();
    if (!queryToUse) return;
    setSearchQuery(queryToUse);
    setPage(1);
  };

  // Reset search state
  const handleReset = () => {
    setSearchQueryInput("");
    setSearchQuery("");
    setResults([]);
    setTotalMatches(0);
    setPage(1);
  };

  // Perform search
  const performSearch = async (query: string, searchPage: number = 1) => {
    if (!query.trim()) {
      setResults([]);
      setTotalMatches(0);
      return;
    }

    setIsSearching(true);
    try {
      const url = `/api/search?q=${encodeURIComponent(query)}&page=${searchPage}&limit=${limit}&exact=true`;
      const data = await safeFetchJson(url);
      if (data && data.success) {
        setResults(data.results);
        setTotalMatches(data.totalMatches);
        setTotalInDb(data.totalInDb);
        if (data.totalMatches > 0) {
          incrementVisitorCount();
        }
      }
    } catch (e) {
      console.error("Error searching:", e);
    } finally {
      setIsSearching(false);
    }
  };

  // Trigger search when searchQuery changes
  useEffect(() => {
    performSearch(searchQuery, page);
  }, [searchQuery, page]);

  // File Upload Helper
  const handleFileUpload = async (file: File) => {
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx" && extension !== "xls") {
      setUploadStatus({
        success: false,
        message: "Only Excel (.xlsx, .xls) and CSV (.csv) files are supported.",
      });
      return;
    }

    setIsUploading(true);
    setUploadStatus(null);

    let lotCode = "3rd-LOT";
    try {
      const cached = localStorage.getItem("nepal_dmv_uploaded_lots");
      const lotsCount = cached ? JSON.parse(cached).length : 2;
      const getOrdinalLotCode = (index: number): string => {
        const s = ["th", "st", "nd", "rd"];
        const v = index % 100;
        const suffix = s[(v - 20) % 10] || s[v] || s[0];
        return `${index}${suffix}-LOT`;
      };
      lotCode = getOrdinalLotCode(lotsCount + 1);
    } catch (e) {}

    try {
      const initialRes = await fetch(`/api/import?filename=${encodeURIComponent(file.name)}&method=${loadMethod}&lotCode=${lotCode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: file,
      });

      const initialRawText = await initialRes.text();
      let initialData: any = null;
      try {
        initialData = initialRawText ? JSON.parse(initialRawText) : null;
      } catch (jsonErr) {
        console.error("[Upload] Failed to parse initial JSON response:", initialRawText.slice(0, 300));
        setUploadStatus({
          success: false,
          message: `सर्भरबाट प्रतिक्रिया प्राप्त भएन (${initialRes.status}): ${initialRawText.slice(0, 150) || "Empty response"}`,
        });
        return;
      }

      if (!initialRes.ok || !initialData || !initialData.success) {
        setUploadStatus({
          success: false,
          message: initialData?.error || initialData?.message || `फाइल अपलोड असफल भयो (${initialRes.status})`,
        });
        return;
      }

      let data = initialData;
      if (initialData.status === "processing" && initialData.jobId) {
        const jobId = initialData.jobId;
        let attempts = 0;
        const maxAttempts = 600; // 10 minutes maximum polling
        while (attempts < maxAttempts) {
          attempts++;
          await new Promise(r => setTimeout(r, 1000));
          try {
            const statusRes = await fetch(`/api/import/status?jobId=${jobId}`);
            const statusRawText = await statusRes.text();
            if (!statusRes.ok) {
              console.warn(`[Import Status] Poll status HTTP ${statusRes.status}, retrying...`);
              continue;
            }
            if (!statusRawText || statusRawText.trim() === "") {
              continue;
            }
            let statusData: any = null;
            try {
              statusData = JSON.parse(statusRawText);
            } catch (err) {
              console.warn("[Import Status] Transient JSON parse error, retrying...", statusRawText.slice(0, 100));
              continue;
            }
            if (statusData?.status === "completed") {
              data = statusData.result || {};
              break;
            } else if (statusData?.status === "failed") {
              setUploadStatus({
                success: false,
                message: statusData.error || "आयात कार्य असफल भयो (Import job failed).",
              });
              return;
            }
          } catch (pollErr: any) {
            console.warn("[Import Status] Network warning during status polling:", pollErr);
          }
        }
      }

      if (data && data.success) {
        if (Array.isArray(data.uploadedLots) && data.uploadedLots.length > 0) {
          try {
            localStorage.setItem("nepal_dmv_uploaded_lots", JSON.stringify(data.uploadedLots));
          } catch (e) {}
        }
        setUploadStatus({
          success: true,
          message: data.alreadySynced
            ? "यो डाटाबेस पहिले नै सिङ्क गरिएको छ (It is already synced !!!)"
            : `Successfully uploaded & parsed ${(data.total || 0).toLocaleString()} records from "${file.name}"!`,
          count: data.total,
          fileName: file.name,
          method: loadMethod,
          lotCode,
          fileType: extension?.toUpperCase(),
          prevRecords: data.prevRecords,
          recentRecords: data.recentRecords,
          duplicateFound: data.duplicateFound,
          totalRecordsAfter: data.totalInDb,
          duplicatesList: data.duplicatesList,
          alreadySynced: !!data.alreadySynced
        });
        fetchStats();
        setSearchQuery("");
        setResults([]);
      } else {
        setUploadStatus({
          success: false,
          message: data?.error || data?.message || "स्प्रेडसिट फाइल पार्स गर्दा त्रुटि देखापर्यो।",
        });
      }
    } catch (e: any) {
      setUploadStatus({
        success: false,
        message: e?.message ? `अपलोड त्रुटि: ${e.message}` : "फाइल अपलोड गर्दा अप्रत्याशित त्रुटि देखापर्यो।",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // File selection change
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Drag-and-drop mechanics
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const triggerFileSelect = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Export helper
  const handleExport = () => {
    window.open("/api/export", "_blank");
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#f4f7fc] font-sans text-slate-900">
      {/* Main Panel Ingress */}
      {route === "public" ? (
        <PublicSearchPortal
          nepaliTime={nepaliTime}
          visitorCount={visitorCount}
          searchQueryInput={searchQueryInput}
          setSearchQueryInput={setSearchQueryInput}
          searchQuery={searchQuery}
          isSearching={isSearching}
          results={results}
          handleSearchSubmit={handleSearchSubmit}
          handleReset={handleReset}
        />
      ) : (
        <OfficeAdminPanel
          nepaliTime={nepaliTime}
          visitorCount={visitorCount}
          stats={stats}
          totalInDb={totalInDb}
          firebaseStatus={firebaseStatus}
          firebaseSyncProgress={firebaseSyncProgress}
          uploadStatus={uploadStatus}
          isDragging={isDragging}
          isUploading={isUploading}
          loadMethod={loadMethod}
          setLoadMethod={setLoadMethod}
          showConfigModal={showConfigModal}
          setShowConfigModal={setShowConfigModal}
          isSavingConfig={isSavingConfig}
          fbProjectIdInput={fbProjectIdInput}
          setFbProjectIdInput={setFbProjectIdInput}
          fbClientEmailInput={fbClientEmailInput}
          setFbClientEmailInput={setFbClientEmailInput}
          fbPrivateKeyInput={fbPrivateKeyInput}
          setFbPrivateKeyInput={setFbPrivateKeyInput}
          fbError={fbError}
          setFbError={setFbError}
          fbSuccessMsg={fbSuccessMsg}
          fileInputRef={fileInputRef}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          triggerFileSelect={triggerFileSelect}
          onFileChange={onFileChange}
          handleFirebasePushSync={handleFirebasePushSync}
          handleFirebasePullSync={handleFirebasePullSync}
          handleDisconnectFirebase={handleDisconnectFirebase}
          handleSaveFirebaseConfig={handleSaveFirebaseConfig}
          handleExport={handleExport}
          fetchStats={fetchStats}
          setUploadStatus={setUploadStatus}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
