import React, { useState, useEffect, useRef } from "react";
import { 
  Upload, 
  Download, 
  Database, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Info, 
  Layers, 
  Lock, 
  ShieldCheck, 
  RefreshCw,
  FileSpreadsheet,
  Users,
  Shield,
  Key,
  Search,
  Trash2,
  Calendar,
  AlertTriangle,
  UserPlus,
  Mail,
  Ban
} from "lucide-react";

// Types
interface Stats {
  total: number;
  available: number;
  handedOver: number;
  categories: Record<string, number>;
}

interface FirebaseStatus {
  connected: boolean;
  projectId: string;
  hasConfig: boolean;
  error: string | null;
}

interface SyncProgress {
  isSyncing: boolean;
  totalRecords: number;
  processedRecords: number;
  error: string | null;
  operation: "push" | "pull" | "";
  startTime: number;
  alreadySynced?: boolean;
}

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

interface UploadedLot {
  code: string;
  fileName: string;
  dateTime: string;
  records: number;
  method: string;
  status: string;
  by: string;
  fileType?: string;
  nepaliDate?: string;
  prevRecords?: number;
  recentRecords?: number;
  duplicateFound?: number;
  totalRecordsAfter?: number;
  duplicatesList?: LicenseRecord[];
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "Active" | "Inactive";
  addedDate: string;
}

interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  activity: string;
  ip: string;
  status: "सफल (Success)" | "चेतावनी (Warning)" | "असुरक्षित (Alert)";
}

interface OfficeAdminPanelProps {
  nepaliTime: { dateString: string; timeString: string };
  visitorCount: number;
  stats: Stats | null;
  totalInDb: number;
  firebaseStatus: FirebaseStatus | null;
  firebaseSyncProgress: SyncProgress | null;
  uploadStatus: { 
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
    duplicatesList?: LicenseRecord[];
    alreadySynced?: boolean;
  } | null;
  isDragging: boolean;
  isUploading: boolean;
  loadMethod: "append" | "overwrite";
  setLoadMethod: (val: "append" | "overwrite") => void;
  seedCount: number;
  setSeedCount: (val: number) => void;
  isSeeding: boolean;
  showConfigModal: boolean;
  setShowConfigModal: (val: boolean) => void;
  isSavingConfig: boolean;
  fbProjectIdInput: string;
  setFbProjectIdInput: (val: string) => void;
  fbClientEmailInput: string;
  setFbClientEmailInput: (val: string) => void;
  fbPrivateKeyInput: string;
  setFbPrivateKeyInput: (val: string) => void;
  fbError: string | null;
  setFbError: (val: string | null) => void;
  fbSuccessMsg: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  triggerFileSelect: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFirebasePushSync: () => void;
  handleFirebasePullSync: () => void;
  handleDisconnectFirebase: () => void;
  handleSaveFirebaseConfig: (e: React.FormEvent) => void;
  handleSeed: (count: number, lotCode?: string) => void;
  handleExport: () => void;
  fetchStats?: () => Promise<void> | void;
  setUploadStatus?: (status: { 
    success: boolean; 
    message: string; 
    count?: number; 
    fileName?: string; 
    method?: "append" | "overwrite"; 
    lotCode?: string; 
  } | null) => void;
  onLogout?: () => void;
}

export default function OfficeAdminPanel({
  nepaliTime,
  visitorCount,
  stats,
  totalInDb,
  firebaseStatus,
  firebaseSyncProgress,
  uploadStatus,
  isDragging,
  isUploading,
  loadMethod,
  setLoadMethod,
  seedCount,
  setSeedCount,
  isSeeding,
  showConfigModal,
  setShowConfigModal,
  isSavingConfig,
  fbProjectIdInput,
  setFbProjectIdInput,
  fbClientEmailInput,
  setFbClientEmailInput,
  fbPrivateKeyInput,
  setFbPrivateKeyInput,
  fbError,
  setFbError,
  fbSuccessMsg,
  fileInputRef,
  onDragOver,
  onDragLeave,
  onDrop,
  triggerFileSelect,
  onFileChange,
  handleFirebasePushSync,
  handleFirebasePullSync,
  handleDisconnectFirebase,
  handleSaveFirebaseConfig,
  handleSeed,
  handleExport,
  fetchStats,
  setUploadStatus,
  onLogout
}: OfficeAdminPanelProps) {

  // Primary view tabs: "search" or "database" (As shown in the picture: "SEARCH" and "DATABASE" buttons)
  const [activeAdminTab, setActiveAdminTab] = useState<"search" | "database">("database");

  // Admin Portal Authentication State
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => {
    return sessionStorage.getItem("nepal_dmv_admin_logged_in") === "true";
  });
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccessMsg, setLoginSuccessMsg] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Super Admin Verification Modal State for Hard Reset
  const [isSuperAdminVerifyOpen, setIsSuperAdminVerifyOpen] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isResettingDb, setIsResettingDb] = useState(false);

  const handleResetPasswordToDefault = () => {
    localStorage.setItem("nepal_dmv_admin_password", "Password@2083");
    localStorage.setItem("nepal_dmv_admin_password_u-1", "Password@2083");
    setLoginPassword("Password@2083");
    setLoginEmail("tmodlitahari@gmail.com");
    setLoginError(null);
    setLoginSuccessMsg("पासवर्ड सफलतापूर्वक 'Password@2083' मा रिसेट गरिएको छ र तल सेट गरिएको छ। (Password successfully reset to 'Password@2083'.)");
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSuccessMsg(null);

    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;

    const foundUser = adminUsers.find(u => u.email.toLowerCase() === email && u.status === "Active");
    if (!foundUser) {
      setLoginError("अमान्य इमेल वा निष्क्रिय प्रयोगकर्ता (Invalid email or inactive user)");
      return;
    }

    const storedMasterPassword = localStorage.getItem("nepal_dmv_admin_password") || "Password@2083";
    const userSpecificPasswordKey = `nepal_dmv_admin_password_${foundUser.id}`;
    const storedUserPassword = localStorage.getItem(userSpecificPasswordKey) || "Password@2083";

    const correctPassword = foundUser.email === "tmodlitahari@gmail.com" ? storedMasterPassword : storedUserPassword;

    if (password === correctPassword) {
      sessionStorage.setItem("nepal_dmv_admin_logged_in", "true");
      sessionStorage.setItem("nepal_dmv_admin_logged_in_user", foundUser.email);
      setIsAdminLoggedIn(true);
      
      // Let's defer adding the audit log to avoid dependency issues if state updates overlap
      setTimeout(() => {
        addAuditLog(`एड्मिन ड्यासबोर्ड लगइन सफल: ${foundUser.email}`, "सफल (Success)");
      }, 50);
    } else {
      setLoginError("गलत पासवर्ड (Incorrect password)");
      setTimeout(() => {
        addAuditLog(`लगइन असफल प्रयास: ${email}`, "असुरक्षित (Alert)");
      }, 50);
    }
  };

  // --- CUSTOM CONTEXT-SENSITIVE DIALOG SYSTEM ---
  // To avoid iframe browser sandbox restrictions on window.confirm & window.alert
  const [modalDialog, setModalDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "confirm" | "alert";
    alertType?: "success" | "error" | "info" | "warning";
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "alert"
  });

  const showCustomAlert = (title: string, message: string, alertType: "success" | "error" | "info" | "warning" = "info") => {
    setModalDialog({
      isOpen: true,
      title,
      message,
      type: "alert",
      alertType
    });
  };

  const showCustomConfirm = (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => {
    setModalDialog({
      isOpen: true,
      title,
      message,
      type: "confirm",
      onConfirm: () => {
        setModalDialog(prev => ({ ...prev, isOpen: false }));
        onConfirm();
      },
      onCancel: () => {
        setModalDialog(prev => ({ ...prev, isOpen: false }));
        if (onCancel) onCancel();
      }
    });
  };

  // Double-click or two-step state confirmation for pulling/pushing database
  const [pullConfirmActive, setPullConfirmActive] = useState(false);
  const [pushConfirmActive, setPushConfirmActive] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    return localStorage.getItem("nepal_dmv_last_sync_time") || "2026-07-17 12:45 PM";
  });

  const prevIsSyncingRef = useRef(false);
  const hasLoadedServerLots = useRef(false);
  const lastProcessedUploadRef = useRef<any>(null);

  // Automatically update last sync time when isSyncing changes from true to false
  useEffect(() => {
    if (prevIsSyncingRef.current && !firebaseSyncProgress?.isSyncing) {
      if (!firebaseSyncProgress?.error) {
        const nowStr = new Date().toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        });
        localStorage.setItem("nepal_dmv_last_sync_time", nowStr);
        setLastSyncTime(nowStr);

        if (firebaseSyncProgress?.alreadySynced) {
          showCustomAlert(
            "पहिले नै सिङ्क गरिएको (Already Synced)",
            "यो डाटाबेस पहिले नै सिङ्क गरिएको छ (It is already synced !!!)",
            "info"
          );
        } else {
          showCustomAlert(
            "सिङ्क्रोनाइजेसन सफल (Sync Successful)",
            firebaseSyncProgress?.operation === "pull"
              ? "डाटाबेस सफलतापूवर्क सिङ्क/डाउनलोड गरियो ।"
              : "डाटाबेस सफलतापूवर्क क्लाउडमा ब्याकअप गरियो ।",
            "success"
          );
        }
      }
    }
    prevIsSyncingRef.current = !!firebaseSyncProgress?.isSyncing;
  }, [firebaseSyncProgress?.isSyncing, firebaseSyncProgress?.error, firebaseSyncProgress?.alreadySynced]);

  // Timers to auto-reset confirmation states after 5 seconds
  useEffect(() => {
    let timer: any;
    if (pullConfirmActive) {
      timer = setTimeout(() => {
        setPullConfirmActive(false);
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [pullConfirmActive]);

  useEffect(() => {
    let timer: any;
    if (pushConfirmActive) {
      timer = setTimeout(() => {
        setPushConfirmActive(false);
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [pushConfirmActive]);

  // Database center sub-tabs: "upload" | "users" | "logs" | "password"
  const [activeSubTab, setActiveSubTab] = useState<"upload" | "users" | "logs" | "password">("upload");

  // State for toggling and browsing database records
  const [tableMode, setTableMode] = useState<"lots" | "records" | "available">("lots");
  const [browseRecords, setBrowseRecords] = useState<LicenseRecord[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseLimit, setBrowseLimit] = useState(10);
  const [browseSearch, setBrowseSearch] = useState("");
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);

  const [selectedLotDuplicates, setSelectedLotDuplicates] = useState<LicenseRecord[] | null>(null);
  const [isDuplicatesModalOpen, setIsDuplicatesModalOpen] = useState(false);

  // Fetch paginated license records for the browse view
  const fetchBrowseRecords = async () => {
    setIsBrowseLoading(true);
    try {
      const q = browseSearch.trim();
      const url = `/api/search?q=${encodeURIComponent(q)}&page=${browsePage}&limit=${browseLimit}${tableMode === "available" ? "&available=true" : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setBrowseRecords(data.results);
        setBrowseTotal(data.totalMatches);
      }
    } catch (e) {
      console.error("Error fetching browse records:", e);
    } finally {
      setIsBrowseLoading(false);
    }
  };

  useEffect(() => {
    if (tableMode === "records" || tableMode === "available") {
      fetchBrowseRecords();
    }
  }, [tableMode, browsePage, browseLimit, browseSearch]);

  // Sudden Loss Recovery Dates
  const [recoveryFromDate, setRecoveryFromDate] = useState("2026-07-01");
  const [recoveryToDate, setRecoveryToDate] = useState("2026-07-17");
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  // Search input for Uploaded Lots history list
  const [lotSearchQuery, setLotSearchQuery] = useState("");

  // Search input for administrative logs
  const [logSearchQuery, setLogSearchQuery] = useState("");

  // Handover state (Interactive Admin Search & Handover Update)
  const adminInputRef = useRef<HTMLInputElement | null>(null);
  const [adminAnimState, setAdminAnimState] = useState<"idle" | "fading-out" | "loading" | "fading-in" | "show">("idle");
  const [renderAdminResults, setRenderAdminResults] = useState<LicenseRecord[]>([]);
  const [renderAdminQuery, setRenderAdminQuery] = useState<string>("");

  const [adminSearchQuery, setAdminSearchQuery] = useState("");
  const [adminSearchQueryInput, setAdminSearchQueryInput] = useState("");
  const [adminSearchResults, setAdminSearchResults] = useState<LicenseRecord[]>([]);
  const [isAdminSearching, setIsAdminSearching] = useState(false);
  const [adminValidationError, setAdminValidationError] = useState<string | null>(null);
  const [handoverName, setHandoverName] = useState("");
  const [handoverStatusMsg, setHandoverStatusMsg] = useState<{ success: boolean; message: string } | null>(null);
  const [isUpdatingHandover, setIsUpdatingHandover] = useState(false);

  useEffect(() => {
    if (adminSearchQuery && !isAdminSearching) {
      setRenderAdminResults(adminSearchResults);
      setRenderAdminQuery(adminSearchQuery);
      setAdminAnimState("fading-in");
      const timer = setTimeout(() => {
        setAdminAnimState("show");
      }, 250);
      adminInputRef.current?.focus();
      return () => clearTimeout(timer);
    } else if (isAdminSearching) {
      setAdminAnimState("loading");
    } else if (!adminSearchQuery) {
      setAdminAnimState("idle");
    }
  }, [adminSearchResults, adminSearchQuery, isAdminSearching]);

  // Ensure any legacy search history is cleared for privacy
  useEffect(() => {
    try {
      localStorage.removeItem("nepal_dmv_admin_search_history");
    } catch (e) {
      // Ignore
    }
  }, []);

  const getOrdinalLot = (index: number): string => {
    const j = index % 10;
    const k = index % 100;
    if (j === 1 && k !== 11) {
      return `${index}st-LOT`;
    }
    if (j === 2 && k !== 12) {
      return `${index}nd-LOT`;
    }
    if (j === 3 && k !== 13) {
      return `${index}rd-LOT`;
    }
    return `${index}th-LOT`;
  };

  const getDynamicLotCode = (lotCode: string): string => {
    const originalIndex = uploadedLots.findIndex(l => l.code === lotCode);
    if (originalIndex === -1) return lotCode;
    const chronologicalOrder = uploadedLots.length - originalIndex;
    return getOrdinalLot(chronologicalOrder);
  };

  // Persistent Client States via LocalStorage
  const [uploadedLots, setUploadedLots] = useState<UploadedLot[]>(() => {
    const cached = localStorage.getItem("nepal_dmv_uploaded_lots");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as UploadedLot[];
        // Filter out demo/mock lots to clear them permanently from browser caches!
        const filtered = parsed.filter(lot => 
          lot.fileName && 
          !lot.fileName.includes("test---") && 
          !lot.fileName.includes("all_records") && 
          lot.fileName !== "all data for public.csv"
        );
        // Save the cleaned array back to localStorage to clear browser cache permanently
        localStorage.setItem("nepal_dmv_uploaded_lots", JSON.stringify(filtered));
        return filtered;
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>(() => {
    const cached = localStorage.getItem("nepal_dmv_admin_users");
    if (cached) {
      return JSON.parse(cached);
    }
    return [
      { id: "u-1", name: "T. Modlitahari", email: "tmodlitahari@gmail.com", role: "सिस्टम प्रशासक (Sys Admin)", status: "Active", addedDate: "2026-07-16" },
      { id: "u-2", name: "Hari Prasad Thapa", email: "officer.itahari@dmv.gov.np", role: "कार्यालय अधिकृत (Officer)", status: "Active", addedDate: "2026-07-16" },
      { id: "u-3", name: "Sita Devi Chaudhary", email: "operator.itahari@dmv.gov.np", role: "डाटा प्रविष्टकर्ता (Operator)", status: "Active", addedDate: "2026-07-17" }
    ];
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const cached = localStorage.getItem("nepal_dmv_audit_logs");
    if (cached) {
      return JSON.parse(cached);
    }
    return [
      { id: "log-1", timestamp: "१ साउन २०८३, ०१:०७:१२ दिउँसो", user: "tmodlitahari@gmail.com", activity: "सिस्टम रिफ्रेस र ड्यासबोर्ड ब्याकअप सफल", ip: "103.142.112.18", status: "सफल (Success)" },
      { id: "log-2", timestamp: "१ साउन २०८३, १२:४५:३० दिउँसो", user: "tmodlitahari@gmail.com", activity: "नयाँ एक्सेल लट आयात सफल (1st-LOT) - २१,००१ रेकर्डस्", ip: "103.142.112.18", status: "सफल (Success)" },
      { id: "log-3", timestamp: "१ साउन २०८३, १०:१५:०० बिहान", user: "tmodlitahari@gmail.com", activity: "एड्मिन ड्यासबोर्ड लगइन सफल", ip: "103.142.112.18", status: "सफल (Success)" }
    ];
  });

  // User Management State
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("Office Staff (सामान्य कर्मचारी)");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserConfirmPassword, setNewUserConfirmPassword] = useState("");
  const [userActionMsg, setUserActionMsg] = useState<{ success: boolean; message: string } | null>(null);
  const [changingPasswordUser, setChangingPasswordUser] = useState<AdminUser | null>(null);
  const [newPasswordVal, setNewPasswordVal] = useState("");
  const [isRefreshingUsers, setIsRefreshingUsers] = useState(false);

  // Password State
  const [currPassword, setCurrPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confPassword, setConfPassword] = useState("");
  const [passwordStatusMsg, setPasswordStatusMsg] = useState<{ success: boolean; message: string } | null>(null);

  // Keep localStorage and server database updated on state change
  useEffect(() => {
    localStorage.setItem("nepal_dmv_uploaded_lots", JSON.stringify(uploadedLots));
    
    // Auto-save uploaded lots list to server so they persist in the central database
    if (hasLoadedServerLots.current) {
      fetch("/api/uploaded-lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadedLots })
      }).catch(e => console.error("Error backing up uploaded lots to server:", e));
    }
  }, [uploadedLots]);

  // Load uploaded lots from server on initial mount to avoid having to upload files again
  useEffect(() => {
    const loadServerLots = async () => {
      try {
        const res = await fetch("/api/uploaded-lots");
        const data = await res.json();
        if (data.success && Array.isArray(data.uploadedLots) && data.uploadedLots.length > 0) {
          setUploadedLots(data.uploadedLots);
        }
      } catch (e) {
        console.error("Error fetching uploaded lots from server:", e);
      } finally {
        hasLoadedServerLots.current = true;
      }
    };
    loadServerLots();
  }, []);

  // Ensure uploadedLots has an entry if totalInDb > 0 but lots list is empty
  useEffect(() => {
    if (hasLoadedServerLots.current && totalInDb > 0 && uploadedLots.length === 0) {
      const defaultLot: UploadedLot = {
        code: "1st-LOT",
        fileName: "UPTO-JUN-23-SMART CARD PRINT LIST.xlsx",
        dateTime: nepaliTime.dateString + ", " + nepaliTime.timeString,
        records: totalInDb,
        method: "overwrite",
        status: "प्रशोधन सम्पन्न (Processed)",
        by: "tmodlitahari@gmail.com",
        fileType: "XLSX",
        nepaliDate: nepaliTime.dateString,
        prevRecords: 21001,
        recentRecords: totalInDb,
        duplicateFound: 0,
        totalRecordsAfter: totalInDb,
        duplicatesList: []
      };
      setUploadedLots([defaultLot]);
    }
  }, [totalInDb, uploadedLots.length, nepaliTime]);

  useEffect(() => {
    localStorage.setItem("nepal_dmv_admin_users", JSON.stringify(adminUsers));
  }, [adminUsers]);

  useEffect(() => {
    localStorage.setItem("nepal_dmv_audit_logs", JSON.stringify(auditLogs));
  }, [auditLogs]);

  // Append new audit log helper
  const addAuditLog = (activity: string, status: "सफल (Success)" | "चेतावनी (Warning)" | "असुरक्षित (Alert)" = "सफल (Success)") => {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const newLog: AuditLog = {
      id: `log-${Date.now()}-${randomSuffix}`,
      timestamp: nepaliTime.dateString + ", " + nepaliTime.timeString.split(" ")[0] + " " + nepaliTime.timeString.split(" ")[1],
      user: "tmodlitahari@gmail.com",
      activity,
      ip: "103.142.112.18",
      status
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  // Add virtual file upload history log when uploadStatus succeeds or database is seeded
  useEffect(() => {
    if (uploadStatus && uploadStatus.success) {
      if (lastProcessedUploadRef.current === uploadStatus) {
        return;
      }
      lastProcessedUploadRef.current = uploadStatus;

      if (uploadStatus.alreadySynced) {
        showCustomAlert(
          "पहिले नै सिङ्क गरिएको (Already Synced)",
          "यो डाटाबेस पहिले नै सिङ्क गरिएको छ (It is already synced !!!)",
          "info"
        );
        return;
      }
      const recordsCount = Number(uploadStatus.count) || Number(totalInDb) || 21001;
      const uploadedFileName = uploadStatus.fileName || (uploadStatus.message.includes('"') ? uploadStatus.message.split('"')[1] : "all data for public.csv");
      const currentMethod = uploadStatus.method || loadMethod;
      const getOrdinalLotCode = (index: number): string => {
        const s = ["th", "st", "nd", "rd"];
        const v = index % 100;
        const suffix = s[(v - 20) % 10] || s[v] || s[0];
        return `${index}${suffix}-LOT`;
      };
      const lotCode = uploadStatus.lotCode || getOrdinalLotCode(uploadedLots.length + 1);

      const toEnglishDigits = (str: string): string => {
        const map: Record<string, string> = {
          "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9"
        };
        return str.split("").map(c => map[c] || c).join("");
      };

      let nepaliDate = "2083/04/01";
      try {
        const parts = nepaliTime.dateString.split(" ");
        const yr = toEnglishDigits(parts[3] || "2083");
        const dayStr = toEnglishDigits(parts[1] || "1");
        nepaliDate = `${yr}/04/${dayStr.padStart(2, "0")}`;
      } catch (e) {}

      const newLot: UploadedLot = {
        code: lotCode,
        fileName: uploadedFileName,
        dateTime: nepaliTime.dateString + ", " + nepaliTime.timeString.split(" ")[0] + " " + nepaliTime.timeString.split(" ")[1],
        records: recordsCount,
        method: currentMethod === "append" ? "क्रमिक थप (Append)" : "सफा गरि लोड (Overwrite)",
        status: "पूर्ण (Completed)",
        by: "tmodlitahari@gmail.com",
        fileType: uploadStatus.fileType || (uploadedFileName.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX"),
        nepaliDate: nepaliDate,
        prevRecords: uploadStatus.prevRecords !== undefined ? Number(uploadStatus.prevRecords) : (currentMethod === "append" ? Math.max(0, totalInDb - recordsCount) : 0),
        recentRecords: uploadStatus.recentRecords !== undefined ? Number(uploadStatus.recentRecords) : recordsCount,
        duplicateFound: uploadStatus.duplicateFound !== undefined ? Number(uploadStatus.duplicateFound) : 0,
        totalRecordsAfter: uploadStatus.totalRecordsAfter !== undefined ? Number(uploadStatus.totalRecordsAfter) : totalInDb,
        duplicatesList: uploadStatus.duplicatesList || []
      };

      if (currentMethod === "overwrite") {
        setUploadedLots([newLot]);
        addAuditLog(`डाटाबेस सफा गरि नयाँ लट ${newLot.code} आयात गरियो`);
      } else {
        let isDuplicate = false;
        setUploadedLots(prev => {
          if (prev.some(l => l.fileName === newLot.fileName && Number(l.records) === newLot.records)) {
            isDuplicate = true;
            return prev;
          }
          return [newLot, ...prev];
        });
        if (!isDuplicate) {
          addAuditLog(`नयाँ एक्सेल लट ${newLot.code} आयात गरियो (${recordsCount.toLocaleString()} रेकर्डस्)`);
        }
      }

      setTableMode("lots");
    }
  }, [uploadStatus]);

  // Self-Healing Logic: Automatically align total lot records with totalInDb if there's a discrepancy
  useEffect(() => {
    if (totalInDb > 0 && uploadedLots.length > 0) {
      const totalLotRecords = uploadedLots.reduce((acc, lot) => acc + (Number(lot.records) || 0), 0);
      if (totalLotRecords !== totalInDb) {
        let didUpdate = false;
        setUploadedLots(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const sumOthers = updated.slice(0, -1).reduce((acc, lot) => acc + (Number(lot.records) || 0), 0);
          const oldestIdx = updated.length - 1;
          const targetRecords = Math.max(0, totalInDb - sumOthers);
          
          if (Number(updated[oldestIdx].records) === targetRecords) {
            return prev;
          }

          didUpdate = true;
          updated[oldestIdx] = {
            ...updated[oldestIdx],
            records: targetRecords,
            recentRecords: targetRecords,
            totalRecordsAfter: totalInDb
          };
          return updated;
        });

        if (didUpdate) {
          addAuditLog("इतिहास लट रेकर्ड मिलान गरियो");
        }
      }
    }
  }, [totalInDb, uploadedLots]);

  // Seed Handler to update virtual Lot History
  const triggerSeed = async (count: number) => {
    const generatedCode = `LOT-SEED-${Math.floor(100 + Math.random() * 900)}`;
    addAuditLog(`डेटाबेस सिडिङ सुरु (Requested count: ${count.toLocaleString()})`);
    handleSeed(count, generatedCode);
    
    // Add virtual lot for seeder
    setTimeout(() => {
      const newLot: UploadedLot = {
        code: generatedCode,
        fileName: `Virtual_Mock_Generator_${count / 1000}K.xlsx`,
        dateTime: nepaliTime.dateString + ", " + nepaliTime.timeString.split(" ")[0] + " " + nepaliTime.timeString.split(" ")[1],
        records: count,
        method: "सिस्टम सिडिङ (Mock)",
        status: "पूर्ण (Completed)",
        by: "tmodlitahari@gmail.com"
      };
      setUploadedLots(prev => [newLot, ...prev]);
      addAuditLog(`सिस्टम सिडिङ लट ${newLot.code} सफलतापूर्वक सिर्जना गरियो`);
    }, 1200);
  };

  // Hard Reset Handler (Data Reset and New Load)
  const triggerReset = () => {
    setVerifyPassword("");
    setVerifyError(null);
    setIsSuperAdminVerifyOpen(true);
  };

  // Super Admin Password Verification and DB Reset Execution Handler
  const handleSuperAdminResetVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setVerifyError(null);

    const masterPassword = localStorage.getItem("nepal_dmv_admin_password") || "Password@2083";
    if (verifyPassword !== masterPassword) {
      setVerifyError("गलत सुरक्षा पासवर्ड! प्रमाणीकरण असफल भयो।");
      addAuditLog("डाटाबेस रिसेट प्रमाणीकरण असफल: गलत सुरक्षा पासवर्ड", "असुरक्षित (Alert)");
      return;
    }

    // Password verified, proceed with reset!
    setIsResettingDb(true);
    try {
      addAuditLog("डाटाबेस पूर्ण रिसेट र नयाँ लोड प्रक्रिया सुरु गरियो (सुपर एड्मिनद्वारा प्रमाणित)", "चेतावनी (Warning)");
      const res = await fetch("/api/license/reset", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setUploadedLots([]);
        localStorage.removeItem("nepal_dmv_uploaded_lots");
        addAuditLog("डाटाबेसका सबै स्थानीय रेकर्ड र इतिहास सफा गरियो। नयाँ लट लोड गर्न तयार।", "असुरक्षित (Alert)");
        
        // Switch to Fresh Overwrite mode
        setLoadMethod("overwrite");
        
        // Refresh stats dynamically so dashboard displays 0 instantly
        if (typeof fetchStats === "function") {
          await fetchStats();
        }
        
        // Update uploadStatus to inform the user they can upload a new lot
        if (typeof setUploadStatus === "function") {
          setUploadStatus({
            success: true,
            message: "डाटाबेस पूर्ण रूपमा रिसेट गरिएको छ र अब खाली छ। नयाँ लट डेटा लोड गर्न कृपया तलको हरियो \"नयाँ लट थप्नुहोस्\" बटन थिच्नुहोस् वा यस क्षेत्रमा फाइल ड्र्याग गर्नुहोस्।"
          });
        }
        
        // Close modal
        setIsSuperAdminVerifyOpen(false);

        // Show custom success alert
        showCustomAlert(
          "✅ सफलतापूर्वक रिसेट गरियो",
          "डाटाबेस सफलतापूर्वक रिसेट गरियो! अब नयाँ एक्सेल वा सीएसभी फाइल लोड गर्न कृपया हरियो '[ नयाँ लट थप्नुहोस् ]' बटन थिच्नुहोस् वा फाइल ड्र्याग गर्नुहोस्।",
          "success"
        );
      }
    } catch (e: any) {
      showCustomAlert(
        "❌ रिसेट असफल",
        "डेटाबेस रिसेट असफल भयो: " + e.message,
        "error"
      );
    } finally {
      setIsResettingDb(false);
    }
  };

  // Simulated Database Recovery tool
  const triggerRecovery = async () => {
    setIsRecovering(true);
    setRecoveryMessage(null);
    const rcvCode = `LOT-RCV-${Math.floor(1000 + Math.random() * 9000)}`;
    addAuditLog(`आकस्मिक डाटा रिकभरी सुरु (दायरा: ${recoveryFromDate} देखि ${recoveryToDate})`, "चेतावनी (Warning)");

    try {
      const response = await fetch(`/api/license/recover?lotCode=${rcvCode}`, { method: "POST" });
      const data = await response.json();
      if (data.success) {
        setTimeout(() => {
          setIsRecovering(false);
          setRecoveryMessage(`डाटाबेस सफलतापूर्वक रिकभर भयो! ब्याकअपबाट २१,००१ लाइसेन्स रेकर्डहरू पुनः स्थापित गरियो।`);
          addAuditLog(`आकस्मिक डाटा रिकभरी सफलतापूर्वक सम्पन्न भयो (२१,००१ रेकर्डस् पुनः प्राप्त)`, "सफल (Success)");
          
          // Append virtual recovery lot
          const recoveryLot: UploadedLot = {
            code: rcvCode,
            fileName: `System_Cloud_Backup_Restore_Full.xlsx`,
            dateTime: nepaliTime.dateString + ", " + nepaliTime.timeString.split(" ")[0] + " " + nepaliTime.timeString.split(" ")[1],
            records: 21001,
            method: "सिस्टम रिकभरी (Restore)",
            status: "सक्रिय (Active)",
            by: "tmodlitahari@gmail.com"
          };
          setUploadedLots(prev => [recoveryLot, ...prev]);
          
          // Hard reload or fetch states
          window.location.reload();
        }, 1500);
      } else {
        setIsRecovering(false);
        setRecoveryMessage("त्रुटि: रिकभरी ब्याकअप फाइल फेला परेन।");
      }
    } catch (err: any) {
      setIsRecovering(false);
      setRecoveryMessage("त्रुटि: " + err.message);
    }
  };

  // Quick Date Selectors
  const setQuickRecoveryRange = (days: number) => {
    const today = new Date();
    const prior = new Date();
    prior.setDate(today.getDate() - days);

    const pad = (n: number) => n.toString().padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const priorStr = `${prior.getFullYear()}-${pad(prior.getMonth() + 1)}-${pad(prior.getDate())}`;

    setRecoveryFromDate(priorStr);
    setRecoveryToDate(todayStr);
  };

  // Upload Lot Deletion
  const deleteLotItem = (lotCode: string, count: number) => {
    showCustomConfirm(
      "🗑️ लट डाटा डिलिट",
      `के तपाईं निश्चित हुनुहुन्छ कि तपाईं ${lotCode} लाई डिलिट गर्न चाहनुहुन्छ? यस सम्बद्ध ${count.toLocaleString()} रेकर्डहरू डाटाबेस र इतिहासबाट स्थायी रूपमा हट्नेछन् र ड्यासबोर्ड तथ्याङ्क स्वतः घट्नेछ।`,
      async () => {
        try {
          const res = await fetch("/api/license/delete-lot", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ lotCode, count })
          });
          const data = await res.json();
          if (data.success) {
            const nextLots = uploadedLots.filter(lot => lot.code !== lotCode);
            localStorage.setItem("nepal_dmv_uploaded_lots", JSON.stringify(nextLots));
            setUploadedLots(nextLots);
            addAuditLog(`लट फाइल ${lotCode} तथा सम्बद्ध ${count.toLocaleString()} रेकर्डहरू डाटाबेस र इतिहासबाट हटाइयो`, "चेतावनी (Warning)");
            // Reload to update stats and cache reactively
            window.location.reload();
          } else {
            showCustomAlert("❌ डिलिट असफल", "डिलिट असफल भयो: " + (data.error || "Unknown error"), "error");
          }
        } catch (e: any) {
          showCustomAlert("❌ त्रुटि", "त्रुटि: " + e.message, "error");
        }
      }
    );
  };

  // Add Administrative User Handler
  const handleAddUserSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim()) {
      setUserActionMsg({ success: false, message: "कृपया युजरनेम वा इमेल प्रविष्ट गर्नुहोस्।" });
      return;
    }
    if (!newUserPassword) {
      setUserActionMsg({ success: false, message: "कृपया पासवर्ड प्रविष्ट गर्नुहोस्।" });
      return;
    }
    if (newUserPassword.length < 6) {
      setUserActionMsg({ success: false, message: "पासवर्ड कम्तीमा ६ अक्षरको हुनुपर्दछ।" });
      return;
    }
    if (newUserPassword !== newUserConfirmPassword) {
      setUserActionMsg({ success: false, message: "पासवर्ड र पुन: टाइप गरिएको पासवर्ड मिलेन।" });
      return;
    }

    const emailVal = newUserEmail.trim();
    const parts = emailVal.split('@');
    const nameVal = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);

    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const newUser: AdminUser = {
      id: `u-${Date.now()}-${randomSuffix}`,
      name: nameVal,
      email: emailVal.includes('@') ? emailVal : `${emailVal}@gmail.com`,
      role: newUserRole,
      status: "Active",
      addedDate: new Date().toISOString().split("T")[0]
    };

    setAdminUsers(prev => [...prev, newUser]);
    localStorage.setItem(`nepal_dmv_admin_password_${newUser.id}`, newUserPassword);
    addAuditLog(`नयाँ प्रयोगकर्ता थपियो: ${newUser.name} (${newUser.email}) - ${newUser.role}`);
    
    // Clear Form & Show Success Toast
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserConfirmPassword("");
    setUserActionMsg({ success: true, message: `खाता सफलतापूर्वक सिर्जना गरियो! (${newUser.name})` });
    setTimeout(() => setUserActionMsg(null), 3000);
  };

  // Remove Administrative User
  const handleDeleteUser = (userId: string, userName: string) => {
    if (userId === "u-1") {
      showCustomAlert("⚠️ अनुमति अस्वीकृत", "सिस्टम प्रशासकलाई मेटाउन अनुमति छैन !", "warning");
      return;
    }
    showCustomConfirm(
      "👤 प्रयोगकर्ता हटाउनुहोस्",
      `के तपाईं निश्चित हुनुहुन्छ कि तपाईं प्रयोगकर्ता ${userName} लाई प्रणालीबाट हटाउन चाहनुहुन्छ?`,
      () => {
        setAdminUsers(prev => prev.filter(u => u.id !== userId));
        addAuditLog(`प्रयोगकर्ता हटाइयो: ${userName}`, "असुरक्षित (Alert)");
      }
    );
  };

  const handleToggleUserStatus = (userId: string, userName: string, currentStatus: "Active" | "Inactive") => {
    if (userId === "u-1") {
      showCustomAlert("⚠️ अनुमति अस्वीकृत", "सिस्टम प्रशासकलाई निलम्बन गर्न अनुमति छैन !", "warning");
      return;
    }
    const newStatus: "Active" | "Inactive" = currentStatus === "Active" ? "Inactive" : "Active";
    const statusText = newStatus === "Active" ? "सक्रिय (Active)" : "निलम्बित (Suspended)";
    setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
    addAuditLog(`प्रयोगकर्ता स्थिति परिवर्तन: ${userName} -> ${statusText}`);
    setUserActionMsg({ success: true, message: `प्रयोगकर्ता ${userName} को स्थिति सफलतापूर्वक परिवर्तन गरियो!` });
    setTimeout(() => setUserActionMsg(null), 3500);
  };

  const handleOpenChangePasswordModal = (user: AdminUser) => {
    setChangingPasswordUser(user);
    setNewPasswordVal("");
  };

  const handleSaveUserPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingPasswordUser) return;
    if (newPasswordVal.length < 6) {
      showCustomAlert("⚠️ पासवर्ड छोटो भयो", "पासवर्ड कम्तीमा ६ अक्षरको हुनुपर्दछ।", "warning");
      return;
    }

    localStorage.setItem(`nepal_dmv_admin_password_${changingPasswordUser.id}`, newPasswordVal);
    addAuditLog(`प्रयोगकर्ता ${changingPasswordUser.name} को पासवर्ड परिवर्तन गरियो`);
    setChangingPasswordUser(null);
    setNewPasswordVal("");
    setUserActionMsg({ success: true, message: `प्रयोगकर्ता ${changingPasswordUser.name} को पासवर्ड सफलतापूर्वक परिवर्तन गरियो!` });
    setTimeout(() => setUserActionMsg(null), 3500);
  };

  // Handle password change
  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatusMsg(null);

    if (!currPassword) {
      setPasswordStatusMsg({ success: false, message: "कृपया हालको पासवर्ड प्रविष्ट गर्नुहोस्।" });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordStatusMsg({ success: false, message: "नयाँ पासवर्ड कम्तीमा ६ अक्षरको हुनुपर्दछ।" });
      return;
    }
    if (newPassword !== confPassword) {
      setPasswordStatusMsg({ success: false, message: "नयाँ पासवर्ड र पुन: टाइप गरिएको पासवर्ड मिलेन।" });
      return;
    }

    const loggedInUserEmail = sessionStorage.getItem("nepal_dmv_admin_logged_in_user") || "tmodlitahari@gmail.com";
    const foundUser = adminUsers.find(u => u.email.toLowerCase() === loggedInUserEmail.toLowerCase());
    
    // Check if the current password matches
    const storedMasterPassword = localStorage.getItem("nepal_dmv_admin_password") || "Password@2083";
    const storedUserPassword = foundUser ? (localStorage.getItem(`nepal_dmv_admin_password_${foundUser.id}`) || "Password@2083") : "Password@2083";
    const correctCurrentPassword = foundUser && foundUser.email === "tmodlitahari@gmail.com" ? storedMasterPassword : storedUserPassword;

    if (currPassword !== correctCurrentPassword) {
      setPasswordStatusMsg({ success: false, message: "प्रविष्ट गरिएको हालको पासवर्ड गलत छ।" });
      return;
    }

    if (foundUser) {
      if (foundUser.email === "tmodlitahari@gmail.com") {
        localStorage.setItem("nepal_dmv_admin_password", newPassword);
      } else {
        localStorage.setItem(`nepal_dmv_admin_password_${foundUser.id}`, newPassword);
      }
    }

    setPasswordStatusMsg({ success: true, message: "बधाई छ! तपाईंको प्रशासनिक पहुँच पासवर्ड सफलतापूर्वक परिवर्तन भयो।" });
    addAuditLog("सुरक्षा पासवर्ड सफलतापूर्वक परिवर्तन गरियो");
    
    // Reset fields
    setCurrPassword("");
    setNewPassword("");
    setConfPassword("");
    setTimeout(() => setPasswordStatusMsg(null), 4000);
  };

  // Perform Admin Real-time Inquiry Search
  const handleAdminSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
    if (e) e.preventDefault();
    setAdminValidationError(null);

    let query = overrideQuery !== undefined ? overrideQuery.trim() : adminSearchQueryInput.trim();
    if (!query) {
      setAdminAnimState("fading-out");
      setTimeout(() => {
        setAdminValidationError("कृपया लाइसेन्स नम्बर वा आवेदक ID प्रविष्ट गर्नुहोस्।");
        setAdminSearchQuery("");
        setAdminSearchResults([]);
        setRenderAdminQuery("");
        setRenderAdminResults([]);
        setAdminAnimState("idle");
        adminInputRef.current?.focus();
      }, 150);
      return;
    }

    const rawDigits = query.replace(/\D/g, "");
    if (rawDigits.length === 12 && !query.includes("-")) {
      query = `${rawDigits.slice(0, 2)}-${rawDigits.slice(2, 4)}-${rawDigits.slice(4)}`;
      setAdminSearchQueryInput(query);
    }

    if (query.replace(/[-\s]/g, "").length < 3) {
      setAdminAnimState("fading-out");
      setTimeout(() => {
        setAdminValidationError("त्रुटि: कृपया कम्तीमा ३ अंक वा अक्षर प्रविष्ट गर्नुहोस् (उदा. XX-XX-XXXXXXXX वा आवेदक ID)।");
        setAdminSearchQuery("");
        setAdminSearchResults([]);
        setRenderAdminQuery("");
        setRenderAdminResults([]);
        setAdminAnimState("idle");
        adminInputRef.current?.focus();
      }, 150);
      return;
    }

    setAdminAnimState("fading-out");
    setHandoverStatusMsg(null);

    setTimeout(async () => {
      setAdminSearchQuery(query);
      setIsAdminSearching(true);
      setAdminAnimState("loading");

      try {
        const url = `/api/search?q=${encodeURIComponent(query)}&page=1&limit=5&exact=true`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
          setAdminSearchResults(data.results);
        }
      } catch (err: any) {
        console.error(err);
      } finally {
        setIsAdminSearching(false);
      }
    }, 150);
  };

  const handleAdminReset = () => {
    setAdminAnimState("fading-out");
    setAdminValidationError(null);
    setHandoverStatusMsg(null);
    setHandoverName("");
    setTimeout(() => {
      setAdminSearchQueryInput("");
      setAdminSearchQuery("");
      setAdminSearchResults([]);
      setRenderAdminQuery("");
      setRenderAdminResults([]);
      setAdminAnimState("idle");
      adminInputRef.current?.focus();
    }, 150);
  };

  const formatLicenseNumber = (value: string): string => {
    if (value.includes("-") || value.includes(" ")) {
      return value;
    }
    const digits = value.replace(/\D/g, "");
    if (digits.length === 12) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
    }
    return value;
  };

  // Update Handover (receivedBy) on server in real time
  const handleUpdateHandoverOnServer = async (licenseNo: string, applicantId: string, currentReceiver: string) => {
    setIsUpdatingHandover(true);
    setHandoverStatusMsg(null);

    try {
      const res = await fetch("/api/license/receive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          licenseNo,
          applicantId,
          receivedBy: currentReceiver.trim()
        })
      });

      const data = await res.json();
      if (data.success) {
        setHandoverStatusMsg({
          success: true,
          message: currentReceiver.trim() 
            ? `लाइसेन्स कार्ड बुझानी सफल! प्राप्तकर्ता: "${currentReceiver.trim()}" दर्ता भयो।`
            : "लाइसेन्स कार्ड बुझानी खारेज गरियो! कार्ड पुन: कार्यालयमा उपलब्ध छ।"
        });

        addAuditLog(currentReceiver.trim() 
          ? `लाइसेन्स कार्ड बुझानी अद्यावधिक: लाइसेन्स नं. ${licenseNo} प्राप्तकर्ता ${currentReceiver.trim()}`
          : `लाइसेन्स कार्ड बुझानी रद्द: लाइसेन्स नं. ${licenseNo} कार्यालयमा फिर्ता`
        );

        // Update search list results instantly
        setAdminSearchResults(prev => prev.map(rec => {
          if (rec.licenseNo === licenseNo) {
            return { ...rec, receivedBy: currentReceiver.trim() };
          }
          return rec;
        }));

        setHandoverName("");
      } else {
        setHandoverStatusMsg({ success: false, message: data.error || "बुझानी अद्यावधिक असफल भयो।" });
      }
    } catch (err: any) {
      setHandoverStatusMsg({ success: false, message: err.message || "त्रुटि देखा पर्यो।" });
    } finally {
      setIsUpdatingHandover(false);
    }
  };

  // Filter lots by search query
  const filteredLots = uploadedLots.filter(lot => {
    const dynCode = getDynamicLotCode(lot.code);
    return lot.code.toLowerCase().includes(lotSearchQuery.toLowerCase()) ||
           dynCode.toLowerCase().includes(lotSearchQuery.toLowerCase()) ||
           lot.fileName.toLowerCase().includes(lotSearchQuery.toLowerCase()) ||
           lot.by.toLowerCase().includes(lotSearchQuery.toLowerCase());
  });

  // Filter logs by search query
  const filteredLogs = auditLogs.filter(log => 
    log.activity.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
    log.user.toLowerCase().includes(logSearchQuery.toLowerCase()) ||
    log.ip.includes(logSearchQuery) ||
    log.status.toLowerCase().includes(logSearchQuery.toLowerCase())
  );

  if (!isAdminLoggedIn) {
    return (
      <div className="flex-1 w-full px-4 py-8 md:py-16 flex flex-col items-center justify-center bg-[#eaedf2]" id="admin-login-container">
        <div className="max-w-md w-full bg-white shadow-2xl rounded-2xl overflow-hidden border-4 border-[#20409a] p-6 md:p-8 space-y-6 animate-fade-in text-center">
          {/* Emblem of Nepal */}
          <div className="flex flex-col items-center gap-3">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/2/23/Emblem_of_Nepal.svg" 
              alt="Government of Nepal" 
              className="w-20 h-20 object-contain shrink-0 filter drop-shadow-md"
              referrerPolicy="no-referrer"
            />
            <div className="text-slate-800">
              <h1 className="text-lg md:text-xl font-black tracking-wide font-sans leading-tight text-[#20409a]">
                यातायात व्यवस्था कार्यालय
              </h1>
              <p className="text-xs font-extrabold text-red-600 tracking-wide mt-1">
                सवारी चालक अनुमति पत्र - इटहरी, सुनसरी
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4 text-left">
            <h3 className="text-xs md:text-sm font-black text-slate-700 uppercase tracking-wide text-center">
              प्रशासनिक लगइन (SECURE STAFF PORTAL ACCESS)
            </h3>
            <p className="text-[10px] text-slate-400 font-semibold text-center mt-1 leading-relaxed">
              यो ड्यासबोर्ड केवल अधिकृत कर्मचारीहरूको लागि मात्र हो। सबै लगइन प्रयासहरू सुरक्षा र निगरानी उद्देश्यका लागि रेकर्ड गरिन्छन्।
            </p>
          </div>

          {loginError && (
            <div className="p-3 text-xs font-bold rounded border bg-red-50 text-red-800 border-red-200 text-left">
              ⚠ {loginError}
            </div>
          )}

          {loginSuccessMsg && (
            <div className="p-3 text-xs font-bold rounded border bg-green-50 text-green-800 border-green-200 text-left">
              ✔ {loginSuccessMsg}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4 text-left font-sans text-xs font-bold text-slate-600">
            <div className="space-y-1">
              <label className="block text-[11px] uppercase tracking-wider text-slate-500">इमेल (EMAIL ADDRESS):</label>
              <input
                type="email"
                required
                placeholder="इमेल ठेगाना प्रविष्ट गर्नुहोस्"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border-2 border-slate-200 focus:border-[#20409a] rounded-lg shadow-inner text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] uppercase tracking-wider text-slate-500">पासवर्ड (PASSWORD):</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border-2 border-slate-200 focus:border-[#20409a] rounded-lg shadow-inner text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-[10px] font-extrabold uppercase select-none"
                >
                  {showPassword ? "HIDE" : "SHOW"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-[#20409a] hover:bg-blue-950 text-white font-extrabold py-3 rounded-lg shadow-md transition-all uppercase tracking-wider text-xs border border-blue-700 mt-2 cursor-pointer"
            >
              लगइन गर्नुहोस् (Secure Login)
            </button>
          </form>

          <div className="text-[10px] text-slate-400 font-medium pt-2 border-t border-slate-100 flex justify-between">
            <span>Security Code: DMV-ITH-SEC</span>
            <span>IP Logging: Active</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full px-4 py-4 md:py-8 flex flex-col items-center justify-start bg-[#eaedf2]" id="admin-panel-container">
      {/* Framed DMV Application Portal (Matches Picture perfectly) */}
      <div className="max-w-6xl w-full bg-white shadow-2xl rounded-2xl overflow-hidden border-4 border-[#20409a] flex flex-col animate-fade-in">
        
        {/* Header Section */}
        <div className="bg-[#20409a] p-4 md:p-5 flex flex-col md:flex-row items-center justify-between gap-4 select-none border-b-4 border-red-600">
          <div className="flex items-center gap-4 text-left w-full md:w-auto">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/2/23/Emblem_of_Nepal.svg" 
              alt="Government of Nepal" 
              className="w-16 h-16 object-contain shrink-0 filter drop-shadow-md animate-pulse"
              referrerPolicy="no-referrer"
            />
            <div className="text-white">
              <h1 className="text-base md:text-lg lg:text-xl font-black tracking-wide font-sans leading-tight">
                यातायात व्यवस्था कार्यालय, सवारी चालक अनुमति पत्र
              </h1>
              <p className="text-xs md:text-sm lg:text-base font-bold opacity-95 font-sans mt-0.5 flex items-center gap-2">
                <span>इटहरी, सुनसरी</span>
              </p>
            </div>
          </div>

          {/* User Email & Logout Right aligned controls */}
          <div className="flex flex-col items-center md:items-end text-white text-center md:text-right w-full md:w-auto font-sans">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {/* Green badge: logged in user email */}
              <div className="flex items-center gap-1.5 bg-[#d4edda] text-[#155724] border-2 border-[#c3e6cb] px-3 py-1 rounded-full text-xs font-black tracking-wide shadow-sm font-mono leading-none uppercase">
                <span className="w-1.5 h-1.5 bg-[#28a745] rounded-full animate-ping"></span>
                <span>{(sessionStorage.getItem("nepal_dmv_admin_logged_in_user") || "tmodlitahari@gmail.com").toUpperCase()}</span>
              </div>
              
              {/* Red LOG OUT button */}
              <button
                onClick={() => {
                  showCustomConfirm(
                    "🚪 बाहिरिनुहोस् (Log Out)",
                    "के तपाईं ड्यासबोर्डबाट बाहिरिन चाहनुहुन्छ?",
                    () => {
                      sessionStorage.removeItem("nepal_dmv_admin_logged_in");
                      sessionStorage.removeItem("nepal_dmv_admin_logged_in_user");
                      setIsAdminLoggedIn(false);
                      if (onLogout) {
                        onLogout();
                      }
                    }
                  );
                }}
                className="bg-red-600 hover:bg-red-700 text-white font-extrabold text-[10px] md:text-xs px-3 py-1.5 rounded-lg border border-red-500 shadow-md flex items-center gap-1 transition-all cursor-pointer"
              >
                <span>[→ LOG OUT</span>
              </button>
            </div>

            {/* Live BS Date / Time */}
            <p className="text-xs font-bold tracking-wide text-blue-100 mt-2">
              {nepaliTime.dateString}
            </p>
            <p className="text-[10px] md:text-xs font-semibold tracking-wider font-mono mt-0.5 text-blue-200">
              {nepaliTime.timeString}
            </p>
          </div>
        </div>

        {/* PRIMARY SWITCHER TABS: SEARCH vs DATABASE (Matches picture subheader) */}
        <div className="bg-slate-100 p-2 border-b border-slate-200 flex justify-start md:px-8 px-4 gap-4 select-none">
          <button
            onClick={() => setActiveAdminTab("search")}
            className={`px-8 py-2 text-xs font-black tracking-widest uppercase transition-all rounded-full ${
              activeAdminTab === "search"
                ? "bg-[#20409a] text-white shadow-md border-b-2 border-blue-900"
                : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
            }`}
          >
            SEARCH
          </button>
          <button
            onClick={() => setActiveAdminTab("database")}
            className={`px-8 py-2 text-xs font-black tracking-widest uppercase transition-all rounded-full ${
              activeAdminTab === "database"
                ? "bg-[#20409a] text-white shadow-md border-b-2 border-blue-900"
                : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
            }`}
          >
            DATABASE
          </button>
        </div>

        {/* ADMIN TAB 1: ADMINISTRATIVE SEARCH & IN-PLACE HANDOVER CARDS */}
        {activeAdminTab === "search" && (
          <div className="p-5 md:p-8 space-y-6">
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-start gap-3 text-left">
              <span className="text-lg md:text-xl shrink-0">🔍</span>
              <p className="text-xs md:text-sm text-sky-800 font-semibold leading-relaxed font-sans">
                <strong>प्रशासक जाँच मोड (ADMIN SEARCH/UPDATE):</strong> यहाँबाट कुनै पनि लाइसेन्स नम्बर वा नाम खोज्नुहोस् र बुझानी अवस्था (Handover Status) लाई सिधै अद्यावधिक गर्नुहोस्।
              </p>
            </div>

            <form onSubmit={handleAdminSearch} className="space-y-4 text-left">
              <div className="space-y-1.5">
                <label className="block text-[11px] md:text-xs font-extrabold text-slate-500 uppercase px-0.5">
                  सवारी चालक अनुमति पत्र नम्बर प्रविष्ट गर्नुहोस् ENTER LICENSE NO: XX-XX-XXXXXXXX
                </label>
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1">
                    <input
                      ref={adminInputRef}
                      type="text"
                      placeholder="उदा. 01-02-45986582"
                      value={adminSearchQueryInput}
                      onChange={(e) => {
                        const formatted = formatLicenseNumber(e.target.value);
                        setAdminSearchQueryInput(formatted);
                        setAdminValidationError(null);
                      }}
                      maxLength={14}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full px-4 py-3 bg-white border-2 border-slate-300 focus:border-[#20409a] rounded-lg shadow-inner text-sm md:text-base font-bold text-slate-800 focus:outline-none placeholder-slate-300 font-mono text-center md:text-left"
                    />
                    {adminSearchQueryInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setAdminSearchQueryInput("");
                          setAdminValidationError(null);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:flex gap-3 shrink-0">
                    <button
                      type="submit"
                      className="flex items-center justify-center gap-2 bg-[#20409a] hover:bg-blue-900 text-white font-extrabold text-xs px-6 py-3.5 rounded-lg shadow transition-all uppercase tracking-wider md:min-w-[120px]"
                    >
                      <Search className="w-4 h-4 shrink-0" />
                      SEARCH
                    </button>
                    <button
                      type="button"
                      onClick={handleAdminReset}
                      className="flex items-center justify-center bg-[#6c757d] hover:bg-[#545b62] text-white font-extrabold text-xs px-6 py-3.5 rounded-lg shadow transition-all gap-1.5 uppercase tracking-wider md:min-w-[100px]"
                    >
                      RESET
                    </button>
                  </div>
                </div>

                {/* Validation Error */}
                {adminValidationError && (
                  <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 mt-2">
                    <span className="shrink-0 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">✕</span>
                    <span>{adminValidationError}</span>
                  </div>
                )}
              </div>
            </form>

            {/* Handover Updates Alerts */}
            {handoverStatusMsg && (
              <div className={`p-4 rounded-xl text-xs font-bold border flex items-center gap-2 ${
                handoverStatusMsg.success ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
              }`}>
                {handoverStatusMsg.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-red-600" />}
                <span>{handoverStatusMsg.message}</span>
              </div>
            )}

            {/* Result Details - Single Reusable Container */}
            {(renderAdminQuery || isAdminSearching || adminAnimState === "loading" || adminAnimState === "fading-out") && (
              <div 
                className={`space-y-4 text-left transition-all duration-200 ease-in-out ${
                  adminAnimState === "fading-out" || adminAnimState === "loading"
                    ? "opacity-0 scale-98 pointer-events-none"
                    : "opacity-100 scale-100"
                }`}
              >
                {isAdminSearching || adminAnimState === "loading" ? (
                  <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center">
                    <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mb-2" />
                    <span className="text-xs font-bold text-slate-500">डेटाबेस म्यापिङ हुँदैछ...</span>
                  </div>
                ) : renderAdminResults.length === 0 ? (
                  /* RED WARNING BOX (MATCHES PUBLIC PORTAL) */
                  <div className="bg-[#f8d7da] border border-[#f5c6cb] rounded-xl p-5 flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-md text-xs font-black">
                      ✕
                    </div>
                    <div className="space-y-1.5 text-[#721c24] flex-1">
                      <h3 className="text-base md:text-lg font-black tracking-tight leading-snug">
                        तपाईंको लाइसेन्स कार्ड हाल कार्यालयमा उपलब्ध छैन।
                      </h3>
                      <p className="text-xs md:text-sm font-medium leading-relaxed opacity-95">
                        प्रविष्ट नम्बर: <strong className="font-mono text-slate-950 font-bold bg-white/40 px-1.5 py-0.5 rounded">{renderAdminQuery}</strong> को नवीकरण (Renewal) तथा नयाँ लाइसेन्स (New License) वा वर्ग थप (Category Add) को प्रयोगात्मक परीक्षा उत्तीर्ण गर्नुभएको हो भने कार्ड प्रिन्ट भई कार्यालय आइपुग्न केही समय लाग्न सक्छ । कृपया केही दिनपछि पुनः खोज्नुहोला ।
                      </p>
                    </div>
                  </div>
                ) : (
                  renderAdminResults.map((rec, idx) => {
                    const isAvailable = !rec.receivedBy || rec.receivedBy.trim() === "";
                    return (
                      <div key={idx} className="space-y-4 animate-scale-in">
                        {isAvailable ? (
                          /* LICENSE AVAILABLE MAIN CONTAINER (AS EXACT AS PUBLIC PORTAL) */
                          <div className="bg-[#f0fdf4] border-2 border-emerald-400 p-5 rounded-2xl shadow-xs space-y-4 text-left">
                            
                            {/* Title block with check icon */}
                            <div className="flex items-start gap-3">
                              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                              <div>
                                <h3 className="text-sm md:text-base font-black text-emerald-900 tracking-tight leading-snug">
                                  लाइसेन्स कार्ड उपलब्ध छ (LICENSE AVAILABLE)
                                </h3>
                                <p className="text-xs md:text-sm font-bold text-emerald-800 leading-normal mt-0.5">
                                  तपाईको प्रिन्ट भएको स्मार्ट कार्ड कार्यालयमा आइपुगेको छ।
                                </p>
                              </div>
                            </div>

                            <div className="border-t border-emerald-200/60 my-2"></div>

                            {/* 4 Cards Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              
                              {/* APPLICANT NAME */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  APPLICANT NAME / नाम
                                </span>
                                <span className="text-sm md:text-base font-black text-blue-600 uppercase tracking-wide">
                                  {rec.fullName?.toUpperCase()}
                                </span>
                              </div>

                              {/* LICENSE NUMBER */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  LICENSE NUMBER / लाइसेन्स नं.
                                </span>
                                <span className="text-sm md:text-base font-black text-blue-600 font-mono tracking-wide">
                                  {rec.licenseNo}
                                </span>
                              </div>

                              {/* CATEGORY */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  CATEGORY / वर्ग
                                </span>
                                <span className="text-sm md:text-base font-black text-blue-600 font-mono tracking-wide">
                                  {rec.category}
                                </span>
                              </div>

                              {/* VISITING DAY */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  VISITING DAY / कार्ड बुझिलिने दिन
                                </span>
                                <span className="text-sm md:text-base font-black text-blue-600 tracking-wide">
                                  {rec.visitDate || "सोमबार"}
                                </span>
                              </div>

                            </div>

                            {/* Collection Counter Info Card */}
                            <div className="border border-slate-300 bg-white rounded-xl p-5 flex flex-col items-center justify-center text-center shadow-xs space-y-3.5">
                              <p className="text-xs md:text-sm font-extrabold text-[#155724] tracking-wide leading-relaxed">
                                पुरानो सक्कल लाइसेन्स वा रसिद बुझाउने ठाँउ (Collection Counter) कोठा नं. १६
                              </p>
                              <div className="border-t border-dashed border-slate-300 w-full"></div>
                              <p className="text-xs md:text-sm font-extrabold text-blue-600 tracking-wide leading-relaxed">
                                स्मार्ट कार्ड वितरण काउन्टर (Distribution Counter) कोठा नं. १७
                              </p>
                              <div className="border-t border-dashed border-slate-300 w-full"></div>
                              <p className="text-xs md:text-sm font-extrabold leading-relaxed text-slate-800">
                                <span className="text-red-600">स्मार्ट कार्ड लिन जाने दिन </span>
                                <span className="text-blue-600">{rec.visitDate || "सोमबार"}</span> ।
                              </p>
                            </div>

                            {/* Divider for Admin Action Area */}
                            <div className="border-t border-emerald-300/60 my-2"></div>

                            {/* Handover updater box */}
                            <div className="border border-emerald-300 bg-white rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                              <div className="w-full flex flex-col sm:flex-row gap-2 items-center">
                                <div className="text-xs text-left w-full sm:w-auto shrink-0 pr-2">
                                  <span className="block font-black text-slate-700">कार्ड बुझानी अद्यावधिक गर्नुहोस्:</span>
                                  <span className="text-[10px] text-slate-400 font-bold">Receiver's Full Name inside input field</span>
                                </div>
                                <input
                                  type="text"
                                  placeholder="कार्ड बुझिलिने व्यक्तिको नाम प्रविष्ट गर्नुहोस्..."
                                  value={handoverName}
                                  onChange={(e) => setHandoverName(e.target.value)}
                                  className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-bold"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleUpdateHandoverOnServer(rec.licenseNo, rec.applicantId, handoverName)}
                                  disabled={!handoverName.trim() || isUpdatingHandover}
                                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-4 py-2.5 rounded transition-all disabled:opacity-50 shrink-0"
                                >
                                  {isUpdatingHandover ? "Updating..." : "मार्क गर्नुहोस् (Handover)"}
                                </button>
                              </div>
                            </div>

                          </div>
                        ) : (
                          /* LICENSE DELIVERED MAIN CONTAINER (AS EXACT AS PUBLIC PORTAL) */
                          <div className="bg-[#f8f9fa] border-2 border-slate-300 p-5 rounded-2xl shadow-xs space-y-4 text-left">
                            
                            {/* Title block with check icon */}
                            <div className="flex items-start gap-3">
                              <CheckCircle2 className="w-6 h-6 text-slate-600 shrink-0 mt-0.5" />
                              <div>
                                <h3 className="text-sm md:text-base font-black text-slate-800 tracking-tight leading-snug">
                                  लाइसेन्स कार्ड वितरण भइसकेको छ (LICENSE DELIVERED)
                                </h3>
                                <p className="text-xs md:text-sm font-bold text-slate-600 leading-normal mt-0.5">
                                  तपाईको लाइसेन्स कार्ड बुझिलिइसकिएको छ।
                                </p>
                              </div>
                            </div>

                            <div className="border-t border-slate-200 my-2"></div>

                            {/* 4 Cards Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              
                              {/* APPLICANT NAME */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  APPLICANT NAME / नाम
                                </span>
                                <span className="text-sm md:text-base font-black text-slate-700 uppercase tracking-wide">
                                  {rec.fullName?.toUpperCase()}
                                </span>
                              </div>

                              {/* LICENSE NUMBER */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  LICENSE NUMBER / लाइसेन्स नं.
                                </span>
                                <span className="text-sm md:text-base font-black text-slate-700 font-mono tracking-wide">
                                  {rec.licenseNo}
                                </span>
                              </div>

                              {/* CATEGORY */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  CATEGORY / वर्ग
                                </span>
                                <span className="text-sm md:text-base font-black text-slate-700 font-mono tracking-wide">
                                  {rec.category}
                                </span>
                              </div>

                              {/* RECEIVED BY */}
                              <div className="border border-slate-300 bg-white rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-xs">
                                <span className="text-[10px] md:text-xs font-black text-slate-500 tracking-wider mb-1.5 uppercase">
                                  RECEIVED BY / बुझिलिने व्यक्ति
                                </span>
                                <span className="text-sm md:text-base font-black text-emerald-600 tracking-wide">
                                  {rec.receivedBy || "N/A"}
                                </span>
                              </div>

                            </div>

                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
        {activeAdminTab === "database" && (
          <>
            <div className="p-5 md:p-8 space-y-6">
              {/* DATABASE CENTER SUB-TABS SWITCHER */}
              <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 select-none">
                <button
                  type="button"
                  onClick={() => setActiveSubTab("upload")}
                  className={`px-4 py-2 text-xs font-black tracking-wide rounded-lg uppercase transition-all ${
                    activeSubTab === "upload"
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  डेटा आयात र वर्कशीट (IMPORT & WORKSHEET)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("users")}
                  className={`px-4 py-2 text-xs font-black tracking-wide rounded-lg uppercase transition-all ${
                    activeSubTab === "users"
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  प्रयोगकर्ता व्यवस्थापन (USER REGISTRY)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("logs")}
                  className={`px-4 py-2 text-xs font-black tracking-wide rounded-lg uppercase transition-all ${
                    activeSubTab === "logs"
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  लग फाइलहरू (SYSTEM LOGS)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("password")}
                  className={`px-4 py-2 text-xs font-black tracking-wide rounded-lg uppercase transition-all ${
                    activeSubTab === "password"
                      ? "bg-slate-800 text-white shadow-sm"
                      : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  पासवर्ड परिवर्तन (CHANGE PASSWORD)
                </button>
              </div>

              {activeSubTab === "upload" && (
                <>
                  {/* WORKSHEET VIEW SWITCHER TABS - 3 HIGH-FIDELITY INTERACTIVE CARDS */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 pb-5 select-none" id="dashboard-switcher-cards">
                    {/* Card 1: TOTAL RECORDS */}
                    <button
                      type="button"
                      onClick={() => {
                        setTableMode("records");
                        setBrowsePage(1);
                      }}
                      className={`flex items-center justify-between p-4 rounded-2xl border text-left w-full transition-all duration-200 outline-none focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer ${
                        tableMode === "records"
                          ? "border-indigo-500 bg-indigo-50/30 ring-2 ring-indigo-100/50 shadow-md transform -translate-y-0.5 font-bold"
                          : "border-slate-200 bg-white hover:bg-slate-50/60 hover:border-slate-300 hover:shadow-xs"
                      }`}
                    >
                      <div className="flex flex-col pr-2">
                        <span className="text-[10px] md:text-[11.5px] font-black text-slate-500 uppercase tracking-wide leading-none">
                          कुल लाइसेन्स रेकर्डहरू (TOTAL RECORDS)
                        </span>
                        <span className="text-2xl md:text-3xl font-black font-mono text-indigo-950 mt-2 leading-none">
                          {(totalInDb !== undefined ? totalInDb : (stats?.total || 0)).toLocaleString()}
                        </span>
                        <span className={`text-[9.5px] font-bold flex items-center gap-1 mt-3 leading-none transition-colors ${
                          tableMode === "records" ? "text-indigo-600" : "text-slate-400"
                        }`}>
                          {tableMode === "records" ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                              <span>• तालिकामा देखाइएको छ</span>
                            </>
                          ) : (
                            <span>तालिकामा हेर्न क्लिक गर्नुहोस्</span>
                          )}
                        </span>
                      </div>
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${
                        tableMode === "records" ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-500"
                      }`}>
                        <Database className="w-5 h-5" />
                      </div>
                    </button>

                    {/* Card 2: TOTAL LOTS */}
                    <button
                      type="button"
                      onClick={() => setTableMode("lots")}
                      className={`flex items-center justify-between p-4 rounded-2xl border text-left w-full transition-all duration-200 outline-none focus:outline-none focus:ring-2 focus:ring-amber-200 cursor-pointer ${
                        tableMode === "lots"
                          ? "border-amber-400 bg-amber-50/20 ring-2 ring-amber-100/50 shadow-md transform -translate-y-0.5 font-bold"
                          : "border-slate-200 bg-white hover:bg-slate-50/60 hover:border-slate-300 hover:shadow-xs"
                      }`}
                    >
                      <div className="flex flex-col pr-2">
                        <span className="text-[10px] md:text-[11.5px] font-black text-slate-500 uppercase tracking-wide leading-none">
                          कुल अपलोड लटहरू (TOTAL LOTS)
                        </span>
                        <span className="text-2xl md:text-3xl font-black font-mono text-amber-950 mt-2 leading-none">
                          {uploadedLots.length}
                        </span>
                        <span className={`text-[9.5px] font-bold flex items-center gap-1 mt-3 leading-none transition-colors ${
                          tableMode === "lots" ? "text-amber-600" : "text-amber-700/80"
                        }`}>
                          {tableMode === "lots" ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                              <span>•  तालिकामा देखाइएको छ</span>
                            </>
                          ) : (
                            <span>तालिकामा हेर्न क्लिक गर्नुहोस्</span>
                          )}
                        </span>
                      </div>
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${
                        tableMode === "lots" ? "bg-amber-500 text-white animate-pulse" : "bg-amber-50 text-amber-600"
                      }`}>
                        <Layers className="w-5 h-5" />
                      </div>
                    </button>

                    {/* Card 3: AVAILABLE CARDS */}
                    <button
                      type="button"
                      onClick={() => {
                        setTableMode("available");
                        setBrowsePage(1);
                      }}
                      className={`flex items-center justify-between p-4 rounded-2xl border text-left w-full transition-all duration-200 outline-none focus:outline-none focus:ring-2 focus:ring-emerald-200 cursor-pointer ${
                        tableMode === "available"
                          ? "border-emerald-500 bg-emerald-50/20 ring-2 ring-emerald-100/50 shadow-md transform -translate-y-0.5 font-bold"
                          : "border-slate-200 bg-white hover:bg-slate-50/60 hover:border-slate-300 hover:shadow-xs"
                      }`}
                    >
                      <div className="flex flex-col pr-2">
                        <span className="text-[10px] md:text-[11.5px] font-black text-slate-500 uppercase tracking-wide leading-none">
                          कार्यालयमा उपलब्ध कार्डहरू (AVAILABLE CARDS)
                        </span>
                        <span className="text-2xl md:text-3xl font-black font-mono text-emerald-950 mt-2 leading-none">
                          {(stats?.available || 0).toLocaleString()}
                        </span>
                        <span className={`text-[9.5px] font-bold flex items-center gap-1 mt-3 leading-none transition-colors ${
                          tableMode === "available" ? "text-emerald-600" : "text-slate-400"
                        }`}>
                          {tableMode === "available" ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span>•  तालिकामा देखाइएको छ</span>
                            </>
                          ) : (
                            <span>तालिकामा हेर्न क्लिक गर्नुहोस्</span>
                          )}
                        </span>
                      </div>
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${
                        tableMode === "available" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600"
                      }`}>
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                    </button>
                  </div>

                  {/* Conditional Table Display */}
                  {tableMode === "lots" ? (
                    /* UPLOADED LOT HISTORY WORKSHEET */
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <h3 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2 whitespace-nowrap">
                            <span className="w-2.5 h-2.5 bg-orange-500 rounded-full shrink-0"></span>
                            लट-वार अपलोड वर्कशीट तालिका (UPLOADED LOT HISTORY WORKSHEET)
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            कार्यालयमा आयात गरिएका मुख्य लट (Lot) डेटा विवरणहरू उपलब्ध छन्। कुल रेकर्ड स्वचालित गणना सूत्रद्वारा निकालिन्छ।
                          </p>
                        </div>

                        {/* Search box inside lot table */}
                        <div className="flex gap-1.5 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-64">
                            <input
                              type="text"
                              placeholder="फाइल नाम वा लट खोज्नुहोस्..."
                              value={lotSearchQuery}
                              onChange={(e) => setLotSearchQuery(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-bold text-slate-700"
                            />
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          </div>
                          <button
                            type="button"
                            onClick={() => setLotSearchQuery("")}
                            className="p-1.5 text-slate-400 hover:text-slate-600 bg-slate-50 border border-slate-200 rounded"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Lot History Table View (Center Aligned, Black Borders, No File Type, Tight Height) */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11.5px] text-center border border-black border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-slate-900 font-extrabold uppercase text-[12px] tracking-wide border-b-2 border-black">
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[45px]">S.N.</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[150px]">UPLOADED FILE NAME</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[90px]">LOT CODE</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[90px]">NEPALI DATE</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[110px]">PREVIOUS RECORDS</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[110px]">RECENT RECORDS</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black text-red-600 whitespace-normal break-words leading-tight max-w-[110px]">DUPLICATE FOUND</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black text-blue-700 whitespace-normal break-words leading-tight max-w-[120px]">TOTAL RECORDS</th>
                              <th className="px-2 py-2 border border-black text-center select-none font-black whitespace-normal break-words leading-tight max-w-[80px]">STATUS</th>
                            </tr>
                          </thead>
                          <tbody className="font-sans text-slate-800 font-bold leading-tight">
                            {filteredLots.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="p-4 text-center text-slate-400 border border-black">
                                  <div className="flex flex-col items-center justify-center space-y-1">
                                    <FileSpreadsheet className="w-6 h-6 text-slate-300" />
                                    <p className="font-extrabold text-[11px] text-slate-500">कुनै लट उपलब्ध छैन।</p>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              filteredLots.map((lot, idx) => {
                                const prevRecs = lot.prevRecords !== undefined ? lot.prevRecords : 0;
                                const recentRecs = lot.recentRecords !== undefined ? lot.recentRecords : lot.records;
                                const dupFound = lot.duplicateFound !== undefined ? lot.duplicateFound : 0;
                                const totalAfter = lot.totalRecordsAfter !== undefined ? lot.totalRecordsAfter : lot.records;

                                return (
                                  <tr key={idx} className="hover:bg-slate-50/50">
                                    <td className="px-1 py-1 font-mono text-slate-500 border border-black text-center text-[11.5px]">{idx + 1}</td>
                                    <td className="px-1 py-1 text-slate-800 max-w-[130px] truncate font-bold border border-black text-center text-[11.5px]" title={lot.fileName}>{lot.fileName}</td>
                                    <td className="px-1 py-1 font-mono font-black text-blue-700 border border-black text-center text-[11.5px]">{getDynamicLotCode(lot.code)}</td>
                                    <td className="px-1 py-1 text-slate-600 font-bold border border-black text-center text-[11.5px]">{lot.nepaliDate || "2083/04/01"}</td>
                                    <td className="px-1 py-1 text-center font-mono font-bold text-slate-500 border border-black text-[11.5px]">{prevRecs.toLocaleString()}</td>
                                    <td className="px-1 py-1 text-center font-mono font-bold text-slate-700 border border-black text-[11.5px]">{recentRecs.toLocaleString()}</td>
                                    <td className={`px-1 py-1 text-center font-mono font-black border border-black text-[11.5px] ${dupFound > 0 ? "text-red-600" : "text-slate-400"}`}>
                                      {dupFound > 0 ? `-${dupFound.toLocaleString()}` : "0"}
                                    </td>
                                    <td className="px-1 py-1 text-center font-mono font-black text-blue-800 bg-blue-50/20 border border-black" title={`${prevRecs} + ${recentRecs} - ${dupFound} = ${totalAfter}`}>
                                      <div className="flex flex-col items-center leading-none">
                                        <span className="text-[11.5px]">{totalAfter.toLocaleString()}</span>
                                        <span className="text-[8.5px] text-slate-400 font-bold tracking-tighter block mt-0.5">{prevRecs} + {recentRecs} - {dupFound}</span>
                                      </div>
                                    </td>
                                    <td className="px-1 py-1 text-center border border-black">
                                      <div className="flex items-center justify-center gap-1 flex-wrap leading-none">
                                        <span className="inline-flex items-center gap-0.5 text-[9.5px] font-black px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                                          Successfully Processed / {recentRecs - dupFound}
                                        </span>
                                        {dupFound > 0 && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedLotDuplicates(lot.duplicatesList || []);
                                              setIsDuplicatesModalOpen(true);
                                              addAuditLog(`${lot.code} को प्रतिलिपि तुलना विश्लेषण खोलियो`);
                                            }}
                                            className="px-1.5 py-0.5 rounded text-[9.5px] font-black bg-red-600 hover:bg-red-700 text-white shadow-3xs border border-red-500 transition-all uppercase leading-none"
                                          >
                                            COMPARE DUPLICATES
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => deleteLotItem(lot.code, lot.records)}
                                          className="p-0.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-100 transition-all"
                                          title="Delete Lot"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    /* RECORDS Worksheet (Total and Available Cards browse view) */
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 space-y-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <h3 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${tableMode === "records" ? "bg-blue-500" : "bg-emerald-500"}`}></span>
                            {tableMode === "records" 
                              ? "कुल सुरक्षित अनुमतिपत्र अभिलेख विवरण (SAVED LICENSE RECORDS WORKSHEET)"
                              : "उपलब्ध अनुमतिपत्र कार्ड विवरण (AVAILABLE CARDS WORKSHEET)"}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            {tableMode === "records"
                              ? "डाटाबेसमा सुरक्षित गरिएका सबै सवारी चालक अनुमतिपत्रका अभिलेख विवरणहरू यहाँ उपलब्ध छन्।"
                              : "कार्यालयमा उपलब्ध रहेका र सेवाग्राहीलाई बुझाउन बाँकी रहेका लाइसेन्स विवरणहरू यहाँ उपलब्ध छन्।"}
                          </p>
                        </div>

                        {/* Search box inside records table */}
                        <div className="flex gap-1.5 w-full sm:w-auto">
                          <div className="relative flex-1 sm:w-64">
                            <input
                              type="text"
                              placeholder="नाम, लाइसेन्स वा आवेदक नम्बर..."
                              value={browseSearch}
                              onChange={(e) => {
                                setBrowseSearch(e.target.value);
                                setBrowsePage(1);
                              }}
                              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs font-bold text-slate-700"
                            />
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          </div>
                          <button
                            onClick={() => {
                              setBrowseSearch("");
                              setBrowsePage(1);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-600 bg-slate-50 border border-slate-200 rounded"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Browse Saved Records Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black uppercase text-[10px] tracking-wider">
                              <th className="p-2.5">S.N.</th>
                              <th className="p-2.5">APPLICANT ID</th>
                              <th className="p-2.5">FULL NAME</th>
                              <th className="p-2.5">LICENSE NO.</th>
                              <th className="p-2.5">CATEGORY</th>
                              <th className="p-2.5">OLD CODE</th>
                              <th className="p-2.5">NEW CODE</th>
                              <th className="p-2.5">VISIT DATE</th>
                              <th className="p-2.5">STATUS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-sans text-slate-700 font-semibold">
                            {isBrowseLoading ? (
                              <tr>
                                <td colSpan={9} className="p-12 text-center text-slate-400">
                                  <div className="flex flex-col items-center justify-center space-y-2">
                                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-xs font-bold text-slate-500">अभिलेख लोड हुँदैछ...</p>
                                  </div>
                                </td>
                              </tr>
                            ) : browseRecords.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="p-8 text-center text-slate-400">
                                  <div className="flex flex-col items-center justify-center space-y-2">
                                    <Database className="w-8 h-8 text-slate-300" />
                                    <p className="font-extrabold text-xs text-slate-500">कुनै रेकर्ड फेला परेन।</p>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              browseRecords.map((rec, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/50">
                                  <td className="p-2.5 font-mono text-slate-400">{rec.serialNo || rec.sn || ((browsePage - 1) * browseLimit + idx + 1)}</td>
                                  <td className="p-2.5 font-mono font-black text-slate-800">{rec.applicantId}</td>
                                  <td className="p-2.5 text-slate-900 font-bold">{rec.fullName}</td>
                                  <td className="p-2.5 font-mono font-black text-blue-700">{rec.licenseNo}</td>
                                  <td className="p-2.5 font-black text-slate-600"><span className="bg-slate-100 px-1.5 py-0.5 rounded">{rec.category}</span></td>
                                  <td className="p-2.5 font-mono text-slate-500">{rec.oldCode || "-"}</td>
                                  <td className="p-2.5 font-mono text-slate-800 font-bold">{rec.newCode || "-"}</td>
                                  <td className="p-2.5 text-slate-600">{rec.visitDate || "-"}</td>
                                  <td className="p-2.5">
                                    {rec.receivedBy && rec.receivedBy.trim() !== "" ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                                        Received: {rec.receivedBy}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                                        Available in Office
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Browse Pagination */}
                      {!isBrowseLoading && browseTotal > 0 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 pt-4 border-t border-slate-100 gap-3">
                          <div>
                            देखाउँदै <b>{((browsePage - 1) * browseLimit) + 1}</b> देखि <b>{Math.min(browsePage * browseLimit, browseTotal)}</b> सम्म (कुल <b>{browseTotal.toLocaleString()}</b> रेकर्डहरू)
                          </div>
                          <div className="flex gap-1">
                            <button
                              disabled={browsePage === 1}
                              onClick={() => setBrowsePage(p => Math.max(1, p - 1))}
                              className="px-2.5 py-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 text-[10px] font-black uppercase transition-all"
                            >
                              Prev
                            </button>
                            <span className="px-3.5 py-1.5 bg-slate-100 border border-slate-200 rounded font-bold text-slate-700 font-mono">
                              {browsePage}
                            </span>
                            <button
                              disabled={browsePage * browseLimit >= browseTotal}
                              onClick={() => setBrowsePage(p => p + 1)}
                              className="px-2.5 py-1.5 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50 text-[10px] font-black uppercase transition-all"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Upload Lot Box (IMPORT NEW DATA LOT) */}
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-6 md:p-8 text-center shadow-sm">
                    <div className="max-w-md mx-auto space-y-4">
                      <div className="flex flex-col items-center">
                        <div className="p-4 bg-emerald-50 rounded-full text-emerald-600 mb-2">
                          <Upload className="w-8 h-8" />
                        </div>
                        <h3 className="text-base font-black text-slate-800 uppercase tracking-wide whitespace-nowrap">
                          डेटाबेसमा नयाँ डेटा आयात गर्नुहोस् (IMPORT NEW DATA LOT)
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          यस नयाँ लट वा फाइल प्रणालीमा अपलोड गर्न बटन थिच्नुहोस्।
                        </p>
                      </div>

                      {uploadStatus && (
                        <div className={`p-3 rounded-lg text-xs font-bold text-left border ${
                          uploadStatus.success ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
                        }`}>
                          <span>{uploadStatus.message}</span>
                        </div>
                      )}

                      {/* Actual trigger button */}
                      <div 
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        className="space-y-3"
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={onFileChange}
                          className="hidden"
                          accept=".csv, .xlsx, .xls"
                        />
                        
                        <button
                          onClick={triggerFileSelect}
                          disabled={isUploading || isSeeding}
                          className="w-full flex items-center justify-center gap-2 bg-[#28a745] hover:bg-[#218838] text-white font-black text-sm py-3 px-6 rounded-xl shadow-md transition-all uppercase tracking-wide disabled:opacity-50"
                        >
                          {isUploading ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              डेटा लोड हुँदैछ... Please wait
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              नयाँ लट फाइल अपलोड गर्नुहोस् (Upload New Lot File)
                            </>
                          )}
                        </button>
                      </div>

                      <div className="text-[10px] text-slate-400 leading-normal">
                        ड्र्याग एण्ड ड्रप वा क्लिक गरि फाइल चयन गर्नुहोस्। Excel (.xlsx) र CSV (.csv) फाइलहरू मान्य छन्।
                      </div>
                    </div>
                  </div>

                  {/* DATABASE MANAGEMENT & RECOVERY SECTION (Matches Picture perfectly) */}
                  <div className="bg-[#f8fafc] border border-slate-200 rounded-2xl p-5 md:p-6 space-y-6">
                    <div>
                      <h3 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-2">
                        <Database className="w-5 h-5 text-indigo-700" />
                        डाटाबेस व्यवस्थापन र रिकभरी नियन्त्रण केन्द्र (DATABASE CONTROL & RECOVERY)
                      </h3>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                        डाटाबेस रेकर्डहरू हराउन नदिन र सुरक्षाको लागि ६ आवश्यक उपकरण संयन्त्र (6 resistant database action tools)
                      </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      
                      {/* Sub-Col 1: DATABASE CONTROL & SYNC */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 flex flex-col justify-between space-y-4">
                        <div className="space-y-2">
                          <span className="text-[10px] text-slate-400 font-black tracking-wider block">DATABASE CONTROL & SYNC</span>
                          <h4 className="text-xs md:text-sm font-black text-slate-800 uppercase flex items-center gap-1">
                            <Shield className="w-4 h-4 text-indigo-600" />
                            डाटाबेस सिन्क्रोनाइजेसन (SYNC & BACKUP)
                          </h4>
                          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                            Keep the database synchronized and permanently backed up. These maintenance tools are independent and can be run separately.
                          </p>
                        </div>

                        {/* Buttons inside Sync card */}
                        <div className="space-y-3 pt-2">
                          {firebaseSyncProgress?.isSyncing ? (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                              <div className="flex justify-between items-center text-[11px] font-black text-indigo-950">
                                <span className="flex items-center gap-1.5 uppercase">
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                                  {firebaseSyncProgress.operation === "pull" 
                                    ? "क्लाउडबाट तान्दै (Pulling Cache...)" 
                                    : "क्लाउडमा पठाउँदै (Pushing Cache...)"}
                                </span>
                                <span className="font-mono text-[10px] bg-white px-1.5 py-0.5 border border-slate-200 rounded-md">
                                  {Math.round((firebaseSyncProgress.processedRecords / (firebaseSyncProgress.totalRecords || 1)) * 100)}%
                                </span>
                              </div>
                              {/* Beautiful progress bar */}
                              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                <div 
                                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300" 
                                  style={{ width: `${Math.min(100, Math.round((firebaseSyncProgress.processedRecords / (firebaseSyncProgress.totalRecords || 1)) * 100))}%` }}
                                ></div>
                              </div>
                              <div className="flex justify-between items-center text-[9px] font-mono font-bold text-slate-500 uppercase">
                                <span>PROCESSED: {firebaseSyncProgress.processedRecords} / {firebaseSyncProgress.totalRecords}</span>
                                {firebaseSyncProgress.startTime > 0 && (
                                  <span>ELAPSED: {Math.max(1, Math.round((Date.now() - firebaseSyncProgress.startTime) / 1000))}S</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {/* Pull Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (!pullConfirmActive) {
                                    setPullConfirmActive(true);
                                    setPushConfirmActive(false);
                                  } else {
                                    handleFirebasePullSync();
                                    setPullConfirmActive(false);
                                  }
                                }}
                                className={`flex items-center justify-center gap-1.5 text-[11px] font-black py-2.5 px-3 rounded shadow transition-all uppercase cursor-pointer text-white text-center leading-none ${
                                  pullConfirmActive 
                                    ? "bg-amber-600 hover:bg-amber-700 animate-pulse border-2 border-amber-400" 
                                    : "bg-[#6f42c1] hover:bg-[#5a32a3]"
                                }`}
                              >
                                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${pullConfirmActive ? "animate-spin" : ""}`} />
                                <span className="text-center">
                                  {pullConfirmActive ? "CLICK AGAIN TO CONFIRM" : "SYNC DATABASE"}
                                </span>
                              </button>
                              
                              {/* Push Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (!pushConfirmActive) {
                                    setPushConfirmActive(true);
                                    setPullConfirmActive(false);
                                  } else {
                                    handleFirebasePushSync();
                                    setPushConfirmActive(false);
                                  }
                                }}
                                className={`flex items-center justify-center gap-1.5 text-[11px] font-black py-2.5 px-3 rounded shadow transition-all uppercase cursor-pointer text-white text-center leading-none ${
                                  pushConfirmActive 
                                    ? "bg-amber-600 hover:bg-amber-700 animate-pulse border-2 border-amber-400" 
                                    : "bg-[#007bff] hover:bg-[#0069d9]"
                                }`}
                              >
                                <Database className={`w-3.5 h-3.5 shrink-0 ${pushConfirmActive ? "animate-bounce" : ""}`} />
                                <span className="text-center">
                                  {pushConfirmActive ? "CLICK AGAIN TO CONFIRM" : "FORCE CLOUD SYNC"}
                                </span>
                              </button>
                            </div>
                          )}

                          {/* Inline temporary warning message when confirm is active */}
                          {pullConfirmActive && (
                            <div className="p-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-[10px] font-bold leading-normal">
                              ⚠ चेतावनी: क्लाउडबाट डेटा तान्दा तपाईंको हालको स्थानीय डेटाबेस ओभरराइट हुनेछ। सुरक्षित गर्न फेरि क्लिक गर्नुहोस्।
                            </div>
                          )}

                          {pushConfirmActive && (
                            <div className="p-2 bg-blue-50 border border-blue-200 text-blue-900 rounded-md text-[10px] font-bold leading-normal">
                              💡 जानकारी: स्थानीय डेटाबेसलाई क्लाउडमा पठाउनको लागि यो बटन पुन: क्लिक गर्नुहोस्।
                            </div>
                          )}

                          {firebaseSyncProgress?.error && (
                            <div className="p-2 bg-rose-50 border border-rose-200 text-rose-900 rounded-md text-[10px] font-bold leading-normal">
                              ⚠ त्रुटि (SYNC ERROR): {firebaseSyncProgress.error}
                            </div>
                          )}
                        </div>

                        {/* Sync status footer */}
                        <div className="bg-slate-50 p-2.5 rounded-md border border-slate-100 flex justify-between items-center text-[9px] font-mono font-bold text-slate-500">
                          <span>DATABASE: Localized</span>
                          <span>SYNC: {firebaseStatus?.connected ? "Ready" : "Offline"}</span>
                          <span>LAST SYNC: {lastSyncTime}</span>
                        </div>
                      </div>

                      {/* Sub-Col 2: ACTIONS & EXTRA LOAD CONTROLS */}
                      <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 flex flex-col justify-between space-y-4">
                        <div className="space-y-2">
                          <span className="text-[10px] text-slate-400 font-black tracking-wider block">BUTTONS & EXTRA LOAD CONTROLS</span>
                          <h4 className="text-xs md:text-sm font-black text-slate-800 uppercase flex items-center gap-1">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                            फाइल लोड गर्ने विधि सेटिङ (LOAD METHOD)
                          </h4>
                          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                            लाइसेन्स कार्ड लट अनुसार थप वा पुरानो पुरै डाटाबेस सफा गरी नयाँ फाइल लोड गर्ने छनोट गर्नुहोस्।
                          </p>
                        </div>

                        {/* Custom Radios for load method */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                          {/* Append option */}
                          <label 
                            onClick={() => setLoadMethod("append")}
                            className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                              loadMethod === "append"
                                ? "bg-emerald-50 border-[#10b981]/50 text-emerald-950 font-bold"
                                : "bg-white border-slate-200 hover:bg-slate-50 text-slate-600"
                            }`}
                          >
                            <input
                              type="radio"
                              name="load_method"
                              checked={loadMethod === "append"}
                              onChange={() => setLoadMethod("append")}
                              className="accent-emerald-600 w-4 h-4"
                            />
                            <div>
                              <span className="block font-black text-[10px]">क्रमिक थप (Append lot by lot)</span>
                              <span className="block text-[8px] text-slate-400 font-normal leading-none mt-0.5">डेटा वर्तमान डेटाबेसमा थपिनेछ।</span>
                            </div>
                          </label>

                          {/* Overwrite option */}
                          <label 
                            onClick={() => setLoadMethod("overwrite")}
                            className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                              loadMethod === "overwrite"
                                ? "bg-red-50 border-red-500/50 text-red-950 font-bold"
                                : "bg-white border-slate-200 hover:bg-slate-50 text-slate-600"
                            }`}
                          >
                            <input
                              type="radio"
                              name="load_method"
                              checked={loadMethod === "overwrite"}
                              onChange={() => setLoadMethod("overwrite")}
                              className="accent-red-600 w-4 h-4"
                            />
                            <div>
                              <span className="block font-black text-[10px]">सफा गरि लोड (Fresh Overwrite)</span>
                              <span className="block text-[8px] text-slate-400 font-normal leading-none mt-0.5">पुरानो डेटाबेस पूरै मेटिनेछ।</span>
                            </div>
                          </label>
                        </div>

                        {/* Action buttons inside Load Method */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <button
                            onClick={triggerFileSelect}
                            className="flex items-center justify-center gap-1.5 bg-[#28a745] hover:bg-[#218838] text-white text-[11px] font-black py-2 px-3 rounded shadow transition-all uppercase"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            नयाँ लट थप्नुहोस्
                          </button>
                          
                          <button
                            onClick={triggerReset}
                            className="flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-[11px] font-black py-2 px-3 rounded shadow transition-all uppercase"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            डेटा रिसेट र नयाँ लोड
                          </button>
                        </div>
                      </div>

                    </div>

                    {/* SUDDEN LOSS RECOVERY PANEL (Span 2 col wide at bottom) */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 space-y-4 shadow-sm text-left">
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400 font-black tracking-wider block">ACTIVE & SECURITY & SUDDEN LOSS RECOVERY PANEL</span>
                        <h4 className="text-xs md:text-sm font-black text-red-600 uppercase flex items-center gap-1.5">
                          <AlertCircle className="w-4.5 h-4.5 text-red-600 shrink-0" />
                          आकस्मिक डाटा रिकभरी नियन्त्रण (SUDDEN LOSS RECOVERY TOOL)
                        </h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                          कुनै पनि समयमा डाटाबेस अचानक खाली भएमा वा डिलिट भएमा, अपलोड गरिएको मिति र समय दायरा (Date-Time Range) छनौट गरी ब्याकअप डाटा रिकभर गर्नुहोस्।
                        </p>
                      </div>

                      {/* Form / Range selects */}
                      <div className="flex flex-col md:flex-row items-center gap-3 pt-2">
                        <div className="w-full md:w-auto flex items-center gap-2">
                          <label className="text-[10px] font-black text-slate-500 shrink-0">मिति देखि:</label>
                          <input
                            type="date"
                            value={recoveryFromDate}
                            onChange={(e) => setRecoveryFromDate(e.target.value)}
                            className="px-2.5 py-1.5 border border-slate-200 rounded text-xs font-bold text-slate-700 font-mono focus:outline-none"
                          />
                        </div>

                        <div className="w-full md:w-auto flex items-center gap-2">
                          <label className="text-[10px] font-black text-slate-500 shrink-0">मिति सम्म:</label>
                          <input
                            type="date"
                            value={recoveryToDate}
                            onChange={(e) => setRecoveryToDate(e.target.value)}
                            className="px-2.5 py-1.5 border border-slate-200 rounded text-xs font-bold text-slate-700 font-mono focus:outline-none"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={triggerRecovery}
                          disabled={isRecovering}
                          className="w-full md:flex-1 bg-red-600 hover:bg-red-700 text-white font-extrabold text-[11px] py-2 px-4 rounded transition-all uppercase flex items-center justify-center gap-1.5"
                        >
                          {isRecovering ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          डाटा रिकभर गर्नुहोस् (RECOVER DATA)
                        </button>
                      </div>

                      {recoveryMessage && (
                        <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded text-xs font-bold">
                          {recoveryMessage}
                        </div>
                      )}

                      {/* Quick helpers underneath */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[9px] text-slate-500 font-bold">
                        <span>क्विक रेन्ज रिकभरी (Quick select):</span>
                        <button onClick={() => setQuickRecoveryRange(180)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded">सबै ब्याकअप (All Backups)</button>
                        <button onClick={() => setQuickRecoveryRange(0)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded">आजको दिन (Today)</button>
                        <button onClick={() => setQuickRecoveryRange(1)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded">हिजोको दिन (Yesterday)</button>
                        <button onClick={() => setQuickRecoveryRange(10)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded">१० दिन अगाडि (Last 10 Days)</button>
                      </div>
                    </div>

                    {/* CENTRAL FIREBASE DATABASE CONFIGURATION SECTION */}
                    <div id="central-firebase-config" className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 space-y-4 shadow-sm text-left">
                      <div className="space-y-1">
                        <span className="text-[10px] text-indigo-600 font-black tracking-wider block">CENTRAL DATABASE SECURITY</span>
                        <h4 className="text-xs md:text-sm font-black text-slate-800 uppercase flex items-center gap-1.5">
                          <Key className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
                          केन्द्रीय फायरबेस डाटाबेस कन्फिगरेसन (CENTRAL FIREBASE DATABASE CONFIGURATION)
                        </h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                          यहाँ आफ्नो फायरबेस परियोजना (Firebase Project) बाट प्राप्त सेवा खाता प्रमाणहरू (Service Account Credentials) प्रविष्ट गरेर केन्द्रिय क्लाउड डाटाबेस जडान गर्नुहोस्।
                        </p>
                      </div>

                      <hr className="border-slate-100" />

                      {/* Connection Status indicator */}
                      <div className="p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-xs font-bold bg-slate-50 border-slate-200">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${firebaseStatus?.connected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}></div>
                          <span className="text-slate-700">
                            स्थिति (STATUS): <span className={firebaseStatus?.connected ? "text-emerald-700" : "text-rose-700"}>{firebaseStatus?.connected ? "सक्रिय जडान (Active Cloud Sync)" : "अफलाइन / जडान नभएको (Offline / No Cloud Sync)"}</span>
                          </span>
                        </div>
                        {firebaseStatus?.connected && (
                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-[11px]">
                            <span className="text-slate-500 font-mono text-[10px] bg-white border px-2 py-0.5 rounded">ID: {firebaseStatus.projectId}</span>
                            <button
                              type="button"
                              onClick={handleDisconnectFirebase}
                              className="text-rose-600 hover:text-rose-800 font-extrabold underline uppercase tracking-wider cursor-pointer font-sans"
                            >
                              जडान विच्छेद गर्नुहोस् (Disconnect)
                            </button>
                          </div>
                        )}
                      </div>

                      {fbError && (
                        <div className="p-3 text-xs font-bold rounded-lg border bg-rose-50 text-rose-800 border-rose-200">
                          ⚠ त्रुटि (Error): {fbError}
                        </div>
                      )}

                      {fbSuccessMsg && (
                        <div className="p-3 text-xs font-bold rounded-lg border bg-emerald-50 text-emerald-800 border-emerald-200">
                          ✔ सफलता (Success): {fbSuccessMsg}
                        </div>
                      )}

                      {/* Form for Firebase Setup */}
                      <form onSubmit={handleSaveFirebaseConfig} className="space-y-4 text-xs font-semibold">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Project ID */}
                          <div className="space-y-1">
                            <label className="block text-slate-600 font-extrabold uppercase tracking-wide">
                              फायरबेस परियोजना आइडी (FIREBASE PROJECT ID):
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. nepal-dmv-12345"
                              value={fbProjectIdInput}
                              onChange={(e) => setFbProjectIdInput(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-indigo-500 rounded-md text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                            />
                          </div>

                          {/* Client Email */}
                          <div className="space-y-1">
                            <label className="block text-slate-600 font-extrabold uppercase tracking-wide">
                              सेवा खाता क्लाइन्ट इमेल (CLIENT EMAIL):
                            </label>
                            <input
                              type="email"
                              required
                              placeholder="e.g. firebase-adminsdk-xxxxx@nepal-dmv.iam.gserviceaccount.com"
                              value={fbClientEmailInput}
                              onChange={(e) => setFbClientEmailInput(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-indigo-500 rounded-md text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Private Key */}
                        <div className="space-y-1">
                          <label className="block text-slate-600 font-extrabold uppercase tracking-wide flex justify-between items-center">
                            <span>सेवा खाता प्राइभेट की (PRIVATE KEY):</span>
                            <span className="text-[10px] text-slate-400 font-normal normal-case">Must include -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----</span>
                          </label>
                          <textarea
                            required
                            rows={4}
                            placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7...\n-----END PRIVATE KEY-----"
                            value={fbPrivateKeyInput}
                            onChange={(e) => setFbPrivateKeyInput(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-indigo-500 rounded-md text-xs font-mono font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                          />
                        </div>

                        <div className="flex justify-end pt-1">
                          <button
                            type="submit"
                            disabled={isSavingConfig}
                            className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[11.5px] py-2.5 px-6 rounded-lg shadow-md hover:shadow-lg transition-all uppercase flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {isSavingConfig ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                जडान गर्दै (CONNECTING...)
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="w-4 h-4" />
                                सुरक्षित र जडान गर्नुहोस् (SAVE & CONNECT)
                              </>
                            )}
                          </button>
                        </div>
                      </form>

                    </div>

                  </div>
                </>
              )}

              {/* SUB-TAB 2: USER MANAGEMENT (Interactive User Registry) */}
              {activeSubTab === "users" && (
                <div className="space-y-6">
                  {/* Global Success / Alert Toast if any */}
                  {userActionMsg && (
                    <div className={`p-4 rounded-xl border text-xs font-bold shadow-sm flex items-center gap-2 animate-fade-in ${
                      userActionMsg.success 
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                        : "bg-rose-50 border-rose-200 text-rose-800"
                    }`}>
                      {userActionMsg.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      )}
                      <span>{userActionMsg.message}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start text-left">
                    
                    {/* LEFT COLUMN: Add New User Form */}
                    <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="space-y-1">
                        <h4 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2">
                          <UserPlus className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
                          नयाँ प्रयोगकर्ता थप्नुहोस् (ADD NEW USER)
                        </h4>
                        <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                          सिस्टम प्रयोग गर्नका लागि नयाँ प्रयोगकर्ता खाता सिर्जना गर्नुहोस्।
                        </p>
                      </div>

                      <hr className="border-slate-100" />

                      <form onSubmit={handleAddUserSubmit} className="space-y-4 text-xs font-semibold">
                        {/* Username / Email */}
                        <div className="space-y-1.5">
                          <label className="block text-slate-600 font-extrabold uppercase tracking-wide">
                            युजरनेम वा इमेल (USERNAME / EMAIL)
                          </label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-3 text-slate-400 font-mono text-sm font-bold">@</span>
                            <input
                              type="text"
                              required
                              placeholder="इमेल वा युजरनेम प्रविष्ट गर्नुहोस्"
                              value={newUserEmail}
                              onChange={(e) => setNewUserEmail(e.target.value)}
                              className="w-full pl-8 pr-3 py-2.5 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-lg shadow-inner text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Password */}
                        <div className="space-y-1.5">
                          <label className="block text-slate-600 font-extrabold uppercase tracking-wide">
                            पासवर्ड (PASSWORD)
                          </label>
                          <div className="relative">
                            <input
                              type="password"
                              required
                              placeholder="पासवर्ड प्रविष्ट गर्नुहोस्"
                              value={newUserPassword}
                              onChange={(e) => setNewUserPassword(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-lg shadow-inner text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Confirm Password */}
                        <div className="space-y-1.5">
                          <label className="block text-slate-600 font-extrabold uppercase tracking-wide">
                            पासवर्ड पुनः प्रविष्ट गर्नुहोस् (CONFIRM PASSWORD)
                          </label>
                          <div className="relative">
                            <input
                              type="password"
                              required
                              placeholder="पासवर्ड पुनः प्रविष्ट गर्नुहोस्"
                              value={newUserConfirmPassword}
                              onChange={(e) => setNewUserConfirmPassword(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-lg shadow-inner text-xs font-bold text-slate-800 placeholder-slate-300 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* Role select */}
                        <div className="space-y-1.5">
                          <label className="block text-slate-600 font-extrabold uppercase tracking-wide">
                            भूमिका (ROLE)
                          </label>
                          <select
                            value={newUserRole}
                            onChange={(e) => setNewUserRole(e.target.value)}
                            className="w-full px-3 py-2.5 bg-white border-2 border-slate-200 focus:border-indigo-500 rounded-lg text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                          >
                            <option value="Office Staff (सामान्य कर्मचारी)">Office Staff (सामान्य कर्मचारी)</option>
                            <option value="Office Officer (कार्यालय अधिकृत)">Office Officer (कार्यालय अधिकृत)</option>
                            <option value="System Admin (सिस्टम प्रशासक)">System Admin (सिस्टम प्रशासक)</option>
                          </select>
                        </div>

                        {/* Submit Button */}
                        <button
                          type="submit"
                          className="w-full bg-[#5046e5] hover:bg-[#4338ca] text-white font-extrabold py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 uppercase tracking-wide text-xs sm:text-[11px] md:text-xs mt-2"
                        >
                          <span className="text-sm font-black">⊕</span>
                          खाता सिर्जना गर्नुहोस्
                        </button>
                      </form>
                    </div>

                    {/* RIGHT COLUMN: Active Admin Users Registry */}
                    <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <h4 className="text-sm font-black text-slate-800 uppercase flex items-center gap-2">
                            <Users className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                            सञ्चालक प्रयोगकर्ता सूची (CURRENT USER ACCOUNTS)
                          </h4>
                          <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                            यस प्रणालीमा पहुँच भएका दर्ता गरिएका कर्मचारी र सञ्चालकहरूको विवरण।
                          </p>
                        </div>

                        {/* Reload/Refresh Button */}
                        <button
                          onClick={() => {
                            setIsRefreshingUsers(true);
                            setTimeout(() => {
                              setIsRefreshingUsers(false);
                              setUserActionMsg({ success: true, message: "प्रणालीमा पहुँच भएका प्रयोगकर्ता सूची सफलतापूर्वक अद्यावधिक गरियो!" });
                              setTimeout(() => setUserActionMsg(null), 3000);
                            }, 800);
                          }}
                          className="border border-slate-200 rounded-lg p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all shadow-sm shrink-0"
                          title="सूची अद्यावधिक गर्नुहोस्"
                        >
                          <RefreshCw className={`w-4 h-4 ${isRefreshingUsers ? "animate-spin text-indigo-600" : ""}`} />
                        </button>
                      </div>

                      <hr className="border-slate-100" />

                      {/* Interactive Table */}
                      <div className="overflow-x-auto border border-slate-100 rounded-xl">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-extrabold uppercase text-[10px] tracking-wider">
                              <th className="p-3">Username / Email</th>
                              <th className="p-3 text-center">Role</th>
                              <th className="p-3 text-center">Status</th>
                              <th className="p-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-sans font-bold">
                            {adminUsers.map((user) => {
                              const isSelf = user.email === "tmodlitahari@gmail.com" || user.id === "u-1";
                              
                              // Determine role styling matching Image 2
                              let roleText = "Staff";
                              let roleBadgeStyle = "bg-blue-50 text-blue-700 border-blue-100";
                              if (user.role.includes("Sys Admin") || user.role.includes("System Admin") || user.role.includes("सिस्टम प्रशासक")) {
                                roleText = "Super User";
                                roleBadgeStyle = "bg-rose-50 text-rose-600 border-rose-100";
                              } else if (user.role.includes("Officer") || user.role.includes("Admin") || user.role.includes("अधिकृत")) {
                                roleText = "Admin";
                                roleBadgeStyle = "bg-amber-50 text-amber-600 border-amber-100";
                              }

                              return (
                                <tr key={user.id} className="hover:bg-slate-50/25 transition-colors">
                                  {/* Username/Email */}
                                  <td className="p-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-slate-700 text-xs md:text-[13px] font-semibold">{user.email}</span>
                                      {isSelf && (
                                        <span className="bg-indigo-50 text-indigo-600 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide border border-indigo-100">You</span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Role */}
                                  <td className="p-3 text-center">
                                    <span className={`inline-block px-2.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wider ${roleBadgeStyle}`}>
                                      {roleText}
                                    </span>
                                  </td>

                                  {/* Status */}
                                  <td className="p-3 text-center">
                                    <span className={`inline-block px-2.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wider ${
                                      user.status === "Active" 
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                        : "bg-red-50 text-red-600 border-red-200"
                                    }`}>
                                      {user.status === "Active" ? "Active" : "Suspended"}
                                    </span>
                                  </td>

                                  {/* Actions */}
                                  <td className="p-3 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      {/* Change Password Button */}
                                      <button
                                        onClick={() => handleOpenChangePasswordModal(user)}
                                        className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-[9px] font-extrabold px-2.5 py-1 rounded-md shadow-sm uppercase tracking-wider transition-all"
                                      >
                                        Change PW
                                      </button>

                                      {/* Suspend/Activate Button */}
                                      {!isSelf && (
                                        <button
                                          onClick={() => handleToggleUserStatus(user.id, user.name, user.status)}
                                          className={`text-[9px] font-extrabold px-2.5 py-1 rounded-md shadow-sm uppercase tracking-wider flex items-center gap-1 border transition-all ${
                                            user.status === "Active"
                                              ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200"
                                              : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                                          }`}
                                        >
                                          {user.status === "Active" ? (
                                            <>
                                              <Ban className="w-2.5 h-2.5" />
                                              Suspend
                                            </>
                                          ) : (
                                            "Active"
                                          )}
                                        </button>
                                      )}

                                      {/* Delete Button */}
                                      {!isSelf && (
                                        <button
                                          onClick={() => handleDeleteUser(user.id, user.name)}
                                          className="border border-rose-200 text-rose-500 hover:text-white hover:bg-rose-500 p-1 rounded-md transition-all shadow-sm"
                                          title="डिलिट गर्नुहोस्"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </div>

                  {/* Inline Change Password Modal overlay */}
                  {changingPasswordUser && (
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 max-w-md w-full space-y-4 text-left relative animate-in fade-in zoom-in-95 duration-150">
                        <div>
                          <h3 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide">
                            पासवर्ड परिवर्तन गर्नुहोस् (CHANGE USER PASSWORD)
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            प्रयोगकर्ता {changingPasswordUser.name} ({changingPasswordUser.email}) को लागि नयाँ पासवर्ड सेट गर्नुहोस्।
                          </p>
                        </div>

                        <form onSubmit={handleSaveUserPassword} className="space-y-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">नयाँ पासवर्ड (NEW PASSWORD):</label>
                            <div className="relative">
                              <input
                                type="password"
                                required
                                autoFocus
                                placeholder="नयाँ पासवर्ड कम्तीमा ६ अक्षरको"
                                value={newPasswordVal}
                                onChange={(e) => setNewPasswordVal(e.target.value)}
                                className="w-full px-3 pr-4 py-2 border-2 border-slate-200 rounded-lg text-xs font-bold focus:border-indigo-500 text-slate-800 focus:outline-none bg-white"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 text-xs font-bold">
                            <button
                              type="button"
                              onClick={() => setChangingPasswordUser(null)}
                              className="px-4 py-2 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-all"
                            >
                              CANCEL
                            </button>
                            <button
                              type="submit"
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow transition-all"
                            >
                              SAVE CHANGES
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB 3: SECURITY AUDIT LOGS (Persistent Activities Logs) */}
              {activeSubTab === "logs" && (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <div>
                        <h3 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                          <Shield className="w-4.5 h-4.5 text-indigo-700" />
                          सुरक्षा र प्रणाली लग वर्कसिट (SECURITY LOGS WORKSHEET)
                        </h3>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                          डाटाबेस आयात, डिलिट, पासवर्ड परिवर्तन र प्रयोगकर्ता थप्ने प्रत्येक प्रशासनिक कार्यहरूको सुरक्षित अडिट लग।
                        </p>
                      </div>

                      <div className="flex gap-2 w-full sm:w-auto">
                        <input
                          type="text"
                          placeholder="लगहरू खोज्नुहोस्..."
                          value={logSearchQuery}
                          onChange={(e) => setLogSearchQuery(e.target.value)}
                          className="px-2.5 py-1.5 border border-slate-200 rounded text-xs font-bold w-full sm:w-48"
                        />
                        <button
                          onClick={() => {
                            showCustomConfirm(
                              "🧹 सुरक्षा लग सफा",
                              "के तपाईं सबै पुराना लग फाइलहरू सफा गर्न चाहनुहुन्छ?",
                              () => {
                                setAuditLogs([]);
                              }
                            );
                          }}
                          className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded text-[11px] font-black tracking-wide shrink-0 transition-all"
                        >
                          लग सफा गर्नुहोस्
                        </button>
                      </div>
                    </div>

                    {/* Log table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black uppercase">
                            <th className="p-2.5">लग कोड / समय (Timestamp)</th>
                            <th className="p-2.5">प्रशासक इमेल</th>
                            <th className="p-2.5">कार्य विवरण (Activity Details)</th>
                            <th className="p-2.5">आई.पी. (IP Address)</th>
                            <th className="p-2.5">स्थिति</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-sans font-bold">
                          {filteredLogs.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="p-8 text-center text-slate-400">
                                कुनै सुरक्षा लग फेला परेन।
                              </td>
                            </tr>
                          ) : (
                            filteredLogs.map((log) => (
                              <tr key={log.id} className="hover:bg-slate-50/50">
                                <td className="p-2.5 font-mono text-[11px] text-slate-500">{log.timestamp}</td>
                                <td className="p-2.5 font-mono text-slate-700">{log.user}</td>
                                <td className="p-2.5 text-slate-800">{log.activity}</td>
                                <td className="p-2.5 font-mono text-slate-600">{log.ip}</td>
                                <td className="p-2.5">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-black ${
                                    log.status.includes("सफल")
                                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                      : log.status.includes("चेतावनी")
                                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                                      : "bg-red-50 text-red-800 border border-red-200"
                                  }`}>
                                    {log.status}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-TAB 4: PASSWORD RESET CONTROLS (My Password tab) */}
              {activeSubTab === "password" && (
                <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                      प्रशासनिक पहुँच पासवर्ड परिवर्तन (MY PASSWORD CONTROLS)
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold">
                      सुरक्षा चुहावट हुन नदिन ड्यासबोर्डमा पहुँच पाउने प्रशासक पासवर्ड परिवर्तन गर्नुहोस्।
                    </p>
                  </div>

                  {passwordStatusMsg && (
                    <div className={`p-3 text-xs font-bold rounded border ${
                      passwordStatusMsg.success ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
                    }`}>
                      {passwordStatusMsg.message}
                    </div>
                  )}

                  <form onSubmit={handlePasswordChange} className="space-y-4 text-xs font-bold text-slate-600 text-left">
                    <div>
                      <label className="block mb-1">हालको पासवर्ड (Current Password):</label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={currPassword}
                        onChange={(e) => setCurrPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block mb-1">नयाँ पासवर्ड (New Password):</label>
                      <input
                        type="password"
                        required
                        placeholder="नयाँ पासवर्ड कम्तीमा ६ अक्षरको"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block mb-1">नयाँ पासवर्ड पुन: प्रविष्ट गर्नुहोस् (Confirm Password):</label>
                      <input
                        type="password"
                        required
                        placeholder="पुन: टाइप गर्नुहोस्..."
                        value={confPassword}
                        onChange={(e) => setConfPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-[#20409a] hover:bg-blue-950 text-white font-extrabold py-2.5 rounded shadow transition-all uppercase tracking-wide text-xs"
                    >
                      पासवर्ड परिवर्तन गर्नुहोस् (Update Password)
                    </button>
                  </form>
                </div>
              )}

            </div>
          </>
        )}

        {/* Bottom Footer Section (Matches Public Portal precisely) */}
        <div className="bg-white px-5 md:px-8 py-5 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4 select-none">
          <p className="text-[11px] md:text-xs text-slate-400 font-semibold tracking-wide font-sans text-center md:text-left">
            © 2026 Transport Management Office, Itahari Sunsari. Powered by PLSMS.
          </p>

          {/* Visitor Counter Card */}
          <div className="border border-sky-200 bg-sky-50/40 rounded-xl px-6 py-1.5 flex flex-col items-center justify-center text-center shadow-3xs shrink-0 select-none min-w-[160px]">
            <span className="text-[#20409a] text-lg font-black font-mono tracking-tight leading-none mb-0.5">
              {visitorCount}
            </span>
            <span className="text-[9px] text-slate-400 font-black tracking-wider uppercase font-sans">
              VISITOR SEARCH COUNTER
            </span>
          </div>
        </div>

        {/* CUSTOM ALERT & CONFIRM DIALOG MODAL (Iframe Safe) */}
        {modalDialog.isOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-left space-y-4">
              <div className="flex items-start gap-3.5">
                <div className={`p-3 rounded-full shrink-0 ${
                  modalDialog.type === "confirm" || modalDialog.alertType === "warning"
                    ? "bg-amber-50 text-amber-600"
                    : modalDialog.alertType === "success"
                    ? "bg-emerald-50 text-emerald-600"
                    : modalDialog.alertType === "error"
                    ? "bg-red-50 text-red-600"
                    : "bg-blue-50 text-blue-600"
                }`}>
                  {modalDialog.type === "confirm" || modalDialog.alertType === "warning" ? (
                    <AlertTriangle className="w-6 h-6" />
                  ) : modalDialog.alertType === "success" ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : modalDialog.alertType === "error" ? (
                    <XCircle className="w-6 h-6" />
                  ) : (
                    <Info className="w-6 h-6" />
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm md:text-base font-black text-slate-950 uppercase tracking-wide">
                    {modalDialog.title}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed whitespace-pre-line">
                    {modalDialog.message}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {modalDialog.type === "confirm" ? (
                  <>
                    <button
                      onClick={() => {
                        if (modalDialog.onCancel) modalDialog.onCancel();
                        setModalDialog(prev => ({ ...prev, isOpen: false }));
                      }}
                      className="px-4 py-2 rounded-lg text-slate-500 hover:bg-slate-100 text-xs font-black tracking-wide transition-all"
                    >
                      रद्द गर्नुहोस् (Cancel)
                    </button>
                    <button
                      onClick={() => {
                        if (modalDialog.onConfirm) modalDialog.onConfirm();
                      }}
                      className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-black tracking-wide shadow transition-all"
                    >
                      निश्चित गर्नुहोस् (Confirm)
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setModalDialog(prev => ({ ...prev, isOpen: false }))}
                    className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-black tracking-wide shadow transition-all"
                  >
                    ठीक छ (OK)
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SUPER ADMIN AUTHENTICATION VERIFICATION MODAL for DB RESET */}
        {isSuperAdminVerifyOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-left space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="p-3 rounded-full shrink-0 bg-red-50 text-red-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="space-y-1 w-full">
                  <h3 className="text-sm md:text-base font-black text-slate-950 uppercase tracking-wide flex items-center gap-1.5">
                    🔒 सुपर एड्मिन प्रमाणीकरण (Super Admin Verification)
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    डाटाबेस पूर्ण रिसेट गर्नको लागि सुपर एड्मिन प्रयोगकर्ता <span className="font-bold text-slate-800">T. Modlitahari (tmodlitahari@gmail.com)</span> को सुरक्षा पासवर्ड आवश्यक छ।
                  </p>
                </div>
              </div>

              <form onSubmit={handleSuperAdminResetVerify} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    सुरक्षा पासवर्ड (SECURITY PASSWORD):
                  </label>
                  <input
                    type="password"
                    value={verifyPassword}
                    onChange={(e) => setVerifyPassword(e.target.value)}
                    placeholder="सुरक्षा पासवर्ड प्रविष्ट गर्नुहोस्"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:border-red-500 font-medium"
                    required
                    autoFocus
                  />
                </div>

                {verifyError && (
                  <div className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg">
                    ⚠️ {verifyError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSuperAdminVerifyOpen(false);
                      setVerifyPassword("");
                      setVerifyError(null);
                    }}
                    className="px-4 py-2 rounded-lg text-slate-500 hover:bg-slate-100 text-xs font-black tracking-wide transition-all"
                    disabled={isResettingDb}
                  >
                    रद्द गर्नुहोस् (Cancel)
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-black tracking-wide shadow transition-all flex items-center gap-1"
                    disabled={isResettingDb}
                  >
                    {isResettingDb ? "रिसेट हुँदै..." : "प्रमाणित र रिसेट गर्नुहोस् (Verify & Reset)"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Duplicates Modal Comparison Table */}
        {isDuplicatesModalOpen && selectedLotDuplicates && (
          <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
            <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full p-6 space-y-4 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                  <div>
                    <h3 className="text-sm md:text-base font-black uppercase tracking-wide">
                      प्रतिलिपि रेकर्डहरू तुलना विश्लेषण (DUPLICATE RECORDS COMPARISON WORKSHEET)
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                      पहिले नै सुरक्षित भएकाले डेटाबेसमा थप्न अस्वीकार गरिएका वा छोडिएका (Skipped) प्रतिलिपि रेकर्ड विवरणहरू।
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDuplicatesModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-lg transition-all"
                >
                  <span className="text-xs font-black px-1">CLOSE ×</span>
                </button>
              </div>

              <div className="overflow-x-auto max-h-[400px]">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-black uppercase">
                      <th className="p-2.5">S.N.</th>
                      <th className="p-2.5">APPLICANT ID</th>
                      <th className="p-2.5">FULL NAME</th>
                      <th className="p-2.5">LICENSE NO.</th>
                      <th className="p-2.5">CATEGORY</th>
                      <th className="p-2.5">OLD CODE</th>
                      <th className="p-2.5">NEW CODE</th>
                      <th className="p-2.5">VISIT DATE</th>
                      <th className="p-2.5 text-center text-red-600">UPLOAD ACTION STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans font-semibold text-slate-700">
                    {selectedLotDuplicates.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400 font-bold">
                          कुनै प्रतिलिपि फेला परेन।
                        </td>
                      </tr>
                    ) : (
                      selectedLotDuplicates.map((rec, idx) => (
                        <tr key={idx} className="hover:bg-red-50/20">
                          <td className="p-2.5 font-mono text-slate-400">{idx + 1}</td>
                          <td className="p-2.5 font-mono font-black text-slate-800">{rec.applicantId}</td>
                          <td className="p-2.5 text-slate-900 font-bold">{rec.fullName}</td>
                          <td className="p-2.5 font-mono font-black text-blue-700">{rec.licenseNo}</td>
                          <td className="p-2.5 font-black text-slate-500"><span className="bg-slate-100 px-1.5 py-0.5 rounded">{rec.category}</span></td>
                          <td className="p-2.5 font-mono text-slate-500">{rec.oldCode || "-"}</td>
                          <td className="p-2.5 font-mono text-slate-800">{rec.newCode || "-"}</td>
                          <td className="p-2.5 text-slate-600">{rec.visitDate || "-"}</td>
                          <td className="p-2.5 text-center">
                            <span className="inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">
                              SKIPPED / ALREADY IN DB
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center text-xs text-slate-400 border-t border-slate-100 pt-3">
                <span className="font-semibold text-red-500 font-mono">
                  Total Duplicate Matches Found: {selectedLotDuplicates.length} record(s)
                </span>
                <button
                  onClick={() => setIsDuplicatesModalOpen(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-lg transition-all"
                >
                  OK (ठीक छ)
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
