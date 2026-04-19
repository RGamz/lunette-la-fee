import { useState, useEffect, useRef, useCallback } from "react";

const SYSTEM_PROMPT = `Tu es Lunette, une petite fée magique qui apprend le français aux enfants russophones de 7-9 ans.

RÈGLES DE FORMAT — OBLIGATOIRES :
- Pas d'emojis, pas de symboles, pas de ponctuation décorative.
- Écris toujours le français correctement avec tous les accents : é, è, ê, ë, à, â, î, ô, û, ù, ç, œ, etc.
- Le bloc russe s'écrit EXACTEMENT ainsi, minuscules obligatoires : (по-русски: texte russe)
- Le bloc russe est TOUJOURS placé en fin de réponse, jamais au milieu.
- Le texte russe est toujours une phrase complète, jamais un mot seul.

QUAND UTILISER LE RUSSE :
- Par défaut : réponse en français uniquement, sans bloc russe.
- UNIQUEMENT si l'enfant dit "qu'est-ce que c'est" suivi d'un mot : réponds DIRECTEMENT avec le bloc russe uniquement, sans explication en français. Format : "(по-русски: Это слово означает [explication complète en russe].)" suivi d'une question en français.
- Seulement si tu corriges une erreur grammaticale : ajoute le bloc russe.
- Dans tous les autres cas, même si l'enfant semble confus, reste en français.

AUTRES RÈGLES :
- Phrases très courtes et simples en français : sujet + verbe + complément.
- Pose toujours une question à la fin.
- Thèmes : animaux, couleurs, école, famille, nourriture, jouets, rêves, magie.
- Sois enthousiaste, jamais sévère, jamais de sujets sensibles.

EXEMPLES :
Réponse normale : "Super ! Tu as un animal à la maison ?"
Enfant dit "qu'est-ce que c'est caresser" : "(по-русски: Это слово означает ласкать, то есть нежно трогать животное рукой, чтобы показать ему любовь.) Est-ce que ton chat aime quand tu le caresses ?"
Enfant dit "qu'est-ce que c'est manger" : "(по-русски: Это слово означает кушать, принимать пищу.) Tu aimes manger quoi ?"
Correction : "On dit 'je mange', sans s. (по-русски: С местоимением je глагол manger пишется без буквы s на конце.)"

Première réponse : présente-toi en français, puis ajoute un seul bloc russe pour expliquer ce que tu fais.`;

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ELEVENLABS_MODEL = "eleven_multilingual_v2";

async function callClaude(messages) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1000, system: SYSTEM_PROMPT, messages }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Erreur ${response.status}`);
  return data.content[0].text;
}

const FAIRY_EXPRESSIONS = {
  idle: "🪄",
  listening: "...",
  thinking: "?",
  speaking: ">",
  correcting: "!",
  happy: "*",
};

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

  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const conversationRef = useRef([]);

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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      const interim = Array.from(e.results).map(r => r[0].transcript).join("");
      setTranscript(interim);
      if (e.results[e.results.length - 1].isFinal) {
        const final = e.results[e.results.length - 1][0].transcript;
        handleUserMessage(final);
      }
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
  }, []);

  const speakSegment = useCallback(async (text) => {
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail?.message || err.detail || `ElevenLabs ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      await new Promise((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        audio.play();
      });
    } catch (err) {
      console.error("ElevenLabs TTS error:", err.message);
      throw err;
    }
  }, []);

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
      for (const seg of segments) {
        await speakSegment(seg);
      }
    } catch (err) {
      setMessages(prev => [...prev, { from: "fairy", text: `Erreur audio: ${err.message}`, hasCorrection: false }]);
    }

    setIsSpeaking(false);
    setFairyMood("happy");
  }, [speakSegment]);

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

  const toggleListening = () => {
    if (isSpeaking) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setIsSpeaking(false);
    }
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setTranscript("");
      setFairyMood("listening");
      if (recognitionRef.current) recognitionRef.current.lang = inputLang;
      try { recognitionRef.current?.start(); setIsListening(true); } catch { /* recognition unavailable */ }
    }
  };

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
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b4b 100%)",
      fontFamily: "'Nunito', 'Comic Sans MS', cursive",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "20px 16px",
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
        @keyframes twinkle { from { opacity: 0.2; transform: scale(0.8); } to { opacity: 0.9; transform: scale(1.3); } }
        @keyframes float { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-12px) rotate(2deg); } }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fairy-float { animation: float 3s ease-in-out infinite; }
        .msg-in { animation: slideIn 0.3s ease forwards; }
      `}</style>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 16, zIndex: 1 }}>
        <h1 style={{
          fontFamily: "'Baloo 2', cursive",
          fontSize: "clamp(1.6rem, 5vw, 2.4rem)",
          color: "#f9d71c",
          textShadow: "0 0 20px rgba(249,215,28,0.5), 0 2px 4px rgba(0,0,0,0.5)",
          margin: 0,
          letterSpacing: 1,
        }}>Lunette la Fée</h1>
        <p style={{ color: "#a78bfa", fontSize: "0.85rem", margin: "4px 0 0", opacity: 0.9 }}>
          Apprends le français avec magie · Учим французский с волшебством
        </p>
      </div>

      {/* Fairy avatar */}
      <div style={{ position: "relative", marginBottom: 16, zIndex: 1 }}>
        {(isListening || isSpeaking) && (
          <div style={{
            position: "absolute", inset: -16, borderRadius: "50%",
            border: `3px solid ${isListening ? "#34d399" : "#38bdf8"}`,
            animation: "pulse-ring 1s ease-out infinite",
          }} />
        )}
        <div className="fairy-float" style={{
          width: 100, height: 100, borderRadius: "50%",
          background: "radial-gradient(circle at 35% 35%, #a78bfa, #6d28d9)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 36, fontWeight: 900, color: "#f9d71c",
          boxShadow: "0 0 30px rgba(167,139,250,0.6), 0 4px 20px rgba(0,0,0,0.4)",
          border: "3px solid rgba(249,215,28,0.4)",
          letterSpacing: 2,
        }}>
          {FAIRY_EXPRESSIONS[fairyMood]}
        </div>
      </div>

      {/* Chat area */}
      <div style={{
        width: "100%", maxWidth: 520,
        flex: 1,
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(10px)",
        borderRadius: 24,
        border: "1px solid rgba(167,139,250,0.2)",
        padding: 16,
        minHeight: 220,
        maxHeight: 340,
        overflowY: "auto",
        zIndex: 1,
        marginBottom: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {!hasStarted && (
          <div style={{ textAlign: "center", margin: "auto", color: "rgba(167,139,250,0.7)", fontSize: "0.9rem" }}>
            Appuie sur le bouton pour rencontrer Lunette !<br />
            <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>Нажми кнопку, чтобы познакомиться с Люнетт!</span>
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
              maxWidth: "82%",
              background: msg.from === "user"
                ? "linear-gradient(135deg, #38bdf8, #0284c7)"
                : msg.hasCorrection
                  ? "linear-gradient(135deg, rgba(167,139,250,0.25), rgba(109,40,217,0.15))"
                  : "rgba(167,139,250,0.15)",
              borderRadius: msg.from === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              padding: "10px 14px",
              color: "#f1f5f9",
              fontSize: "0.9rem",
              lineHeight: 1.5,
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
          width: "100%", maxWidth: 520,
          background: "rgba(56,189,248,0.1)",
          border: "1px dashed rgba(56,189,248,0.3)",
          borderRadius: 12, padding: "8px 14px",
          color: "#7dd3fc", fontSize: "0.85rem",
          marginBottom: 12, zIndex: 1,
          textAlign: "center",
        }}>
          {transcript}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", zIndex: 1 }}>
        {!hasStarted ? (
          <button onClick={startConversation} style={{
            background: "linear-gradient(135deg, #f9d71c, #f59e0b)",
            border: "none", borderRadius: 50, padding: "14px 32px",
            fontSize: "1rem", fontWeight: 900, color: "#1a1040",
            cursor: "pointer", boxShadow: "0 4px 20px rgba(249,215,28,0.4)",
            fontFamily: "'Baloo 2', cursive",
            transition: "transform 0.15s",
          }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            Rencontrer Lunette !
          </button>
        ) : (
          <>
            {speechSupported ? (
              <button onClick={toggleListening} disabled={isThinking} style={{
                width: 72, height: 72,
                borderRadius: "50%",
                background: isListening
                  ? "linear-gradient(135deg, #34d399, #059669)"
                  : isSpeaking
                    ? "linear-gradient(135deg, #38bdf8, #0284c7)"
                    : "linear-gradient(135deg, #a78bfa, #6d28d9)",
                border: "none",
                fontSize: 14, fontWeight: 700, color: "#fff",
                cursor: isThinking ? "not-allowed" : "pointer",
                boxShadow: isListening
                  ? "0 0 25px rgba(52,211,153,0.6)"
                  : "0 4px 20px rgba(167,139,250,0.5)",
                transition: "all 0.2s",
                opacity: isThinking ? 0.5 : 1,
              }}>
                {isListening ? "STOP" : isSpeaking ? "..." : "MIC"}
              </button>
            ) : (
              <div style={{ color: "#fb7185", fontSize: "0.8rem", textAlign: "center", maxWidth: 200 }}>
                Micro non disponible.<br />Essaie sur Chrome ou Safari.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <button onClick={() => setInputLang(l => l === "fr-FR" ? "ru-RU" : "fr-FR")} disabled={isListening} style={{
                background: inputLang === "fr-FR" ? "rgba(56,189,248,0.2)" : "rgba(251,113,133,0.2)",
                border: `1px solid ${inputLang === "fr-FR" ? "#38bdf8" : "#fb7185"}`,
                borderRadius: 20, padding: "4px 12px",
                color: inputLang === "fr-FR" ? "#38bdf8" : "#fb7185",
                fontSize: "0.8rem", fontWeight: 700, cursor: isListening ? "not-allowed" : "pointer",
              }}>
                {inputLang === "fr-FR" ? "FR" : "RU"}
              </button>
              <div style={{ color: "rgba(167,139,250,0.7)", fontSize: "0.75rem", textAlign: "center" }}>
                {isListening ? "J'écoute..." : isSpeaking ? "Lunette parle..." : isThinking ? "Je réfléchis..." : "Appuie pour parler"}
              </div>
            </div>
          </>
        )}
      </div>

      {hasStarted && (
        <p style={{ color: "rgba(167,139,250,0.4)", fontSize: "0.7rem", marginTop: 16, textAlign: "center", zIndex: 1 }}>
          Parle en français · Говори по-французски · Lunette corrigera doucement
        </p>
      )}
    </div>
  );
}
