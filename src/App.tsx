import { useState, useRef, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "./firebase";
import { collection, addDoc, query, getDocs, serverTimestamp, orderBy, deleteDoc, doc } from "firebase/firestore";
import { 
  Menu, ArrowLeft, Share2, MoreHorizontal, Download, Upload, Wand2, 
  Copy, Languages, Play, Pause, RotateCcw, RotateCw, Youtube, Facebook, Video, 
  Link, Cloud, AlertCircle, Loader2, Triangle, LayoutDashboard, FileText, Check,
  Instagram, Twitter, Search, Music, Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import Markdown from "react-markdown";

// Initialize Gemini API
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface TranscriptSegment {
  speaker: string;
  timestamp: string;
  text: string;
}

interface TranscriptionData {
  title: string;
  segments: TranscriptSegment[];
  summary: string;
  mindMap: string;
  detectedLanguage: string;
}

export default function App() {
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [url, setUrl] = useState("");
  const [activeTab, setActiveTab] = useState<"upload" | "link">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [transcriptionData, setTranscriptionData] = useState<TranscriptionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resultTab, setResultTab] = useState<"transcript" | "summary" | "mindmap">("transcript");
  
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const timeToSeconds = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const activeIndex = transcriptionData ? transcriptionData.segments.reduce((acc, curr, idx) => {
    if (timeToSeconds(curr.timestamp) <= currentTime) return idx;
    return acc;
  }, 0) : -1;

  useEffect(() => {
    if (activeIndex >= 0 && segmentRefs.current[activeIndex]) {
      segmentRefs.current[activeIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeIndex]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(e => {
        console.error("Audio play failed:", e);
        toast.error("Failed to play audio.");
      });
    } else {
      audioRef.current.pause();
    }
  };

  const skipForward = () => {
    if (audioRef.current) audioRef.current.currentTime += 10;
  };

  const skipBackward = () => {
    if (audioRef.current) audioRef.current.currentTime -= 10;
  };

  const fetchTranscripts = async () => {
    const q = query(collection(db, "public_transcriptions"), orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);
    const fetchedTranscripts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setTranscripts(fetchedTranscripts);
    setShowLibrary(true);
    setTranscriptionData(null);
  };

  const deleteTranscript = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, "public_transcriptions", id));
      setTranscripts(transcripts.filter(t => t.id !== id));
      toast.success("Transcript deleted!");
    } catch (err: any) {
      console.error("Error deleting transcript:", err);
      toast.error("Failed to delete transcript.");
    }
  };

  const saveTranscript = async (data: TranscriptionData) => {
    try {
      await addDoc(collection(db, "public_transcriptions"), {
        title: data.title,
        transcript: data.segments.map(s => s.text).join(" "),
        summary: data.summary,
        mindMap: data.mindMap,
        detectedLanguage: data.detectedLanguage,
        segments: data.segments,
        createdAt: serverTimestamp(),
      });
      toast.success("Transcript saved to library!");
    } catch (err: any) {
      console.error("Error saving transcript: ", err);
      setError(err.message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setStatus("Preparing file...");
      setError("");
    }
  };

  const handleTranscribe = async () => {
    if (activeTab === "link") {
      if (!url) {
        setError("Please enter a video URL");
        return;
      }
      setIsLoading(true);
      setError("");
      setTranscriptionData(null);
      setStatus("Extracting audio...");

      try {
        const response = await fetch("/api/extract-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to extract audio.");

        const { audioData, mimeType, title } = data;
        processTranscription(audioData, mimeType, title);
      } catch (err: any) {
        setError(err.message);
        setIsLoading(false);
      }
    } else {
      if (!selectedFile) {
        setError("Please select a local file");
        return;
      }
      setIsLoading(true);
      setError("");
      setTranscriptionData(null);
      setStatus("Reading file...");

      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        processTranscription(base64, selectedFile.type, selectedFile.name);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const processTranscription = async (audioBase64: string, mimeType: string, title: string) => {
    try {
      setStatus(`Transcribing: ${title}...`);
      
      if (activeTab === "upload" && selectedFile) {
        setAudioUrl(URL.createObjectURL(selectedFile));
      } else if (audioBase64 && mimeType) {
        try {
          const byteCharacters = atob(audioBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: mimeType });
          setAudioUrl(URL.createObjectURL(blob));
        } catch (e) {
          console.error("Failed to create blob from base64", e);
          setAudioUrl(`data:${mimeType};base64,${audioBase64}`);
        }
      } else {
        setAudioUrl("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
      }

      const model = "gemini-3-flash-preview"; 
      const result = await genAI.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { inlineData: { data: audioBase64, mimeType: mimeType } },
              {
                text: `Transcribe the audio into a structured JSON format.
                Include:
                1. "title": The title of the content.
                2. "detectedLanguage": The language identified.
                3. "segments": An array of objects with "speaker", "timestamp" (MM:SS format), and "text".
                4. "summary": A concise overview.
                5. "mindMap": A markdown list of concepts.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              detectedLanguage: { type: Type.STRING },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    timestamp: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ["speaker", "timestamp", "text"],
                },
              },
              summary: { type: Type.STRING },
              mindMap: { type: Type.STRING },
            },
            required: ["title", "detectedLanguage", "segments", "summary", "mindMap"],
          },
        },
      });

      const parsedData = JSON.parse(result.text || "{}");
      setTranscriptionData(parsedData);
      saveTranscript(parsedData);
      toast.success("Transcription complete!");
    } catch (err: any) {
      console.error("Transcription Error:", err);
      setError(err.message);
      toast.error(`Transcription failed: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatus("");
    }
  };

  const copyToClipboard = () => {
    if (!transcriptionData) return;
    const text = transcriptionData.segments.map(s => `[${s.timestamp}] ${s.speaker}: ${s.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast.success("Transcript copied to clipboard!");
  };

  const handleDownload = () => {
    if (!transcriptionData) return;
    const text = transcriptionData.segments.map(s => `[${s.timestamp}] ${s.speaker}: ${s.text}`).join('\n');
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${transcriptionData.title || "transcript"}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Transcript downloaded!");
  };

  const showLanguage = () => {
    if (transcriptionData?.detectedLanguage) {
      toast.info(`Detected Language: ${transcriptionData.detectedLanguage}`);
    }
  };

  const handleShare = async () => {
    if (!transcriptionData) return;
    const text = transcriptionData.segments.map(s => `[${s.timestamp}] ${s.speaker}: ${s.text}`).join('\n');
    if (navigator.share) {
      try {
        await navigator.share({
          title: transcriptionData.title,
          text: text,
        });
      } catch (err) {
        console.error("Error sharing:", err);
      }
    } else {
      copyToClipboard();
    }
  };

  return (
    <div className="min-h-screen bg-[#060813] text-white font-sans overflow-x-hidden flex">
      
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0a0d1f] border-r border-[#1e2338] p-6 flex flex-col justify-between transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:relative`}>
        <div className="space-y-8">
          <h1 className="text-2xl font-bold text-white">SnapScript</h1>
          <nav className="space-y-2">
            <button onClick={() => { setShowLibrary(false); setTranscriptionData(null); setIsSidebarOpen(false); setAudioUrl(null); setIsPlaying(false); }} className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${!showLibrary && !transcriptionData ? 'bg-[#6366f1]/20 text-[#6366f1]' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
              <LayoutDashboard size={20} /> Home
            </button>
            <button onClick={() => { fetchTranscripts(); setIsSidebarOpen(false); setAudioUrl(null); setIsPlaying(false); }} className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${showLibrary ? 'bg-[#6366f1]/20 text-[#6366f1]' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
              <FileText size={20} /> Library
            </button>
          </nav>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {isSidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen relative w-full max-w-full">
        
        {/* Header */}
        {!transcriptionData && !showLibrary ? (
          <header className="flex items-center p-3 md:hidden">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-white">
              <Menu size={22} />
            </button>
            <div className="flex-1 text-center text-2xl font-extrabold pr-10">SnapScript</div>
          </header>
        ) : transcriptionData ? (
          <header className="flex items-center justify-between p-3 bg-[#0a0d1f] border-b border-[#1e2338]">
            <div className="flex items-center gap-2">
              <button onClick={() => setTranscriptionData(null)} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="font-bold text-base truncate w-40 md:w-64">{transcriptionData.title || "Transcript"}</h1>
                <p className="text-[11px] text-zinc-400 flex items-center gap-1">
                  Transcription time...
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={handleShare} className="p-1.5 bg-[#1e2338] hover:bg-[#2a304d] rounded-lg transition-colors"><Share2 size={16} className="text-[#6366f1]" /></button>
              <button onClick={handleDownload} className="p-1.5 bg-[#6366f1] hover:bg-[#4f46e5] rounded-lg transition-colors"><Download size={16} /></button>
            </div>
          </header>
        ) : (
          <header className="flex items-center p-3 border-b border-[#1e2338] md:hidden">
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-white">
              <Menu size={22} />
            </button>
            <div className="flex-1 text-center text-lg font-bold pr-10">Library</div>
          </header>
        )}

        {/* Main Body */}
        <main className="flex-1 overflow-y-auto pb-32">
          <audio 
            ref={audioRef} 
            src={audioUrl || ""} 
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onEnded={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="hidden"
          />
          <div className="max-w-md md:max-w-2xl mx-auto w-full p-4">
            
            {showLibrary ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 mt-3">
                <h2 className="text-2xl font-bold hidden md:block">My Library</h2>
                <div className="grid gap-3">
                  {transcripts.map((t) => (
                    <div key={t.id} className="p-4 rounded-2xl flex justify-between items-center bg-[#0a0d1f] border border-[#1e2338] hover:border-[#6366f1]/50 transition-colors cursor-pointer" onClick={() => { 
                      setTranscriptionData(t); 
                      setShowLibrary(false); 
                      setAudioUrl("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3");
                      setCurrentTime(0);
                      setIsPlaying(false);
                    }}>
                      <div className="overflow-hidden pr-3">
                        <h3 className="text-base font-bold truncate">{t.title}</h3>
                        <p className="text-xs text-zinc-400 mt-1">{t.createdAt?.toDate().toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => deleteTranscript(t.id, e)} className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-colors">
                          <Trash2 size={16} />
                        </button>
                        <button className="px-3 py-1.5 text-sm bg-[#1e2338] text-[#6366f1] rounded-xl font-medium whitespace-nowrap">View</button>
                      </div>
                    </div>
                  ))}
                  {transcripts.length === 0 && (
                    <div className="text-center py-8 text-sm text-zinc-500">
                      No transcripts found. Start transcribing!
                    </div>
                  )}
                </div>
              </motion.div>
            ) : transcriptionData ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 mt-3">
                <div className="flex justify-center border-b border-[#1e2338] gap-4">
                  <button onClick={() => setResultTab("transcript")} className={`border-b-2 pb-2 px-4 font-semibold text-base transition-colors ${resultTab === "transcript" ? "border-[#6366f1] text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>Transcript</button>
                  <button onClick={() => setResultTab("summary")} className={`border-b-2 pb-2 px-4 font-semibold text-base transition-colors ${resultTab === "summary" ? "border-[#6366f1] text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>Summary</button>
                  <button onClick={() => setResultTab("mindmap")} className={`border-b-2 pb-2 px-4 font-semibold text-base transition-colors ${resultTab === "mindmap" ? "border-[#6366f1] text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>Mind Map</button>
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={showLanguage} className="p-2 bg-[#1e2338] rounded-xl text-[#6366f1] hover:bg-[#2a304d] transition-colors">
                    <Languages size={16} />
                  </button>
                  <button onClick={copyToClipboard} className="flex items-center gap-1.5 px-4 py-2 bg-[#a855f7] hover:bg-[#9333ea] rounded-full text-xs font-bold transition-colors">
                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                    {isCopied ? "Copied!" : "Copy Transcript"}
                  </button>
                </div>

                {resultTab === "transcript" && (
                  <div className="space-y-6 pb-8">
                    {transcriptionData.segments.map((s, i) => {
                      const isActive = i === activeIndex;
                      return (
                        <div 
                          key={i} 
                          ref={(el) => { segmentRefs.current[i] = el; }}
                          onClick={() => {
                            if (audioRef.current) {
                              audioRef.current.currentTime = timeToSeconds(s.timestamp);
                              audioRef.current.play().catch(() => {});
                            }
                          }}
                          className={`space-y-2 p-3 rounded-xl transition-all duration-300 cursor-pointer ${isActive ? 'bg-[#6366f1]/10 border border-[#6366f1]/30 scale-[1.02]' : 'border border-transparent hover:bg-white/5'}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${isActive ? 'bg-[#6366f1] text-white' : 'bg-[#ff6b00] text-black'}`}>
                              {s.speaker.charAt(0).toUpperCase() || "S"}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className={`font-medium text-sm transition-colors ${isActive ? 'text-[#6366f1]' : 'text-zinc-300'}`}>Speaker</span>
                              <span className={`text-xs transition-colors ${isActive ? 'text-[#6366f1]' : 'text-zinc-500'}`}>{s.timestamp}</span>
                            </div>
                          </div>
                          <p className={`pl-9 leading-relaxed text-[13px] whitespace-pre-wrap text-left transition-colors ${isActive ? 'text-white font-medium' : 'text-zinc-400'}`}>
                            {s.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {resultTab === "summary" && (
                  <div className="space-y-4 pb-8 px-2 text-zinc-300 leading-relaxed text-sm">
                    <div className="p-6 bg-[#0a0d1f] rounded-2xl border border-[#1e2338] shadow-lg">
                      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <FileText size={20} className="text-[#6366f1]" /> Executive Summary
                      </h3>
                      <p className="whitespace-pre-wrap">{transcriptionData.summary}</p>
                    </div>
                  </div>
                )}

                {resultTab === "mindmap" && (
                  <div className="space-y-4 pb-8 px-2 text-zinc-300 leading-relaxed text-sm">
                    <div className="p-6 bg-[#0a0d1f] rounded-2xl border border-[#1e2338] shadow-lg">
                      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Wand2 size={20} className="text-[#a855f7]" /> Key Concepts
                      </h3>
                      <div className="markdown-body prose prose-invert prose-sm max-w-none">
                        <Markdown>{transcriptionData.mindMap}</Markdown>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <div className="space-y-6 mt-4">
                <div className="text-center mb-2">
                  <h2 className="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-[#ff6b00] to-[#ffaa00] bg-clip-text text-transparent">
                    SnapScript
                  </h2>
                </div>
                {/* Tabs */}
                <div className="flex border-b border-[#1e2338]">
                  <button 
                    onClick={() => { setActiveTab("upload"); setSelectedFile(null); setUrl(""); }} 
                    className={`flex-1 pb-3 text-center font-semibold text-base transition-colors ${activeTab === "upload" ? "text-white border-b-2 border-[#6366f1]" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    Upload File
                  </button>
                  <button 
                    onClick={() => { setActiveTab("link"); setSelectedFile(null); setUrl(""); }} 
                    className={`flex-1 pb-3 text-center font-semibold text-base transition-colors ${activeTab === "link" ? "text-white border-b-2 border-[#6366f1]" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    Paste Link
                  </button>
                </div>

                {activeTab === "upload" ? (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <p className="text-center text-zinc-400 text-[13px] px-3">
                      Upload audio/video files from device to transcribe
                    </p>
                    <div className="border-2 border-dashed border-[#313856] rounded-3xl p-8 flex flex-col items-center justify-center min-h-[200px] bg-[#0a0d1f]/50 hover:bg-[#0a0d1f] transition-colors">
                      <input id="file-upload" type="file" className="hidden" accept="audio/*,video/*" onChange={handleFileChange} />
                      <button onClick={() => document.getElementById('file-upload')?.click()} className="bg-[#6366f1] hover:bg-[#4f46e5] text-white font-medium text-sm px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-[#6366f1]/20">
                        <Upload size={16} /> Upload a file
                      </button>
                      {selectedFile && <p className="mt-4 text-xs text-zinc-400 font-medium bg-[#1e2338] px-3 py-1.5 rounded-lg">{selectedFile.name}</p>}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <p className="text-center text-zinc-400 text-[13px] px-3">
                      Paste a media link to transcribe video or audio content.
                    </p>
                    
                    <div className="text-center space-y-4">
                      <p className="text-zinc-500 text-xs flex items-center justify-center gap-1.5">
                        <Link size={14} /> Supported platforms
                      </p>
                      <div className="flex justify-center flex-wrap gap-4 text-xl bg-[#0a0d1f] py-3 px-4 rounded-2xl border border-[#1e2338]">
                        <Youtube className="text-red-500 w-6 h-6" />
                        <Music className="text-white w-6 h-6" /> {/* TikTok approx */}
                        <Instagram className="text-pink-600 w-6 h-6" />
                        <Facebook className="text-blue-600 w-6 h-6" />
                        <div className="w-6 h-6 flex items-center justify-center font-bold text-lg text-white">X</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-zinc-400 ml-1">Media Link</label>
                      <div className="border-2 border-[#6366f1] rounded-2xl p-1 bg-white shadow-lg shadow-[#6366f1]/10 flex items-center">
                        <input 
                          type="text" 
                          placeholder="https://www.youtube.com/watch" 
                          value={url} 
                          onChange={(e) => setUrl(e.target.value)} 
                          className="flex-1 bg-transparent text-black px-3 py-2 outline-none text-base placeholder:text-zinc-400" 
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Fixed Bottom Elements */}
        {!transcriptionData && !showLibrary && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#060813] via-[#060813] to-transparent md:left-64">
            <div className="max-w-md md:max-w-2xl mx-auto">
              <button 
                onClick={handleTranscribe} 
                disabled={isLoading} 
                className="w-full bg-[#ff6b00] hover:bg-[#e66000] text-black font-bold py-3 rounded-2xl flex items-center justify-center gap-2 text-base shadow-xl shadow-[#ff6b00]/20 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : <Wand2 className="w-5 h-5" />}
                {isLoading ? status : "Transcribe"}
              </button>
              {error && <p className="text-red-400 text-xs text-center mt-2 bg-red-500/10 py-1.5 rounded-lg border border-red-500/20">{error}</p>}
            </div>
          </div>
        )}

        {transcriptionData && (
          <div className="fixed bottom-0 left-0 right-0 bg-[#0a0d1f] border-t border-[#1e2338] p-3 pb-4 md:left-64 z-30 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
            <div className="max-w-md md:max-w-2xl mx-auto flex items-center justify-between px-2">
              <span className="text-zinc-500 text-xs font-medium w-10 text-right">{formatTime(currentTime)}</span>
              <div className="flex items-center gap-6">
                <button onClick={skipBackward} className="text-[#6366f1] hover:text-[#4f46e5] transition-colors relative">
                  <RotateCcw size={22} />
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold mt-0.5">10</span>
                </button>
                <button 
                  onClick={togglePlay}
                  className={`w-12 h-12 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] flex items-center justify-center ${!isPlaying ? 'pl-1' : ''} shadow-lg shadow-[#6366f1]/30 transition-all transform hover:scale-105`}
                >
                  {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
                </button>
                <button onClick={skipForward} className="text-[#6366f1] hover:text-[#4f46e5] transition-colors relative">
                  <RotateCw size={22} />
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold mt-0.5">10</span>
                </button>
              </div>
              <span className="text-zinc-500 text-xs font-medium w-10">{formatTime(duration)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
