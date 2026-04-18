import { useState, useEffect, useRef, useCallback } from 'react';
import { WORDS } from '../../data/words';

interface Puck {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  color: string;
  isWordPuck: boolean;
  displayWord: string;
  targetAnswers: string[];
  helperText: string;
  isHittable: boolean;
}

interface LeaderEntry { name: string; score: number; }

type GameState = 'start' | 'playing' | 'gameover';

export function AirHockey() {
  const [gameState, setGameState] = useState<GameState>('start');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(5);
  const [micStatusText, setMicStatusText] = useState('🎤 מיקרופון כבוי');
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState('שמעתי: ...');
  const [playerName, setPlayerName] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('yonatan_hockey_scores') || '[]'); } catch { return []; }
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef(0);
  const isPlayingRef = useRef(false);

  const scoreRef = useRef(0);
  const livesRef = useRef(5);
  const gameSpeedRef = useRef(1);
  const pucksRef = useRef<Puck[]>([]);
  const playerRef = useRef({ x: 0, y: 0, radius: 30, color: '#0f172a', borderColor: '#38bdf8' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const isMicPausedRef = useRef(false);
  const currentMicLangRef = useRef<'he-IL' | 'en-US'>('he-IL');

  // ── mic setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionClass = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setMicStatusText('❌ מיקרופון לא נתמך');
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      const langText = currentMicLangRef.current === 'he-IL' ? 'עברית' : 'אנגלית';
      setMicStatusText(`🎤 מקשיב... (${langText})`);
      setIsListening(true);
      setLastHeard('שמעתי: ...');
    };

    recognition.onresult = (event: any) => {
      if (!isPlayingRef.current || isMicPausedRef.current) return;
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const clean = transcript.trim();
      if (clean) {
        setLastHeard(`שמעתי: "${clean}"`);
        checkSpokenWord(clean);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setMicStatusText('🎤 מיקרופון מושהה');
      if (isPlayingRef.current && !isMicPausedRef.current) {
        try { recognition.start(); } catch (_) {}
      }
    };

    recognition.onerror = (e: any) => console.log('Mic error:', e.error);

    return () => { recognitionRef.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchMicLanguage = useCallback((lang: 'he-IL' | 'en-US') => {
    if (currentMicLangRef.current !== lang) {
      currentMicLangRef.current = lang;
      if (recognitionRef.current) {
        recognitionRef.current.lang = lang;
        try { recognitionRef.current.stop(); } catch (_) {}
      }
    }
  }, []);

  const checkSpokenWord = useCallback((spokenWord: string) => {
    if (!isPlayingRef.current || isMicPausedRef.current) return;
    const clean = spokenWord.replace(/[.,!?]/g, '').trim().toLowerCase();
    let matched = false;
    pucksRef.current.forEach(p => {
      if (p.isWordPuck && !p.isHittable) {
        if (p.targetAnswers.some(a => clean.includes(a.toLowerCase()))) {
          p.isHittable = true;
          p.color = '#4ade80';
          matched = true;
        }
      }
    });
    if (matched) {
      setLastHeard('✔️ מעולה!');
      isMicPausedRef.current = true;
      setTimeout(() => {
        isMicPausedRef.current = false;
        if (isPlayingRef.current) setLastHeard('שמעתי: ...');
      }, 1000);
    }
  }, []);

  // ── spawn ──────────────────────────────────────────────────────────────────
  const spawnPuck = useCallback((canvas: HTMLCanvasElement) => {
    const radius = canvas.width * 0.08;
    const x = Math.random() * (canvas.width - radius * 2) + radius;
    const y = radius + 20;
    const angle = (Math.random() * 120 + 30) * (Math.PI / 180);
    const speed = (2.5 + Math.random() * 1.5) * gameSpeedRef.current;

    const wordData = WORDS[Math.floor(Math.random() * WORDS.length)];
    const isEnToHe = Math.random() > 0.5;
    const displayWord = isEnToHe ? wordData.en : wordData.he[0];
    const targetAnswers = isEnToHe ? wordData.he : [wordData.en.toLowerCase()];
    const requiredLang: 'he-IL' | 'en-US' = isEnToHe ? 'he-IL' : 'en-US';
    const helperText = isEnToHe ? 'תגיד בעברית:' : 'Say in English:';

    switchMicLanguage(requiredLang);

    pucksRef.current.push({
      x, y, radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: '#f97316',
      isWordPuck: true,
      displayWord, targetAnswers, helperText,
      isHittable: false,
    });
  }, [switchMicLanguage]);

  // ── draw ───────────────────────────────────────────────────────────────────
  const drawCircle = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number, radius: number,
    fillColor: string, strokeColor?: string
  ) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (strokeColor) { ctx.lineWidth = 4; ctx.strokeStyle = strokeColor; ctx.stroke(); }
    ctx.closePath();
  };

  const drawFrame = useCallback((canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // mid line
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.strokeStyle = 'rgba(15,23,42,0.1)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.15, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(15,23,42,0.1)';
    ctx.lineWidth = 4;
    ctx.stroke();

    pucksRef.current.forEach(p => {
      ctx.shadowBlur = 15;
      ctx.shadowColor = p.color;
      drawCircle(ctx, p.x, p.y, p.radius, p.color);
      ctx.shadowBlur = 0;
      drawCircle(ctx, p.x, p.y, p.radius * 0.5, 'rgba(255,255,255,0.2)');

      if (p.isWordPuck) {
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.font = `bold ${p.radius * 0.25}px Heebo,sans-serif`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(p.helperText, p.x, p.y - 5);
        ctx.font = `bold ${p.radius * 0.45}px Heebo,sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(p.displayWord, p.x, p.y + 5);
      }
    });

    const pl = playerRef.current;
    drawCircle(ctx, pl.x, pl.y, pl.radius, pl.color, pl.borderColor);
    drawCircle(ctx, pl.x, pl.y, pl.radius * 0.4, pl.borderColor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── physics ────────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    isPlayingRef.current = false;
    cancelAnimationFrame(requestRef.current);
    setGameState('gameover');
  }, []);

  const updatePhysics = useCallback((canvas: HTMLCanvasElement) => {
    scoreRef.current += 1;
    gameSpeedRef.current = Math.min(gameSpeedRef.current + 0.0002, 2.5);
    if (scoreRef.current % 10 === 0) setScore(Math.floor(scoreRef.current / 10));

    if (pucksRef.current.length === 0) spawnPuck(canvas);

    for (let i = pucksRef.current.length - 1; i >= 0; i--) {
      const p = pucksRef.current[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x - p.radius <= 0)               { p.x = p.radius;              p.vx *= -1; }
      else if (p.x + p.radius >= canvas.width) { p.x = canvas.width - p.radius; p.vx *= -1; }

      if (p.y - p.radius <= 0) {
        if (p.isHittable) {
          pucksRef.current.splice(i, 1);
          scoreRef.current += 1000;
          setScore(Math.floor(scoreRef.current / 10));
          setTimeout(() => { if (isPlayingRef.current && pucksRef.current.length === 0) spawnPuck(canvas); }, 300);
          continue;
        } else { p.y = p.radius; p.vy *= -1; }
      }

      if (p.y + p.radius >= canvas.height) {
        livesRef.current -= 1;
        setLives(livesRef.current);
        pucksRef.current.splice(i, 1);
        if (livesRef.current <= 0) { endGame(); }
        else { setTimeout(() => { if (isPlayingRef.current && pucksRef.current.length === 0) spawnPuck(canvas); }, 500); }
        continue;
      }

      const pl = playerRef.current;
      const dx = p.x - pl.x, dy = p.y - pl.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < p.radius + pl.radius) {
        if (!p.isHittable) continue;
        const angle = Math.atan2(dy, dx);
        const overlap = (p.radius + pl.radius) - dist;
        p.x += Math.cos(angle) * overlap;
        p.y += Math.sin(angle) * overlap;
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        p.vx = Math.cos(angle) * spd * 1.05;
        p.vy = -Math.abs(Math.sin(angle) * spd * 1.05);
      }
    }
  }, [spawnPuck, endGame]);

  // ── game loop ──────────────────────────────────────────────────────────────
  const gameLoop = useCallback(() => {
    if (!isPlayingRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    updatePhysics(canvas);
    drawFrame(canvas, ctx);
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [updatePhysics, drawFrame]);

  // ── start / end ────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.8, 600);
    canvas.width = size;
    canvas.height = size * 1.3;
    playerRef.current.radius = canvas.width * 0.08;
    playerRef.current.x = canvas.width / 2;
    playerRef.current.y = canvas.height - playerRef.current.radius - 20;

    scoreRef.current = 0; livesRef.current = 5; gameSpeedRef.current = 1;
    pucksRef.current = []; isMicPausedRef.current = false;
    setScore(0); setLives(5); setPlayerName('');
    setGameState('playing');
    isPlayingRef.current = true;

    try { recognitionRef.current?.start(); } catch (_) {}
    spawnPuck(canvas);
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [spawnPuck, gameLoop]);

  // ── pointer ────────────────────────────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isPlayingRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const pl = playerRef.current;
    pl.x = Math.max(pl.radius, Math.min(canvas.width - pl.radius, clientX - rect.left));
    pl.y = Math.max(canvas.height / 2, Math.min(canvas.height - pl.radius, clientY - rect.top));
  }, []);

  useEffect(() => {
    const prevent = (e: TouchEvent) => { if (isPlayingRef.current) e.preventDefault(); };
    document.body.addEventListener('touchmove', prevent, { passive: false });
    return () => document.body.removeEventListener('touchmove', prevent);
  }, []);

  useEffect(() => () => { cancelAnimationFrame(requestRef.current); recognitionRef.current?.stop(); }, []);

  // ── resize handler ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !isPlayingRef.current) return;
      const size = Math.min(window.innerWidth * 0.9, window.innerHeight * 0.8, 600);
      canvas.width = size;
      canvas.height = size * 1.3;
      const pl = playerRef.current;
      pl.radius = canvas.width * 0.08;
      // keep player in lower half after resize
      pl.x = Math.min(pl.x, canvas.width  - pl.radius);
      pl.y = Math.max(canvas.height / 2, Math.min(canvas.height - pl.radius, pl.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── save score ─────────────────────────────────────────────────────────────
  const handleSaveScore = useCallback(() => {
    const name = playerName.trim() || 'שחקן אנונימי';
    const finalScore = Math.floor(scoreRef.current / 10);
    const updated = [...leaderboard, { name, score: finalScore }].sort((a, b) => b.score - a.score).slice(0, 10);
    setLeaderboard(updated);
    localStorage.setItem('yonatan_hockey_scores', JSON.stringify(updated));
    setGameState('start');
  }, [playerName, leaderboard]);

  return (
    <div dir="rtl" className="flex justify-center items-center h-screen w-full bg-slate-800 text-white font-sans overflow-hidden">
      <div className="relative shadow-2xl rounded-xl overflow-hidden bg-slate-200" style={{ width: '90vw', maxWidth: '600px', aspectRatio: '1/1.3' }}>

        <canvas
          ref={canvasRef}
          onMouseMove={handlePointerMove}
          onTouchMove={handlePointerMove}
          className="block w-full h-full border-[10px] border-slate-900 border-b-red-500 rounded-xl box-border touch-none"
        />

        {/* HUD */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-5 box-border">
          <div className="flex justify-between text-2xl font-bold text-slate-900 drop-shadow-md">
            <span>ניקוד: {score}</span>
            <span>חיים: {'❤️'.repeat(lives)}</span>
          </div>
          <div className="absolute top-16 right-5 text-right">
            <div className={`text-lg px-3 py-1 rounded-full bg-slate-900/70 transition-colors ${isListening ? 'text-green-400' : 'text-white'}`}>
              {micStatusText}
            </div>
            {gameState === 'playing' && (
              <div className="mt-2 text-lg bg-black/60 text-amber-300 px-3 py-1 rounded-lg">
                {lastHeard}
              </div>
            )}
          </div>
        </div>

        {/* Overlay menus */}
        {gameState !== 'playing' && (
          <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex flex-col justify-center items-center pointer-events-auto z-10 p-6 text-center">

            {gameState === 'start' && (
              <>
                <h1 className="text-5xl font-bold text-sky-400 drop-shadow-[0_0_10px_rgba(56,189,248,0.5)] mb-4">הוקי אוויר חכם</h1>
                <p className="text-xl mb-8">אתה השוער. הגן על השער!<br/>תרגם מילים בין אנגלית לעברית כדי להדוף דיסקיות.</p>
                {leaderboard.length > 0 && (
                  <div className="bg-black/40 p-4 rounded-lg w-full max-w-xs mb-6">
                    <h2 className="text-amber-300 text-xl font-bold mb-3">טבלת מובילים</h2>
                    <ol className="text-lg text-right list-decimal list-inside space-y-1">
                      {leaderboard.slice(0, 5).map((entry, idx) => (
                        <li key={idx} className="border-b border-white/10 pb-1">{entry.name} - {entry.score} נק'</li>
                      ))}
                    </ol>
                  </div>
                )}
                <button onClick={startGame} className="px-8 py-3 bg-sky-400 text-slate-900 font-bold text-2xl rounded-full hover:scale-105 hover:bg-sky-300 transition-all shadow-lg shadow-sky-400/40">
                  התחל משחק
                </button>
              </>
            )}

            {gameState === 'gameover' && (
              <>
                <h1 className="text-5xl font-bold text-red-500 mb-4">המשחק נגמר!</h1>
                <p className="text-xl mb-6">השגת <b>{Math.floor(scoreRef.current / 10)}</b> נקודות.</p>
                <div className="flex flex-col items-center w-full max-w-xs">
                  <input
                    type="text" value={playerName}
                    onChange={e => setPlayerName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveScore()}
                    placeholder="הכנס את שמך"
                    className="w-full p-3 text-xl text-center text-slate-900 rounded-xl mb-4 border-none outline-none"
                    autoFocus
                  />
                  <button onClick={handleSaveScore} className="px-6 py-2 bg-sky-400 text-slate-900 font-bold text-xl rounded-full hover:scale-105 hover:bg-sky-300 transition-all">
                    שמור וצפה בטבלה
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
