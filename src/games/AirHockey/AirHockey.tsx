import { useState, useEffect, useRef, useCallback } from 'react';
import { WORDS } from '../../data/words';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

// ── types ──────────────────────────────────────────────────────────────────
interface Puck {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  color: string;
  displayWord: string;
  targetAnswers: string[];
  helperText: string;
  isHittable: boolean;
  glowT: number;
}
interface LeaderEntry { name: string; score: number; difficulty: string; }
type GameState = 'start' | 'learn' | 'playing' | 'gameover';
type Difficulty = 'easy' | 'medium' | 'hard';

// ── difficulty ─────────────────────────────────────────────────────────────
const DIFF = {
  easy:   { base: 1.4, max: 2.2, ramp: 0.00006, label: 'קל',     neon: '#4ade80' },
  medium: { base: 2.6, max: 4.0, ramp: 0.00018, label: 'בינוני', neon: '#facc15' },
  hard:   { base: 4.2, max: 6.5, ramp: 0.00038, label: 'קשה',    neon: '#f97316' },
} as const;

const isMob  = () => window.innerWidth < 768;
const NEON   = ['#ff6b35','#bf5af2','#00d4ff','#ff2d7e','#ffd60a','#06ffa5'];
const rNeon  = () => NEON[Math.floor(Math.random() * NEON.length)];
const LS_KEY = 'yonatan_hockey_v2';

// ── multi-line text helper ─────────────────────────────────────────────────
function drawPuckText(
  ctx: CanvasRenderingContext2D,
  word: string, helper: string,
  x: number, y: number, radius: number,
  unlocked: boolean
) {
  ctx.save();
  ctx.textAlign = 'center';

  // helper label (small, above)
  ctx.font = `${radius * 0.23}px Heebo,system-ui,sans-serif`;
  ctx.fillStyle = unlocked ? '#a7f3d0' : 'rgba(255,255,255,0.40)';
  ctx.fillText(helper, x, y - radius * 0.50);

  // word — try to fit on one line, wrap if needed
  ctx.fillStyle = unlocked ? '#052e16' : '#ffffff';
  ctx.shadowBlur  = 6;
  ctx.shadowColor = unlocked ? '#06ffa5' : '#fff';

  const maxWidth = radius * 1.55;
  let fontSize   = radius * 0.50;
  ctx.font = `bold ${fontSize}px Heebo,system-ui,sans-serif`;

  if (ctx.measureText(word).width > maxWidth) {
    // try smaller font first
    fontSize = radius * 0.38;
    ctx.font = `bold ${fontSize}px Heebo,system-ui,sans-serif`;

    if (ctx.measureText(word).width > maxWidth) {
      // wrap into two lines at the natural space
      const parts = word.split(' ');
      if (parts.length >= 2) {
        const mid   = Math.ceil(parts.length / 2);
        const line1 = parts.slice(0, mid).join(' ');
        const line2 = parts.slice(mid).join(' ');
        const lh    = fontSize * 1.15;
        ctx.textBaseline = 'middle';
        ctx.fillText(line1, x, y - lh / 2 + 4);
        ctx.fillText(line2, x, y + lh / 2 + 4);
        ctx.restore();
        return;
      }
    }
  }

  ctx.textBaseline = 'middle';
  ctx.fillText(word, x, y + 4);
  ctx.restore();
}

// ── canvas helpers ─────────────────────────────────────────────────────────
function glowCircle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, stroke: string, blur = 16
) {
  ctx.save();
  ctx.shadowBlur = blur; ctx.shadowColor = stroke;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

function drawField(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#030a14';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.042)'; ctx.lineWidth = 1;
  for (let x = W/6; x < W; x += W/6) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = H/10; y < H; y += H/10){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.20)'; ctx.lineWidth = 2;
  ctx.setLineDash([10,7]);
  ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(0,212,255,0.3)';
  ctx.beginPath(); ctx.arc(W/2,H/2,W*0.13,0,Math.PI*2); ctx.stroke();
  ctx.restore();
  const gw = W*0.34, gh = 10;
  ctx.save(); ctx.lineWidth = 3;
  ctx.shadowBlur = 18; ctx.shadowColor = '#00d4ff'; ctx.strokeStyle = '#00d4ff';
  ctx.strokeRect((W-gw)/2, 0, gw, gh);
  ctx.shadowColor = '#ff2d7e'; ctx.strokeStyle = '#ff2d7e';
  ctx.strokeRect((W-gw)/2, H-gh, gw, gh);
  ctx.restore();
}

// ── component ──────────────────────────────────────────────────────────────
export function AirHockey() {
  const [gameState,   setGameState]   = useState<GameState>('start');
  const [difficulty,  setDifficulty]  = useState<Difficulty>('medium');
  const [score,       setScore]       = useState(0);
  const [lives,       setLives]       = useState(5);
  const [lastHeard,   setLastHeard]   = useState('');
  const [heardOk,     setHeardOk]     = useState(false);
  const [playerName,  setPlayerName]  = useState('');
  const [flipped,     setFlipped]     = useState<Record<number,boolean>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  });

  // ── FIX 1: use the existing hook ───────────────────────────────────────────
  const speech = useSpeechRecognition('he-IL');

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef       = useRef(0);
  const playRef      = useRef(false);
  const diffRef      = useRef<Difficulty>('medium');

  const scoreRef  = useRef(0);
  const livesRef  = useRef(5);
  const speedRef  = useRef(1);
  const pucksRef  = useRef<Puck[]>([]);
  const playerRef = useRef({ x: 0, y: 0, radius: 40 });

  // ── speech result handler ──────────────────────────────────────────────────
  const checkWordRef = useRef<(t: string) => void>(() => {});
  const checkWord = useCallback((transcript: string) => {
    if (!playRef.current) return;
    const s = transcript.replace(/[.,!?؟]/g,'').trim().toLowerCase();
    let hit = false;
    pucksRef.current.forEach(p => {
      if (p.isHittable) return;
      if (p.targetAnswers.some(a => s.includes(a.toLowerCase()))) {
        p.isHittable = true; p.color = '#06ffa5'; hit = true;
      }
    });
    if (hit) {
      setLastHeard(transcript); setHeardOk(true);
      setTimeout(() => { setHeardOk(false); setLastHeard(''); }, 900);
    } else {
      setLastHeard(transcript);
      setTimeout(() => setLastHeard(''), 1200);
    }
  }, []);
  checkWordRef.current = checkWord;

  // ── draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    if (!W || !H) return;

    drawField(ctx, W, H);

    pucksRef.current.forEach(p => {
      if (p.isHittable) p.glowT = (p.glowT + 0.10) % (Math.PI * 2);
      const blur = p.isHittable ? 26 + Math.sin(p.glowT) * 8 : 12;
      glowCircle(ctx, p.x, p.y, p.radius, p.color + '28', p.color, blur);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x - p.radius*.22, p.y - p.radius*.22, p.radius*.28, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); ctx.restore();
      drawPuckText(ctx, p.displayWord, p.helperText, p.x, p.y, p.radius, p.isHittable);
    });

    const pl = playerRef.current;
    glowCircle(ctx, pl.x, pl.y, pl.radius, 'rgba(0,212,255,0.12)', '#00d4ff', 22);
    glowCircle(ctx, pl.x, pl.y, pl.radius * .36, '#00d4ff', '#00d4ff', 10);
  }, []);

  // ── spawn ──────────────────────────────────────────────────────────────────
  const spawn = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const W = cv.width;
    if (!W) return;
    const cfg  = DIFF[diffRef.current];
    const mob  = isMob() ? 0.6 : 1.0;
    const r    = Math.max(45, W * 0.13);
    const spd  = cfg.base * mob * speedRef.current + Math.random() * cfg.base * .4 * mob;
    const ang  = (Math.random() * 110 + 35) * (Math.PI / 180);
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const e2h  = Math.random() > .5;
    speech.switchLang(e2h ? 'he-IL' : 'en-US');
    pucksRef.current.push({
      x: r + Math.random() * (W - r * 2),
      y: r + 10,
      vx: Math.cos(ang) * spd * (Math.random() < .5 ? 1 : -1),
      vy: Math.abs(Math.sin(ang) * spd),
      radius: r, color: rNeon(),
      displayWord:   e2h ? word.en : word.he[0],
      targetAnswers: e2h ? word.he : [word.en.toLowerCase()],
      helperText:    e2h ? ':עברית' : 'English:',
      isHittable: false, glowT: 0,
    });
  }, [speech]);

  // ── physics ────────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    playRef.current = false;
    cancelAnimationFrame(rafRef.current);
    speech.stop();
    setGameState('gameover');
  }, [speech]);

  const physics = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const W = cv.width, H = cv.height;
    if (!W || !H) return;
    const cfg = DIFF[diffRef.current];
    const mob = isMob() ? 0.6 : 1.0;
    scoreRef.current++;
    speedRef.current = Math.min(speedRef.current + cfg.ramp, cfg.max / (cfg.base * mob));
    if (scoreRef.current % 10 === 0) setScore(Math.floor(scoreRef.current / 10));
    if (pucksRef.current.length === 0) spawn();

    for (let i = pucksRef.current.length - 1; i >= 0; i--) {
      const p = pucksRef.current[i];
      p.x += p.vx; p.y += p.vy;

      if (p.x - p.radius <= 0)  { p.x = p.radius;   p.vx =  Math.abs(p.vx); }
      if (p.x + p.radius >= W)  { p.x = W-p.radius;  p.vx = -Math.abs(p.vx); }

      if (p.y - p.radius <= 0) {
        if (p.isHittable) {
          pucksRef.current.splice(i, 1);
          scoreRef.current += 500;
          setScore(Math.floor(scoreRef.current / 10));
          setTimeout(() => { if (playRef.current && pucksRef.current.length === 0) spawn(); }, 350);
          continue;
        }
        p.y = p.radius; p.vy = Math.abs(p.vy);
      }

      if (p.y - p.radius >= H) {
        pucksRef.current.splice(i, 1);
        livesRef.current--; setLives(livesRef.current);
        if (livesRef.current <= 0) { endGame(); return; }
        setTimeout(() => { if (playRef.current && pucksRef.current.length === 0) spawn(); }, 500);
        continue;
      }

      const pl = playerRef.current;
      const dx = p.x - pl.x, dy = p.y - pl.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = p.radius + pl.radius;
      if (dist < minD && dist > 0.001) {
        const nx = dx / dist, ny = dy / dist;
        p.x = pl.x + nx * minD;
        p.y = pl.y + ny * minD;
        const spd = Math.hypot(p.vx, p.vy);
        p.vx = nx * spd * 1.05;
        p.vy = -Math.abs(ny * spd * 1.05);
        if (Math.abs(p.vy) < 1) p.vy = -2;
      }
    }
  }, [spawn, endGame]);

  // ── game loop ──────────────────────────────────────────────────────────────
  const resizeRef = useRef<() => void>(() => {});
  const loop = useCallback(() => {
    if (!playRef.current) return;
    const cv = canvasRef.current;
    if (cv && (!cv.width || !cv.height)) resizeRef.current();
    physics(); draw();
    rafRef.current = requestAnimationFrame(loop);
  }, [physics, draw]);

  // ── ResizeObserver for canvas sizing ──
  const resizeCanvas = useCallback(() => {
    const cv  = canvasRef.current;
    const con = containerRef.current;
    if (!cv || !con) return;
    const w = con.clientWidth;
    const h = con.clientHeight;
    if (!w || !h) return;
    cv.width  = w;
    cv.height = h;

    const pl = playerRef.current;
    pl.radius = Math.max(40, w * 0.09);
    if (playRef.current) {
      pl.x = Math.min(Math.max(pl.x, pl.radius), w - pl.radius);
      pl.y = Math.max(h * 0.5, Math.min(h - pl.radius, pl.y));
    } else {
      pl.x = w / 2;
      pl.y = h - pl.radius - 14;
    }
  }, []);
  resizeRef.current = resizeCanvas;

  useEffect(() => {
    const con = containerRef.current;
    if (!con) return;
    const obs = new ResizeObserver(() => resizeCanvas());
    obs.observe(con);
    requestAnimationFrame(() => resizeCanvas());
    return () => obs.disconnect();
  }, [resizeCanvas]);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); speech.stop(); }, [speech]);

  // ── start ──────────────────────────────────────────────────────────────────
  const startGame = useCallback((diff: Difficulty) => {
    diffRef.current = diff;
    scoreRef.current = 0; livesRef.current = 5; speedRef.current = 1;
    pucksRef.current = [];
    setScore(0); setLives(5); setLastHeard(''); setHeardOk(false);
    setGameState('playing');
    playRef.current = true;

    // Wait two frames so HUD height transition + layout are resolved before sizing.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resizeCanvas();
      const cv = canvasRef.current; if (!cv || !cv.width || !cv.height) return;
      const pl = playerRef.current;
      pl.x = cv.width / 2;
      pl.y = cv.height - pl.radius - 14;
      speech.start(checkWordRef.current);
      spawn();
      rafRef.current = requestAnimationFrame(loop);
    }));
  }, [resizeCanvas, speech, spawn, loop]);

  // ── pointer handling (unified mouse + touch via Pointer Events) ───────────
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!playRef.current || !canvasRef.current) return;
    const cv   = canvasRef.current;
    const rect = cv.getBoundingClientRect();
    const W    = cv.width, H = cv.height;
    const pl   = playerRef.current;
    const rx   = (e.clientX - rect.left) * (W / rect.width);
    const ry   = (e.clientY - rect.top)  * (H / rect.height);
    pl.x = Math.max(pl.radius, Math.min(W - pl.radius, rx));
    pl.y = Math.max(H * 0.5,   Math.min(H - pl.radius, ry));
  }, []);

  // ── save ───────────────────────────────────────────────────────────────────
  const save = useCallback(() => {
    const name = playerName.trim() || 'שחקן אנונימי';
    const updated = [...leaderboard, {
      name, score: Math.floor(scoreRef.current / 10), difficulty: DIFF[diffRef.current].label,
    }].sort((a, b) => b.score - a.score).slice(0, 10);
    setLeaderboard(updated);
    localStorage.setItem(LS_KEY, JSON.stringify(updated));
    setGameState('start');
  }, [playerName, leaderboard]);

  const neonStyle = (col: string, sel: boolean) => sel
    ? { background: col, borderColor: col, color: '#030712', boxShadow: `0 0 16px ${col}99` }
    : { background: 'transparent', borderColor: col + '55', color: col };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div
      dir="rtl"
      className="w-screen overflow-hidden flex flex-col"
      style={{ height: '100svh', background: 'radial-gradient(ellipse at 50% -5%,#0c1a2e,#030712 60%)' }}
    >
      {/* ── HUD ── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4"
        style={{ height: gameState === 'playing' ? 52 : 0, overflow: 'hidden' }}
      >
        <span className="text-cyan-400 font-black text-base tabular-nums"
              style={{ textShadow: '0 0 10px #00d4ff' }}>
          {score.toLocaleString()} נק׳
        </span>
        <div className="flex gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={`text-lg ${i < lives ? 'opacity-100' : 'opacity-15 grayscale'}`}>❤️</span>
          ))}
        </div>
        <div
          className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${
            speech.isListening
              ? 'text-emerald-400 border-emerald-400/50 bg-emerald-900/20'
              : 'text-slate-500 border-slate-700/50'
          }`}
          style={speech.isListening ? { boxShadow: '0 0 8px rgba(74,222,128,.4)' } : {}}
        >
          {speech.isListening ? '🎤 מקשיב' : '🎤 כבוי'}
        </div>
      </div>

      {/* ── Canvas container ── */}
      <div
        ref={containerRef}
        className="flex-1 w-full max-w-[600px] mx-auto relative"
        style={{ minHeight: 0 }}
      >
        <canvas
          ref={canvasRef}
          className="block touch-none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          onPointerMove={onPointerMove}
        />

        {/* heard bubble */}
        {gameState === 'playing' && lastHeard && (
          <div className="absolute bottom-5 inset-x-0 flex justify-center pointer-events-none z-10">
            <div
              className={`text-sm font-bold px-4 py-2 rounded-full border backdrop-blur-sm ${
                heardOk
                  ? 'text-emerald-300 border-emerald-400/50 bg-emerald-900/60'
                  : 'text-slate-300 border-slate-600/40 bg-slate-900/70'
              }`}
              style={heardOk ? { boxShadow: '0 0 14px rgba(6,255,165,.5)' } : {}}
            >
              {heardOk ? `✔ ${lastHeard}` : `"${lastHeard}"`}
            </div>
          </div>
        )}

        {/* interim speech indicator */}
        {gameState === 'playing' && speech.interim && !lastHeard && (
          <div className="absolute bottom-16 inset-x-0 flex justify-center pointer-events-none z-10">
            <div className="text-xs text-slate-400 italic px-3 py-1 rounded-full bg-slate-900/60 border border-slate-700/40">
              {speech.interim}
            </div>
          </div>
        )}

        {/* ════════ OVERLAYS ════════ */}

        {/* ── START ── */}
        {gameState === 'start' && (
          <div className="absolute inset-0 flex flex-col items-center justify-start gap-4 px-5 overflow-y-auto py-7"
               style={{ background: 'rgba(3,7,20,0.95)', backdropFilter: 'blur(8px)' }}>
            <h1 className="text-4xl font-black tracking-widest mt-1"
                style={{ color: '#00d4ff', textShadow: '0 0 24px #00d4ff, 0 0 50px #00d4ff44' }}>
              HOKI WORDS
            </h1>
            <p className="text-slate-400 text-sm -mt-2">הוקי אוויר · אנגלית</p>

            <div className="w-full max-w-sm">
              <p className="text-slate-500 text-xs text-center mb-2">רמת קושי — מהירות הפאק</p>
              <div className="flex gap-2">
                {(Object.keys(DIFF) as Difficulty[]).map(d => (
                  <button key={d} onClick={() => setDifficulty(d)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95"
                    style={neonStyle(DIFF[d].neon, difficulty === d)}>
                    {DIFF[d].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full max-w-sm">
              <button onClick={() => setGameState('learn')}
                className="w-full py-3 rounded-xl font-bold text-sm border-2 border-violet-500/50 text-violet-300 transition-all hover:bg-violet-900/25 active:scale-95"
                style={{ boxShadow: '0 0 10px rgba(167,139,250,0.15)' }}>
                📚 למד את המילים קודם
              </button>
              <button onClick={() => startGame(difficulty)}
                className="w-full py-4 rounded-xl font-black text-xl text-slate-900 transition-all active:scale-95"
                style={{ background: DIFF[difficulty].neon, boxShadow: `0 0 24px ${DIFF[difficulty].neon}aa` }}>
                🏒 התחל משחק!
              </button>
            </div>

            {!speech.isSupported && (
              <p className="text-amber-400 text-xs bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-2 text-center">
                ⚠️ זיהוי קול דורש Chrome
              </p>
            )}

            {leaderboard.length > 0 && (
              <div className="w-full max-w-sm rounded-xl p-3"
                   style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.13)' }}>
                <p className="text-cyan-400 font-bold text-xs text-center mb-2"
                   style={{ textShadow: '0 0 8px #00d4ff' }}>🏆 שיאים</p>
                {leaderboard.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex justify-between text-xs py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-slate-300">{i+1}. {e.name}</span>
                    <span className="flex gap-2 items-center">
                      <span className="text-slate-600">{e.difficulty}</span>
                      <span className="text-cyan-400 font-bold">{e.score.toLocaleString()}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── LEARN ── */}
        {gameState === 'learn' && (
          <div className="absolute inset-0 flex flex-col"
               style={{ background: 'rgba(3,7,20,0.97)', backdropFilter: 'blur(8px)' }}>
            <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
              <button onClick={() => setGameState('start')}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 transition-colors">
                ← חזור
              </button>
              <h2 className="font-black text-sm" style={{ color: '#bf5af2', textShadow: '0 0 10px #bf5af2' }}>
                📚 {WORDS.length} מילים
              </h2>
              <div className="w-12" />
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-2">
              <div className="grid grid-cols-2 gap-2.5">
                {WORDS.map((w, i) => (
                  <button key={i}
                    onClick={() => setFlipped(f => ({ ...f, [i]: !f[i] }))}
                    className="rounded-xl p-3.5 text-right transition-all active:scale-95 flex flex-col gap-1.5 min-h-[72px] justify-center"
                    style={{
                      background:  flipped[i] ? 'rgba(191,90,242,0.12)' : 'rgba(255,255,255,0.03)',
                      border:     `1px solid ${flipped[i] ? '#bf5af2' : 'rgba(255,255,255,0.07)'}`,
                      boxShadow:   flipped[i] ? '0 0 12px rgba(191,90,242,0.22)' : 'none',
                    }}>
                    <span className="text-white font-bold text-sm" dir="ltr"
                          style={{ textAlign: 'left', display: 'block' }}>{w.en}</span>
                    {flipped[i]
                      ? <span className="text-violet-300 text-sm">{w.he.join(' / ')}</span>
                      : <span className="text-slate-600 text-xs">לחץ לגלות</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 flex-shrink-0">
              <button onClick={() => startGame(difficulty)}
                className="w-full py-4 rounded-xl font-black text-lg text-slate-900 transition-all active:scale-95"
                style={{ background: DIFF[difficulty].neon, boxShadow: `0 0 22px ${DIFF[difficulty].neon}88` }}>
                🏒 מוכן — בוא נשחק!
              </button>
            </div>
          </div>
        )}

        {/* ── GAME OVER ── */}
        {gameState === 'gameover' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 overflow-y-auto py-8"
               style={{ background: 'rgba(3,7,20,0.96)', backdropFilter: 'blur(8px)' }}>
            <div className="text-5xl">💀</div>
            <h2 className="text-3xl font-black text-white">נגמרו החיים!</h2>
            <p className="text-3xl font-black"
               style={{ color: DIFF[diffRef.current].neon, textShadow: `0 0 18px ${DIFF[diffRef.current].neon}` }}>
              {Math.floor(scoreRef.current / 10).toLocaleString()} נק׳
            </p>
            <p className="text-slate-500 text-sm">רמה: {DIFF[diffRef.current].label}</p>
            <div className="w-full flex flex-col gap-2.5 max-w-xs">
              <input dir="rtl" type="text" value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder="שם לשיאים..." autoFocus
                className="w-full text-center text-base font-bold rounded-xl px-4 py-3 outline-none transition-colors placeholder-slate-600"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
              />
              <button onClick={save}
                className="w-full py-3 rounded-xl font-black text-slate-900 text-base transition-all active:scale-95"
                style={{ background: '#00d4ff', boxShadow: '0 0 18px rgba(0,212,255,.55)' }}>
                שמור שיא
              </button>
              <button onClick={() => setGameState('start')}
                className="text-slate-500 hover:text-slate-300 text-sm py-1 transition-colors">דלג</button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => startGame(diffRef.current)}
                className="px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95"
                style={{ borderColor: DIFF[diffRef.current].neon, color: DIFF[diffRef.current].neon }}>
                שחק שוב
              </button>
              <button onClick={() => setGameState('learn')}
                className="px-5 py-2.5 rounded-xl font-bold text-sm border-2 border-violet-500/60 text-violet-300 transition-all active:scale-95">
                חזור למילים
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
