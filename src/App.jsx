import { useState, useEffect, useRef, useCallback } from "react";
import { SYSTEM_PROMPT } from "./prompt.js";

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_SPEED = 0.8;
const MAX_RECORD_SECONDS = 15; // ✅ auto-stop timeout

async function callClaude(messages) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1000, system: SYSTEM_PROMPT, messages }),
  });
  const text = await response.text();
  if (!text) throw new Error(`Erreur serveur ${response.status} (réponse vide)`);
  const data = JSON.parse(text);
  if (!response.ok) throw new Error(data.error?.message || `Erreur ${response.status}`);
  return data.content[0].text;
}

const FAIRY_EXPRESSIONS = {
  idle: "🪄",
  listening: "👂",
  thinking: "🤔",
  speaking: "🎤",
  correcting: "✏️",
  happy: "✨",
};

// ✅ SVG icons — child-friendly, no cryptic labels
const IconMic = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="32" height="32">
    <rect x="9" y="2" width="6" height="12" rx="3"/>
    <path d="M5 10a7 7 0 0 0 14 0"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="8" y1="22" x2="16" y2="22"/>
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <rect x="5" y="5" width="14" height="14" rx="2"/>
  </svg>
);

const IconCancel = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="26" height="26">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconReplay = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
  </svg>
);

// ✅ Waveform component — reads live analyser data
function Waveform({ analyserRef, isActive }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!isActive || !analyserRef.current) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const BAR_COUNT = 18;
    const BAR_GAP = 3;

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barW = (canvas.width - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        // sample evenly across frequency bins, bias toward lower freqs (voice)
        const idx = Math.floor((i / BAR_COUNT) * (bufferLength * 0.4));
        const v = dataArray[idx] / 255;
        const barH = Math.max(4, v * canvas.height * 0.9);
        const x = i * (barW + BAR_GAP);
        const y = (canvas.height - barH) / 2;
        const alpha = 0.5 + v * 0.5;
        ctx.fillStyle = `rgba(52, 211, 153, ${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 3);
        ctx.fill();
      }
    }
    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isActive, analyserRef]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={44}
      style={{
        borderRadius: 12,
        background: "rgba(52,211,153,0.08)",
        border: "1px solid rgba(52,211,153,0.2)",
        display: "block",
      }}
    />
  );
}

export default function FeeFrancaise() {
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [fairyMood, setFairyMood] = useState("idle");
  const [hasStarted, setHasStarted] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [particles, setParticles] = useState([]);
  const [inputLang, setInputLang] = useState("fr-FR");
  const [recordSeconds, setRecordSeconds] = useState(0); // ✅ countdown display

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const cancelRecordingRef = useRef(false);
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const conversationRef = useRef([]);
  const lastAudioBlobsRef = useRef([]);
  const analyserRef = useRef(null);          // ✅ Web Audio analyser
  const audioCtxRef = useRef(null);          // ✅ AudioContext
  const timeoutRef = useRef(null);           // ✅ auto-stop timeout
  const countdownRef = useRef(null);         // ✅ countdown interval

  useEffect(() => {
    const p = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 6 + 3,
      delay: Math.random() * 4,
      duration: Math.random() * 3 + 2,
    }));
    setParticles(p);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) setSpeechSupported(false);
  }, []);

  // ✅ Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
      clearInterval(countdownRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  const playBlob = useCallback((blob) => {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play();
    });
  }, []);

  const fetchSegmentBlob = useCallback(async (text) => {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        speed: ELEVENLABS_SPEED,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail?.message || err.detail || `ElevenLabs ${response.status}`);
    }
    return response.blob();
  }, []);

  const replayLast = useCallback(async () => {
    if (!lastAudioBlobsRef.current.length || isSpeaking) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setIsSpeaking(true);
    setFairyMood("speaking");
    for (const blob of lastAudioBlobsRef.current) {
      await playBlob(blob);
    }
    setIsSpeaking(false);
    setFairyMood("happy");
  }, [isSpeaking, playBlob]);

  const speak = useCallback(async (text) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setIsSpeaking(true);
    setFairyMood("speaking");

    const segments = [];
    const pattern = /\(по-русски:(.*?)\)/gis;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const frPart = text.slice(lastIndex, match.index).trim();
      if (frPart) segments.push(frPart);
      const ruPart = match[1].trim();
      if (ruPart) segments.push(ruPart);
      lastIndex = match.index + match[0].length;
    }
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push(remaining);

    try {
      const blobs = await Promise.all(segments.map(fetchSegmentBlob));
      lastAudioBlobsRef.current = blobs;
      for (const blob of blobs) {
        await playBlob(blob);
      }
    } catch (err) {
      setMessages(prev => [...prev, { from: "fairy", text: `Erreur audio: ${err.message}`, hasCorrection: false }]);
    }

    setIsSpeaking(false);
    setFairyMood("happy");
  }, [fetchSegmentBlob, playBlob]);

  const handleUserMessage = useCallback(async (text) => {
    if (!text.trim()) return;
    setTranscript("");
    setIsThinking(true);
    setFairyMood("thinking");

    const userMsg = { role: "user", content: text };
    const newHistory = [...conversationRef.current, userMsg];
    conversationRef.current = newHistory;

    setMessages(prev => [...prev, { from: "user", text }]);

    try {
      const reply = await callClaude(newHistory);
      const assistantMsg = { role: "assistant", content: reply };
      conversationRef.current = [...newHistory, assistantMsg];
      const hasCorrection = reply.includes("по-русски") || reply.includes("On dit");
      setFairyMood(hasCorrection ? "correcting" : "happy");
      setMessages(prev => [...prev, { from: "fairy", text: reply, hasCorrection }]);
      setIsThinking(false);
      await speak(reply);
    } catch (err) {
      setIsThinking(false);
      setFairyMood("idle");
      setMessages(prev => [...prev, { from: "fairy", text: `Erreur: ${err.message}`, hasCorrection: false }]);
    }
  }, [speak]);

  const startConversation = async () => {
    setHasStarted(true);
    setIsThinking(true);
    setFairyMood("thinking");
    try {
      const reply = await callClaude([{ role: "user", content: "Bonjour !" }]);
      conversationRef.current = [
        { role: "user", content: "Bonjour !" },
        { role: "assistant", content: reply },
      ];
      setMessages([{ from: "fairy", text: reply, hasCorrection: false }]);
      setIsThinking(false);
      setFairyMood("happy");
      await speak(reply);
    } catch (err) {
      setIsThinking(false);
      setFairyMood("idle");
      setMessages([{ from: "fairy", text: `Erreur: ${err.message}`, hasCorrection: false }]);
    }
  };

  const transcribeAudio = useCallback(async (blob) => {
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const langCode = inputLang === "fr-FR" ? "fr" : "ru";
    const form = new FormData();
    form.append("file", blob, `audio.${ext}`);
    form.append("model_id", "scribe_v1");
    form.append("language_code", langCode);
    const response = await fetch("/api/stt", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail?.message || data.detail || `STT ${response.status}`);
    return data.text?.trim() || "";
  }, [inputLang]);

  // ✅ Shared stop logic — used by button, auto-timeout, and cancel
  const stopRecording = useCallback((cancel = false) => {
    clearTimeout(timeoutRef.current);
    clearInterval(countdownRef.current);
    setRecordSeconds(0);

    // Disconnect Web Audio analyser
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (cancel) cancelRecordingRef.current = true;
    recorder.stop();
    recorder.stream.getTracks().forEach(t => t.stop());
    setIsListening(false);
    if (cancel) setFairyMood("idle");
  }, []);

  const toggleListening = useCallback(async () => {
    if (isSpeaking) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setIsSpeaking(false);
    }

    if (isListening) {
      stopRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // ✅ Setup Web Audio analyser for waveform
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;

        const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
        const recorder = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];
        cancelRecordingRef.current = false;

        recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        recorder.onstop = async () => {
          // Cleanup audio context
          analyserRef.current = null;
          if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
          }

          if (cancelRecordingRef.current) {
            cancelRecordingRef.current = false;
            setTranscript("");
            return;
          }
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          setTranscript("...");
          try {
            const text = await transcribeAudio(blob);
            setTranscript("");
            if (text) handleUserMessage(text);
          } catch (err) {
            setTranscript("");
            setMessages(prev => [...prev, { from: "fairy", text: `Erreur transcription: ${err.message}`, hasCorrection: false }]);
          }
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
        setIsListening(true);
        setFairyMood("listening");
        setTranscript("");
        setRecordSeconds(MAX_RECORD_SECONDS);

        // ✅ Countdown display
        countdownRef.current = setInterval(() => {
          setRecordSeconds(s => Math.max(0, s - 1));
        }, 1000);

        // ✅ Auto-stop after MAX_RECORD_SECONDS
        timeoutRef.current = setTimeout(() => {
          clearInterval(countdownRef.current);
          setRecordSeconds(0);
          stopRecording(false);
        }, MAX_RECORD_SECONDS * 1000);

      } catch {
        setSpeechSupported(false);
      }
    }
  }, [isListening, isSpeaking, stopRecording, transcribeAudio, handleUserMessage]);

  const formatMessage = (text) => {
    const parts = text.split(/(\(по-русски:.*?\))/gs);
    return parts.map((part, i) => {
      if (part.startsWith("(по-русски:")) {
        const inner = part.slice(1, -1);
        return <span key={i} style={{ display: "block", marginTop: 6, fontSize: "0.82em", color: "#a78bfa", fontStyle: "italic", background: "rgba(167,139,250,0.1)", borderRadius: 8, padding: "4px 8px" }}>{inner}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div style={{
      height: "100dvh",
      background: "linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b4b 100%)",
      fontFamily: "'Nunito', 'Comic Sans MS', cursive",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "clamp(12px, 3vw, 20px) clamp(12px, 4vw, 20px)",
      paddingTop: "max(clamp(12px, 3vw, 20px), env(safe-area-inset-top))",
      position: "relative",
      overflow: "hidden",
    }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: "fixed",
          left: `${p.x}%`,
          top: `${p.y}%`,
          width: p.size,
          height: p.size,
          borderRadius: "50%",
          background: ["#f9d71c", "#a78bfa", "#38bdf8", "#fb7185", "#34d399"][p.id % 5],
          opacity: 0.6,
          animation: `twinkle ${p.duration}s ${p.delay}s infinite alternate`,
          pointerEvents: "none",
        }} />
      ))}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&family=Baloo+2:wght@700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; overscroll-behavior: none; }
        @keyframes twinkle { from { opacity: 0.2; transform: scale(0.8); } to { opacity: 0.9; transform: scale(1.3); } }
        @keyframes float { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-12px) rotate(2deg); } }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes countdown-shrink { from { width: 100%; } to { width: 0%; } }
        .fairy-float { animation: float 3s ease-in-out infinite; }
        .msg-in { animation: slideIn 0.3s ease forwards; }
        .chat-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; }
        button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
        .avatar {
          width: clamp(72px, 16vw, 100px);
          height: clamp(72px, 16vw, 100px);
          font-size: clamp(24px, 6vw, 36px);
        }
        .mic-btn {
          width: clamp(72px, 20vw, 88px);
          height: clamp(72px, 20vw, 88px);
        }
        .secondary-btn {
          width: clamp(52px, 14vw, 64px);
          height: clamp(52px, 14vw, 64px);
        }
        .controls-bar {
          padding-bottom: max(16px, env(safe-area-inset-bottom));
        }
        .icon-btn:active { transform: scale(0.92); }
      `}</style>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: "clamp(8px, 2vw, 16px)", zIndex: 1, flexShrink: 0 }}>
        <h1 style={{
          fontFamily: "'Baloo 2', cursive",
          fontSize: "clamp(1.4rem, 5vw, 2.4rem)",
          color: "#f9d71c",
          textShadow: "0 0 20px rgba(249,215,28,0.5), 0 2px 4px rgba(0,0,0,0.5)",
          margin: 0,
          letterSpacing: 1,
        }}>Lunette la Fée</h1>
        <p style={{ color: "#a78bfa", fontSize: "clamp(0.7rem, 2.5vw, 0.85rem)", margin: "4px 0 0", opacity: 0.9 }}>
          Apprends le français avec magie · Учим французский с волшебством
        </p>
      </div>

      {/* Fairy avatar */}
      <div style={{ position: "relative", marginBottom: "clamp(8px, 2vw, 16px)", zIndex: 1, flexShrink: 0 }}>
        {(isListening || isSpeaking) && (
          <div style={{
            position: "absolute", inset: -12, borderRadius: "50%",
            border: `3px solid ${isListening ? "#34d399" : "#38bdf8"}`,
            animation: "pulse-ring 1s ease-out infinite",
          }} />
        )}
        <div className="fairy-float avatar" style={{
          borderRadius: "50%",
          background: "radial-gradient(circle at 35% 35%, #a78bfa, #6d28d9)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 900, color: "#f9d71c",
          boxShadow: "0 0 30px rgba(167,139,250,0.6), 0 4px 20px rgba(0,0,0,0.4)",
          border: "3px solid rgba(249,215,28,0.4)",
          letterSpacing: 2,
        }}>
          {FAIRY_EXPRESSIONS[fairyMood]}
        </div>
      </div>

      {/* Chat area */}
      <div className="chat-scroll" style={{
        width: "100%", maxWidth: 600,
        flex: 1,
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(10px)",
        borderRadius: 20,
        border: "1px solid rgba(167,139,250,0.2)",
        padding: "12px 14px",
        zIndex: 1,
        marginBottom: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {!hasStarted && (
          <div style={{ textAlign: "center", margin: "auto", color: "rgba(167,139,250,0.7)", fontSize: "clamp(0.8rem, 3vw, 0.9rem)", padding: "16px 0" }}>
            Appuie sur le bouton pour rencontrer Lunette !<br />
            <span style={{ fontSize: "clamp(0.7rem, 2.5vw, 0.8rem)", opacity: 0.7 }}>Нажми кнопку, чтобы познакомиться с Люнетт!</span>
          </div>
        )}
        {isThinking && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              background: "rgba(167,139,250,0.15)", borderRadius: "18px 18px 18px 4px",
              padding: "10px 14px", display: "flex", gap: 5, alignItems: "center",
            }}>
              {[0,1,2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#a78bfa",
                  animation: `twinkle 0.8s ${i * 0.2}s infinite alternate`,
                }} />
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="msg-in" style={{
            display: "flex",
            justifyContent: msg.from === "user" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "85%",
              background: msg.from === "user"
                ? "linear-gradient(135deg, #38bdf8, #0284c7)"
                : msg.hasCorrection
                  ? "linear-gradient(135deg, rgba(167,139,250,0.25), rgba(109,40,217,0.15))"
                  : "rgba(167,139,250,0.15)",
              borderRadius: msg.from === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              padding: "10px 14px",
              color: "#f1f5f9",
              fontSize: "clamp(0.85rem, 3vw, 0.95rem)",
              lineHeight: 1.55,
              border: msg.hasCorrection ? "1px solid rgba(167,139,250,0.3)" : "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            }}>
              {msg.from === "fairy" ? formatMessage(msg.text) : msg.text}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Transcript */}
      {transcript && (
        <div style={{
          width: "100%", maxWidth: 600,
          background: "rgba(56,189,248,0.1)",
          border: "1px dashed rgba(56,189,248,0.3)",
          borderRadius: 12, padding: "8px 14px",
          color: "#7dd3fc", fontSize: "clamp(0.78rem, 2.5vw, 0.85rem)",
          marginBottom: 10, zIndex: 1,
          textAlign: "center", flexShrink: 0,
        }}>
          {transcript}
        </div>
      )}

      {/* ✅ Waveform + countdown bar — visible only while recording */}
      {isListening && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 6, marginBottom: 10, zIndex: 1, flexShrink: 0,
          width: "100%", maxWidth: 600,
        }}>
          <Waveform analyserRef={analyserRef} isActive={isListening} />
          {/* ✅ Countdown progress bar */}
          <div style={{
            width: "100%", height: 4, borderRadius: 2,
            background: "rgba(52,211,153,0.15)",
            overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              background: "linear-gradient(90deg, #34d399, #059669)",
              borderRadius: 2,
              animation: `countdown-shrink ${MAX_RECORD_SECONDS}s linear forwards`,
            }} />
          </div>
          <span style={{ color: "rgba(52,211,153,0.7)", fontSize: "0.75rem" }}>
            {recordSeconds}s
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="controls-bar" style={{ display: "flex", gap: 14, alignItems: "center", zIndex: 1, flexShrink: 0 }}>
        {!hasStarted ? (
          <button onClick={startConversation} style={{
            background: "linear-gradient(135deg, #f9d71c, #f59e0b)",
            border: "none", borderRadius: 50, padding: "clamp(12px, 3vw, 16px) clamp(24px, 6vw, 36px)",
            fontSize: "clamp(0.95rem, 3vw, 1.05rem)", fontWeight: 900, color: "#1a1040",
            cursor: "pointer", boxShadow: "0 4px 20px rgba(249,215,28,0.4)",
            fontFamily: "'Baloo 2', cursive",
            transition: "transform 0.15s",
          }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
            onTouchEnd={e => e.currentTarget.style.transform = "scale(1)"}
          >
            Rencontrer Lunette !
          </button>
        ) : (
          <>
            {speechSupported ? (
              <>
                {/* ✅ Main mic button — bigger, SVG icon */}
                <button
                  onClick={toggleListening}
                  disabled={isThinking}
                  className="mic-btn icon-btn"
                  title={isListening ? "Envoyer" : isSpeaking ? "En train de parler…" : "Parler"}
                  style={{
                    borderRadius: "50%",
                    background: isListening
                      ? "linear-gradient(135deg, #34d399, #059669)"
                      : isSpeaking
                        ? "linear-gradient(135deg, #38bdf8, #0284c7)"
                        : "linear-gradient(135deg, #a78bfa, #6d28d9)",
                    border: "none",
                    color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: isThinking ? "not-allowed" : "pointer",
                    boxShadow: isListening
                      ? "0 0 28px rgba(52,211,153,0.6)"
                      : "0 4px 20px rgba(167,139,250,0.5)",
                    transition: "all 0.2s",
                    opacity: isThinking ? 0.5 : 1,
                  }}
                >
                  {isListening ? <IconStop /> : <IconMic />}
                </button>

                {/* ✅ Cancel button — only while recording */}
                {isListening && (
                  <button
                    onClick={() => stopRecording(true)}
                    className="secondary-btn icon-btn"
                    title="Annuler"
                    style={{
                      borderRadius: "50%",
                      background: "rgba(251,113,133,0.15)",
                      border: "2px solid rgba(251,113,133,0.5)",
                      color: "#fb7185",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    <IconCancel />
                  </button>
                )}

                {/* ✅ Replay button — only when not recording */}
                {!isListening && lastAudioBlobsRef.current.length > 0 && (
                  <button
                    onClick={replayLast}
                    disabled={isListening || isThinking || isSpeaking}
                    className="secondary-btn icon-btn"
                    title="Réécouter"
                    style={{
                      borderRadius: "50%",
                      background: "rgba(249,215,28,0.15)",
                      border: "2px solid rgba(249,215,28,0.4)",
                      color: "#f9d71c",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: (isListening || isThinking || isSpeaking) ? "not-allowed" : "pointer",
                      opacity: (isListening || isThinking || isSpeaking) ? 0.4 : 1,
                      transition: "all 0.2s",
                    }}
                  >
                    <IconReplay />
                  </button>
                )}
              </>
            ) : (
              <div style={{ color: "#fb7185", fontSize: "0.8rem", textAlign: "center", maxWidth: 200 }}>
                Micro non disponible.<br />Essaie sur Chrome ou Safari.
              </div>
            )}

            {/* ✅ FR/RU toggle */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setInputLang(l => l === "fr-FR" ? "ru-RU" : "fr-FR")}
                disabled={isListening}
                style={{
                  background: inputLang === "fr-FR" ? "rgba(56,189,248,0.2)" : "rgba(251,113,133,0.2)",
                  border: `1px solid ${inputLang === "fr-FR" ? "#38bdf8" : "#fb7185"}`,
                  borderRadius: 20, padding: "6px 16px",
                  color: inputLang === "fr-FR" ? "#38bdf8" : "#fb7185",
                  fontSize: "clamp(0.8rem, 2.5vw, 0.85rem)", fontWeight: 700,
                  cursor: isListening ? "not-allowed" : "pointer",
                  minHeight: 36,
                  transition: "all 0.2s",
                }}
              >
                {inputLang === "fr-FR" ? "🇫🇷 FR" : "🇷🇺 RU"}
              </button>
              <div style={{ color: "rgba(167,139,250,0.7)", fontSize: "clamp(0.65rem, 2vw, 0.75rem)", textAlign: "center" }}>
                {isListening
                  ? `J'écoute… (${recordSeconds}s)`
                  : transcript === "..."
                    ? "Transcription..."
                    : isSpeaking
                      ? "Lunette parle…"
                      : isThinking
                        ? "Je réfléchis…"
                        : "Appuie pour parler"}
              </div>
            </div>
          </>
        )}
      </div>

      {hasStarted && (
        <p style={{ color: "rgba(167,139,250,0.4)", fontSize: "clamp(0.6rem, 2vw, 0.7rem)", margin: "10px 0 0", textAlign: "center", zIndex: 1, flexShrink: 0 }}>
          Parle en français · Говори по-французски · Lunette corrigera doucement
        </p>
      )}
    </div>
  );
}
