import React from "react";
import { Search, XCircle, Calendar, RefreshCw, CheckCircle2, QrCode, ShieldCheck, Download, Printer, Copy, Check } from "lucide-react";
import QRCode from "qrcode";

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

interface PublicSearchPortalProps {
  nepaliTime: { dateString: string; timeString: string };
  visitorCount: number;
  searchQueryInput: string;
  setSearchQueryInput: (val: string) => void;
  searchQuery: string;
  isSearching: boolean;
  results: LicenseRecord[];
  handleSearchSubmit: (e?: React.FormEvent, overrideQuery?: string) => void;
  handleReset: () => void;
}

export default function PublicSearchPortal({
  nepaliTime,
  visitorCount,
  searchQueryInput,
  setSearchQueryInput,
  searchQuery,
  isSearching,
  results,
  handleSearchSubmit,
  handleReset
}: PublicSearchPortalProps) {
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const publicInputRef = React.useRef<HTMLInputElement | null>(null);
  const [animState, setAnimState] = React.useState<"idle" | "fading-out" | "loading" | "fading-in" | "show">("idle");
  const [renderResults, setRenderResults] = React.useState<LicenseRecord[]>([]);
  const [renderQuery, setRenderQuery] = React.useState<string>("");

  // Ensure any legacy search history is cleared for privacy
  React.useEffect(() => {
    try {
      localStorage.removeItem("nepal_dmv_public_search_history");
    } catch (e) {
      // Ignore
    }
  }, []);

  // QR Modal State and Handlers
  const [isQrModalOpen, setIsQrModalOpen] = React.useState(false);
  const [qrUrl, setQrUrl] = React.useState<string>("");
  const [isCopied, setIsCopied] = React.useState(false);

  React.useEffect(() => {
    QRCode.toDataURL(
      "https://license-search-sunsari.onrender.com",
      {
        width: 320,
        margin: 1,
        color: {
          dark: "#20409a", // Exact theme blue
          light: "#ffffff",
        },
      },
      (err, url) => {
        if (!err) {
          setQrUrl(url);
        } else {
          console.error("QR Code generation failed:", err);
        }
      }
    );
  }, []);

  const handleCopyLink = () => {
    navigator.clipboard.writeText("https://license-search-sunsari.onrender.com");
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  const handleDownloadPng = () => {
    if (!qrUrl) return;
    const link = document.createElement("a");
    link.href = qrUrl;
    link.download = "PLSMS_QR_Code.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintQr = () => {
    if (!qrUrl) return;
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Print QR Code - PLSMS</title>
            <style>
              body {
                font-family: 'Inter', -apple-system, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                padding: 40px;
                background-color: white;
                color: #1e293b;
                text-align: center;
              }
              .card {
                border: 2px dashed #20409a;
                border-radius: 20px;
                padding: 30px;
                display: inline-flex;
                flex-direction: column;
                align-items: center;
                background: white;
                max-width: 400px;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
              }
              img {
                width: 280px;
                height: 280px;
                display: block;
                margin-bottom: 24px;
              }
              h1 {
                color: #20409a;
                font-size: 16px;
                font-weight: 800;
                margin: 0 0 8px 0;
                line-height: 1.4;
                text-transform: uppercase;
                letter-spacing: 0.05em;
              }
              h2 {
                font-size: 14px;
                font-weight: 700;
                color: #0f172a;
                margin: 0 0 4px 0;
              }
              p {
                font-size: 12px;
                color: #64748b;
                font-weight: 500;
                margin: 0 0 16px 0;
              }
              .url-box {
                background-color: #f1f5f9;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 8px 16px;
                font-family: monospace;
                font-size: 12px;
                color: #20409a;
                font-weight: 600;
                width: 100%;
                box-sizing: border-box;
              }
              @media print {
                body {
                  padding: 0;
                  box-shadow: none;
                }
                .card {
                  border: none;
                  box-shadow: none;
                  padding: 0;
                }
              }
            </style>
          </head>
          <body>
            <div class="card">
              <img src="${qrUrl}" alt="PLSMS QR Code" />
              <h1>Printed License Search Management System (PLSMS)</h1>
              <h2>Transport Management Office</h2>
              <p>Itahari, Sunsari</p>
              <div class="url-box">https://license-search-sunsari.onrender.com</div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatLicenseNumber(e.target.value);
    setSearchQueryInput(formatted);
    setValidationError(null);
  };

  React.useEffect(() => {
    if (searchQuery && !isSearching) {
      setRenderResults(results);
      setRenderQuery(searchQuery);
      setAnimState("fading-in");
      const timer = setTimeout(() => {
        setAnimState("show");
      }, 250);
      publicInputRef.current?.focus();
      return () => clearTimeout(timer);
    } else if (isSearching) {
      setAnimState("loading");
    } else if (!searchQuery) {
      setAnimState("idle");
    }
  }, [results, searchQuery, isSearching]);

  const handleLocalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    let query = searchQueryInput.trim();
    if (!query) {
      setAnimState("fading-out");
      setTimeout(() => {
        setValidationError("कृपया लाइसेन्स नम्बर वा आवेदक ID प्रविष्ट गर्नुहोस्।");
        handleReset();
        setRenderQuery("");
        setRenderResults([]);
        setAnimState("idle");
        publicInputRef.current?.focus();
      }, 150);
      return;
    }

    const rawDigits = query.replace(/\D/g, "");
    if (rawDigits.length === 12 && !query.includes("-")) {
      query = `${rawDigits.slice(0, 2)}-${rawDigits.slice(2, 4)}-${rawDigits.slice(4)}`;
      setSearchQueryInput(query);
    }

    if (query.replace(/[-\s]/g, "").length < 3) {
      setAnimState("fading-out");
      setTimeout(() => {
        setValidationError("त्रुटि: कृपया कम्तीमा ३ अंक वा अक्षर प्रविष्ट गर्नुहोस् (उदा. XX-XX-XXXXXXXX वा आवेदक ID)।");
        const savedInput = searchQueryInput;
        handleReset();
        setSearchQueryInput(savedInput);
        setRenderQuery("");
        setRenderResults([]);
        setAnimState("idle");
        publicInputRef.current?.focus();
      }, 150);
      return;
    }

    setAnimState("fading-out");
    setTimeout(() => {
      handleSearchSubmit(e, query);
    }, 150);
  };

  const handleLocalReset = () => {
    setAnimState("fading-out");
    setValidationError(null);
    setTimeout(() => {
      setRenderResults([]);
      setRenderQuery("");
      handleReset();
      setAnimState("idle");
      publicInputRef.current?.focus();
    }, 150);
  };

  return (
    <div className="flex-1 w-full px-4 py-6 md:py-10 flex flex-col items-center justify-start bg-[#eaedf2]" id="public-search-container">
      {/* Framed DMV Application Portal */}
      <div className="max-w-4xl w-full bg-white shadow-2xl rounded-2xl overflow-hidden border-4 border-[#20409a] flex flex-col animate-fade-in">
        
        {/* Header Section */}
        <div className="bg-[#20409a] p-3 md:p-5 flex flex-row items-center justify-between gap-2 md:gap-4 select-none border-b-4 border-red-600 relative">
          <div className="flex items-center gap-2 md:gap-4 text-left flex-1 min-w-0 pr-16 sm:pr-0">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/2/23/Emblem_of_Nepal.svg" 
              alt="Government of Nepal" 
              className="w-10 h-10 md:w-16 md:h-16 object-contain shrink-0 filter drop-shadow-md"
              referrerPolicy="no-referrer"
            />
            <div className="text-white min-w-0">
              <h1 className="text-[8.5px] min-[360px]:text-[10px] min-[400px]:text-[11.5px] sm:text-sm md:text-lg lg:text-xl font-bold tracking-wide font-sans leading-tight whitespace-nowrap">
                यातायात व्यवस्था कार्यालय, सवारी चालक अनुमति पत्र
              </h1>
              <p className="text-[8px] min-[360px]:text-[9.5px] min-[400px]:text-[11px] sm:text-xs md:text-sm lg:text-base font-semibold opacity-95 font-sans mt-0.5">
                इटहरी, सुनसरी
              </p>
            </div>
          </div>

          {/* Dynamic Live Nepal Calendar & Clock */}
          <div className="absolute bottom-2 right-3 sm:static flex flex-col items-end text-white text-right shrink-0 font-sans pl-1">
            <button 
              onClick={() => setIsQrModalOpen(true)}
              className="flex items-center gap-1 bg-white/15 px-2 md:px-2.5 py-1 rounded border border-white/25 text-[8.5px] md:text-xs font-mono font-bold hover:bg-white/25 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
            >
              <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-blue-400 rounded-full animate-pulse"></span>
              <QrCode className="w-3 h-3 md:w-3.5 md:h-3.5 inline mr-0.5" />
              <span>QR CODE</span>
            </button>
            <div className="hidden md:block mt-1">
              <p className="text-xs md:text-sm font-bold tracking-wide">
                {nepaliTime.dateString}
              </p>
              <p className="text-[10px] md:text-xs font-semibold tracking-wider font-mono mt-0.5 opacity-90">
                {nepaliTime.timeString}
              </p>
            </div>
          </div>
        </div>

        {/* PLSMS Subtitle Banner */}
        <div className="py-4 md:py-5 text-center bg-slate-50 border-b border-slate-100">
          <h2 className="text-[#20409a] text-[8px] min-[350px]:text-[9.5px] min-[400px]:text-[11px] sm:text-xs md:text-base lg:text-lg font-black tracking-wider sm:tracking-widest uppercase font-sans px-2 whitespace-nowrap">
            PRINTED LICENSE SEARCH MANAGEMENT SYSTEM (PLSMS)
          </h2>
        </div>

        {/* Core Card Section */}
        <div className="p-3 md:p-8 space-y-4 md:space-y-6">
          
          {/* Yellow Notice Box */}
          <div className="bg-[#FFFDF0] border border-[#FFE899] rounded-xl p-3 md:p-3.5 flex items-start gap-2.5 text-left shadow-2xs">
            <span className="text-sm md:text-base shrink-0 hidden sm:inline-block">💡</span>
            <p className="text-[9px] min-[360px]:text-[10px] min-[400px]:text-[11.5px] sm:text-xs md:text-sm text-[#8A6D3B] font-semibold leading-normal sm:leading-relaxed font-sans w-full">
              यस कार्यालयबाट नवीकरण (Renewal), नयाँ (New License), वर्ग थप (Category Add) तथा प्रतिलिपि (Duplicate) वापतको सेवा लिएका कार्डहरू मात्र यहाँबाट खोज्नुहोला।
            </p>
          </div>

          {/* Input & Form */}
          <form onSubmit={handleLocalSubmit} className="space-y-3 md:space-y-4 text-center">
            <div className="space-y-2 md:space-y-3 max-w-xl md:max-w-3xl mx-auto">
              <label className="block text-center font-black uppercase tracking-widest px-0.5">
                <span className="hidden md:inline text-xs text-slate-500">
                  लाइसेन्स नम्बर प्रविष्ट गर्नुहोस् ENTER LICENSE NO: XX-XX-XXXXXXXX
                </span>
                <span className="inline md:hidden text-[10px] min-[360px]:text-[11px] text-[#20409a]">
                  ENTER LICENSE NO: XX-XX-XXXXXXXX
                </span>
              </label>
              
              <div className="flex flex-row md:flex-row gap-2 md:gap-3 items-center md:items-stretch">
                <div className="relative flex-1 min-w-0">
                  <input
                    ref={publicInputRef}
                    type="text"
                    placeholder="XX-XX-XXXXXXXX"
                    value={searchQueryInput}
                    onChange={handleInputChange}
                    maxLength={14}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full px-3 py-2.5 md:px-4 md:py-3 bg-white border-2 border-slate-300 focus:border-[#20409a] rounded-lg shadow-inner text-sm md:text-lg font-bold font-mono tracking-wider md:tracking-widest text-center md:text-left focus:outline-none focus:ring-4 focus:ring-blue-100 text-slate-800 placeholder-slate-300 h-10 md:h-auto"
                  />
                  {searchQueryInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQueryInput("");
                        setValidationError(null);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <XCircle className="w-4 h-4 md:w-5 md:h-5" />
                    </button>
                  )}
                </div>
                
                <div className="flex gap-2 shrink-0">
                  <button
                    type="submit"
                    className="flex items-center justify-center gap-1.5 md:gap-2 bg-[#20409a] hover:bg-[#152e72] text-white font-black text-xs md:text-sm px-3.5 md:px-6 py-2.5 md:py-3.5 rounded-lg shadow-md uppercase transition-all tracking-wider shrink-0 h-10 md:h-auto whitespace-nowrap md:min-w-[130px]"
                  >
                    <Search className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
                    SEARCH
                  </button>
                  <button
                    type="button"
                    onClick={handleLocalReset}
                    className="hidden md:flex items-center justify-center bg-[#6c757d] hover:bg-[#545b62] text-white font-black text-xs md:text-sm px-6 py-3.5 rounded-lg shadow-md uppercase transition-all tracking-wider md:min-w-[100px]"
                  >
                    RESET
                  </button>
                </div>
              </div>

              {validationError && (
                <div className="bg-red-50 border border-red-200 text-red-800 px-3 md:px-4 py-2 md:py-2.5 rounded-lg text-[11px] md:text-xs font-bold flex items-center gap-2 mt-1.5 md:mt-2">
                  <span className="shrink-0 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black">✕</span>
                  <span>{validationError}</span>
                </div>
              )}
            </div>
          </form>

          {/* Dynamic Query Result Panel - Single Reusable Container */}
          {(renderQuery || isSearching || animState === "loading" || animState === "fading-out") && (
            <div 
              className={`pt-1 md:pt-2 text-left transition-all duration-200 ease-in-out ${
                animState === "fading-out" || animState === "loading"
                  ? "opacity-0 scale-98 pointer-events-none"
                  : "opacity-100 scale-100"
              }`}
            >
              {isSearching || animState === "loading" ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 md:p-8 flex flex-col items-center justify-center text-center animate-pulse">
                  <RefreshCw className="w-7 h-7 md:w-8 md:h-8 text-[#20409a] animate-spin mb-2.5 md:mb-3" />
                  <p className="text-xs md:text-sm font-bold text-slate-800"> DMV डाटाबेसमा खोज्दैछ...</p>
                  <p className="text-[11px] md:text-xs text-slate-400 mt-1">Please wait while we query the records.</p>
                </div>
              ) : renderResults.length === 0 ? (
                /* RED WARNING BOX (MATCHES REF IMAGE) */
                <div className="bg-[#f8d7da] border border-[#f5c6cb] rounded-xl p-3 sm:p-5 flex items-start gap-2 sm:gap-4 shadow-3xs">
                  <div className="w-4.5 h-4.5 sm:w-6 sm:h-6 rounded-full bg-red-600 flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm text-[9px] sm:text-xs font-black">
                    ✕
                  </div>
                  <div className="space-y-1 sm:space-y-1.5 text-[#721c24] flex-1 min-w-0">
                    <h3 className="text-[11px] min-[360px]:text-[12px] sm:text-base md:text-lg font-black tracking-tight leading-tight">
                      तपाईंको लाइसेन्स कार्ड हाल कार्यालयमा उपलब्ध छैन।
                    </h3>
                    <p className="text-[9px] min-[360px]:text-[10px] min-[400px]:text-[11px] sm:text-xs md:text-sm font-medium leading-normal sm:leading-relaxed opacity-95">
                      प्रविष्ट नम्बर: <strong className="font-mono text-slate-950 font-black bg-white/40 px-1 py-0.5 rounded text-[8px] sm:text-xs">{renderQuery}</strong> को नवीकरण (Renewal) तथा नयाँ लाइसेन्स (New License) वा वर्ग थप (Category Add) को प्रयोगात्मक परीक्षा उत्तीर्ण गर्नुभएको हो भने कार्ड प्रिन्ट भई कार्यालय आइपुग्न केही समय लाग्न सक्छ । कृपया केही दिनपछि पुनः खोज्नुहोला ।
                    </p>
                  </div>
                </div>
              ) : (
                /* MATCH FOUND */
                (() => {
                  const rec = renderResults[0];
                  const isAvailable = !rec.receivedBy || rec.receivedBy.trim() === "";
                  
                  if (isAvailable) {
                    return (
                      <div className="space-y-3 md:space-y-4 animate-scale-in">
                        {/* LICENSE AVAILABLE MAIN CONTAINER (AS EXACT AS PICTURE 2) */}
                        <div className="bg-[#f0fdf4] border-2 border-emerald-400 p-3.5 sm:p-5 rounded-xl sm:rounded-2xl shadow-xs space-y-3 md:space-y-4">
                          
                          {/* Title block with check icon */}
                          <div className="flex items-start gap-2.5 md:gap-3">
                            <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6 text-emerald-600 shrink-0 mt-0.5" />
                            <div>
                              <h3 className="text-xs md:text-base font-black text-emerald-900 tracking-tight leading-snug">
                                लाइसेन्स कार्ड उपलब्ध छ (LICENSE AVAILABLE)
                              </h3>
                              <p className="text-[11px] md:text-sm font-bold text-emerald-800 leading-normal mt-0.5">
                                तपाईंको प्रिन्ट भएको स्मार्ट कार्ड कार्यालयमा आइपुगेको छ।
                              </p>
                            </div>
                          </div>

                          <div className="border-t border-emerald-200/60 my-1.5 md:my-2"></div>

                          {/* 4 Cards Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:gap-4">
                            
                            {/* APPLICANT NAME */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                APPLICANT NAME / नाम
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-blue-600 uppercase tracking-wide">
                                {rec.fullName?.toUpperCase()}
                              </span>
                            </div>

                            {/* LICENSE NUMBER */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                LICENSE NUMBER / लाइसेन्स नं.
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-blue-600 font-mono tracking-wide">
                                {rec.licenseNo}
                              </span>
                            </div>

                            {/* CATEGORY */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                CATEGORY / वर्ग
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-blue-600 font-mono tracking-wide">
                                {rec.category}
                              </span>
                            </div>

                            {/* VISITING DAY */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                VISITING DAY / कार्ड बुझिलिने दिन
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-blue-600 tracking-wide">
                                {rec.visitDate || "सोमबार"}
                              </span>
                            </div>

                          </div>

                          {/* Collection Counter Info Card */}
                          <div className="border border-slate-300 bg-white rounded-xl p-3.5 sm:p-5 flex flex-col items-center justify-center text-center shadow-xs space-y-2 md:space-y-3.5">
                            <p className="text-[11px] sm:text-xs md:text-sm font-extrabold text-[#155724] tracking-wide leading-relaxed">
                              पुरानो सक्कल लाइसेन्स वा रसिद बुझाउने ठाँउ (Collection Counter) कोठा नं. १६
                            </p>
                            <div className="border-t border-dashed border-slate-300 w-full"></div>
                            <p className="text-[11px] sm:text-xs md:text-sm font-extrabold text-blue-600 tracking-wide leading-relaxed">
                              स्मार्ट कार्ड वितरण काउन्टर (Distribution Counter) कोठा नं. १७
                            </p>
                            <div className="border-t border-dashed border-slate-300 w-full"></div>
                            <p className="text-[11px] sm:text-xs md:text-sm font-extrabold leading-relaxed text-slate-800">
                              <span className="text-red-600">स्मार्ट कार्ड लिन जाने दिन </span>
                              <span className="text-blue-600">{rec.visitDate || "सोमबार"}</span> ।
                            </p>
                          </div>

                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="space-y-3 md:space-y-4 animate-scale-in">
                        {/* LICENSE COLLECTED MAIN CONTAINER */}
                        <div className="bg-[#f8f9fa] border-2 border-slate-300 p-3.5 sm:p-5 rounded-xl sm:rounded-2xl shadow-xs space-y-3 md:space-y-4">
                          
                          {/* Title block with check icon */}
                          <div className="flex items-start gap-2.5 md:gap-3">
                            <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6 text-slate-600 shrink-0 mt-0.5" />
                            <div>
                              <h3 className="text-sm md:text-base font-black text-slate-800 tracking-tight leading-snug">
                                <span className="hidden md:inline">
                                  लाइसेन्स कार्ड वितरण भइसकेको छ (LICENSE DELIVERED)
                                </span>
                                <span className="inline md:hidden text-xs text-slate-800 font-extrabold">
                                  लाइसेन्स कार्ड वितरण भइसकेको छ ।
                                </span>
                              </h3>
                              <p className="hidden md:block text-xs md:text-sm font-bold text-slate-600 leading-normal mt-0.5">
                                तपाईंको लाइसेन्स कार्ड बुझिलिइसकिएको छ।
                              </p>
                            </div>
                          </div>

                          <div className="border-t border-slate-200 my-1.5 md:my-2"></div>

                          {/* 4 Cards Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 md:gap-4">
                            
                            {/* APPLICANT NAME */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                APPLICANT NAME / नाम
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-slate-700 uppercase tracking-wide">
                                {rec.fullName?.toUpperCase()}
                              </span>
                            </div>

                            {/* LICENSE NUMBER */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                LICENSE NUMBER / लाइसेन्स नं.
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-slate-700 font-mono tracking-wide">
                                {rec.licenseNo}
                              </span>
                            </div>

                            {/* CATEGORY */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                CATEGORY / वर्ग
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-slate-700 font-mono tracking-wide">
                                {rec.category}
                              </span>
                            </div>

                            {/* RECEIVED BY */}
                            <div className="border border-slate-300 bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center shadow-xs">
                              <span className="text-[9px] md:text-xs font-black text-slate-500 tracking-wider mb-1 uppercase">
                                RECEIVED BY / बुझिलिने व्यक्ति
                              </span>
                              <span className="text-xs sm:text-sm md:text-base font-black text-emerald-600 tracking-wide">
                                {rec.receivedBy}
                              </span>
                            </div>

                          </div>

                        </div>
                      </div>
                    );
                  }
                })()
              )}
            </div>
          )}

          {/* Green Instructions List (MATCHES REF IMAGE) */}
          <div className="bg-[#eefdf5] border border-emerald-200 rounded-xl p-3.5 sm:p-5 md:p-6 text-left shadow-3xs space-y-2.5 sm:space-y-4">
            <h3 className="text-[11px] sm:text-sm md:text-base font-black text-[#155724] flex items-center gap-1.5 sm:gap-2">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 shrink-0" />
              <span>लाइसेन्स कार्ड बुझ्न आउँदा ल्याउनुपर्ने कागजातहरू:</span>
            </h3>
            <ul className="space-y-2 sm:space-y-3.5 text-[9px] min-[360px]:text-[10px] min-[400px]:text-[11px] sm:text-xs md:text-sm font-semibold text-[#155724]/95 font-sans leading-normal sm:leading-relaxed">
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-700 font-black">•</span>
                <span>लाइसेन्स वापतको राजस्व बुझाएको सक्कल रसिद (Original Receipt Bill) ।</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-700 font-black">•</span>
                <span>सक्कल लाइसेन्स वा राजस्व बुझाएको सक्कल रसिद हराएको/नासिएको हकमा ट्राफिक कार्यालयको सिफारिस पत्र।</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-700 font-black">•</span>
                <span>अनलाइन भुक्तानी गरेको भए सोको प्रिन्ट प्रतिलिपि (Online Payment Receipt) ।</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-700 font-black">•</span>
                <span>अन्य व्यक्तिले बुझिलिने भएमा सम्बन्धित व्यक्तिको मन्जुरीनामा र नागरिकता कपी।</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-700 font-black">•</span>
                <span>कार्ड वितरण कार्यको लागि सक्कल रसिद लिने समय: सोमबार देखि शुक्रबार (बिहान ९:३० देखि दिउँसो ४:०० सम्म)।</span>
              </li>
            </ul>
          </div>

        </div>

        {/* Bottom Footer Section */}
        <div className="bg-white px-4 md:px-8 py-4 sm:py-5 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4 select-none border-b border-slate-100">
          <p className="text-[9.5px] min-[360px]:text-[10px] sm:text-xs text-slate-400 font-semibold tracking-wide font-sans text-center md:text-left">
            © 2026 Transport Management Office, Itahari Sunsari.
          </p>

          {/* Visitor Counter Card */}
          <div className="border border-sky-200 bg-sky-50/40 rounded-lg sm:rounded-xl px-4 sm:px-6 py-1 sm:py-1.5 flex flex-col items-center justify-center text-center shadow-3xs shrink-0 select-none min-w-[120px] sm:min-w-[150px]">
            <span className="text-blue-600 text-xs sm:text-sm font-black font-mono tracking-wide leading-none mb-0.5">
              {visitorCount}
            </span>
            <span className="text-[7px] sm:text-[8px] text-slate-400 font-black tracking-widest uppercase font-sans">
              VISITOR SEARCH COUNTER
            </span>
          </div>
        </div>

      </div>

      {/* Share PLSMS / QR CODE Modal Dialog */}
      {isQrModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-2xs flex items-center justify-center z-50 p-4 animate-fade-in" id="qr-modal-overlay" onClick={() => setIsQrModalOpen(false)}>
          <div 
            className="bg-white rounded-2xl overflow-hidden shadow-2xl max-w-sm w-full border border-slate-200 flex flex-col transform transition-all scale-100"
            id="qr-modal-container"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-[#20409a] px-4 py-3 flex items-center justify-between text-white select-none">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-white" />
                <span className="font-bold text-[13px] tracking-wide uppercase font-sans">Share PLSMS</span>
              </div>
              <button 
                onClick={() => setIsQrModalOpen(false)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1 rounded-lg transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Red Separator Line */}
            <div className="h-[3px] bg-red-600 w-full"></div>

            {/* Content Area */}
            <div className="p-5 flex flex-col items-center bg-white text-center">
              
              {/* Office Name Written First Professionally */}
              <div className="w-full pb-3 border-b border-slate-100 mb-4 text-center">
                <h3 className="text-[11.5px] font-black text-slate-800 font-sans tracking-wide leading-tight">
                  यातायात व्यवस्था कार्यालय (Transport Management Office)
                </h3>
                <p className="text-[9.5px] font-semibold text-slate-500 mt-0.5 font-sans">
                  इटहरी, सुनसरी, कोशी प्रदेश (Itahari, Sunsari, Nepal)
                </p>
              </div>

              {/* Smart QR Code Container */}
              <div className="border-2 border-dashed border-blue-700 rounded-2xl p-3.5 bg-white flex items-center justify-center shadow-xs mb-3">
                {qrUrl ? (
                  <img src={qrUrl} alt="PLSMS QR Code" className="w-48 h-48 object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-48 h-48 bg-slate-100 animate-pulse rounded-xl flex items-center justify-center text-slate-400 text-xs font-sans">
                    Generating QR Code...
                  </div>
                )}
              </div>

              {/* Title of System */}
              <h4 className="text-[#20409a] font-black text-[10px] uppercase tracking-wide px-1 leading-normal font-sans whitespace-nowrap overflow-hidden text-ellipsis">
                Printed License Search Management System (PLSMS)
              </h4>

              {/* Website Link Box */}
              <div className="bg-[#ebf2ff] border border-blue-200 rounded-lg py-2 px-3 text-center text-blue-700 text-xs font-mono font-bold max-w-[280px] w-full truncate select-all mt-3 flex items-center justify-center shadow-2xs">
                https://license-search-sunsari.onrender.com
              </div>

            </div>

            {/* Footer / Buttons Section */}
            <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-2">
              
              {/* Row 1: Side by Side Download / Print */}
              <div className="flex gap-2 w-full">
                <button
                  onClick={handleDownloadPng}
                  className="bg-[#20409a] hover:bg-blue-800 text-white font-bold text-[11px] py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 w-1/2 cursor-pointer transition-all shadow-xs active:scale-98 focus:outline-none"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="whitespace-nowrap">Download PNG</span>
                </button>
                <button
                  onClick={handlePrintQr}
                  className="bg-[#dc2626] hover:bg-red-700 text-white font-bold text-[11px] py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 w-1/2 cursor-pointer transition-all shadow-xs active:scale-98 focus:outline-none"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span className="whitespace-nowrap">Print QR</span>
                </button>
              </div>

              {/* Row 2: Copy Website Link and Close */}
              <div className="flex gap-2 w-full">
                <button
                  onClick={handleCopyLink}
                  className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-[11px] py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 w-1/2 cursor-pointer transition-all shadow-2xs active:scale-99 focus:outline-none"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                      <span className="text-emerald-600 whitespace-nowrap">Copied Link!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 shrink-0" />
                      <span className="whitespace-nowrap">Copy Website Link</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setIsQrModalOpen(false)}
                  className="bg-[#64748b] hover:bg-slate-600 text-white font-bold text-[11px] py-2.5 px-2 rounded-xl flex items-center justify-center w-1/2 cursor-pointer transition-all shadow-xs active:scale-99 focus:outline-none"
                >
                  Close
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}
