import { useState, useEffect, useRef, useCallback } from 'react';
import { WORDS } from '../../data/words';

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

// ── config ─────────────────────────────────────────────────────────────────
const DIFF = {
  easy:   { base: 1.4, max: 2.2, ramp: 0.00006, label: 'קל',     neon: '#4ade80', shadow: '#16a34a' },
  medium: { base: 2.6, max: 4.0, ramp: 0.00018, label: 'בינוני', neon: '#facc15', shadow: '#ca8a04' },
  hard:   { base: 4.2, max: 6.5, ramp: 0.00038, label: 'קשה',    neon: '#f97316', shadow: '#c2410c' },
} as const;

const isMob = () => window.innerWidth < 768;
const NEON  = ['#ff6b35','#bf5af2','#00d4ff','#ff2d7e','#ffd60a','#06ffa5'];
const rNeon = () => NEON[Math.floor(Math.random() * NEON.length)];

// ── canvas helpers ─────────────────────────────────────────────────────────
function glowCircle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, stroke: string, blur = 18
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

  // grid
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.05)'; ctx.lineWidth = 1;
  for (let x = W/6; x < W; x += W/6) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = H/10; y < H; y += H/10) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();

  // mid line + circle
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.22)'; ctx.lineWidth = 2;
  ctx.setLineDash([10,7]);
  ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(0,212,255,0.35)';
  ctx.beginPath(); ctx.arc(W/2,H/2,W*0.12,0,Math.PI*2); ctx.stroke();
  ctx.restore();

  // goals
  const gw = W * 0.34, gh = 10;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.shadowBlur = 18; ctx.shadowColor = '#00d4ff';
  ctx.strokeStyle = '#00d4ff';
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
  const [micText,     setMicText]     = useState('🎤 כבוי');
  const [listening,   setListening]   = useState(false);
  const [lastHeard,   setLastHeard]   = useState('');
  const [heardOk,     setHeardOk]     = useState(false);
  const [playerName,  setPlayerName]  = useState('');
  const [flipped,     setFlipped]     = useState<Record<number,boolean>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('yonatan_hockey_v2') || '[]'); } catch { return []; }
  });

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef       = useRef(0);
  const playRef      = useRef(false);
  const diffRef      = useRef<Difficulty>('medium');

  const scoreRef  = useRef(0);
  const livesRef  = useRef(5);
  const speedRef  = useRef(1);
  const pucksRef  = useRef<Puck[]>([]);
  const playerRef = useRef({ x: 0, y: 0, radius: 32 });
  const frameRef  = useRef(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef    = useRef<any>(null);
  const pausedRef = useRef(false);
  const langRef   = useRef<'he-IL'|'en-US'>('he-IL');

  // ── speech ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { setMicText('❌ דרוש Chrome'); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
    recRef.current = r;

    r.onstart = () => {
      setListening(true);
      setMicText(`🎤 ${langRef.current === 'he-IL' ? 'עברית' : 'English'}`);
    };
    r.onresult = (e: any) => {
      if (!playRef.current || pausedRef.current) return;
      let best = '';
      for (let i = e.resultIndex; i < e.results.length; i++)
        for (let a = 0; a < e.results[i].length; a++) {
          const t = e.results[i][a].transcript;
          if (t.length > best.length) best = t;
        }
      if (best.trim()) checkWord(best.trim());
    };
    r.onend = () => {
      setListening(false); setMicText('🎤 מושהה');
      if (playRef.current && !pausedRef.current) try { r.start(); } catch (_) {}
    };
    r.onerror = (e: any) => { if (e.error !== 'no-speech') console.warn('mic:', e.error); };
    return () => recRef.current?.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchLang = useCallback((l: 'he-IL'|'en-US') => {
    if (langRef.current === l) return;
    langRef.current = l;
    if (recRef.current) { recRef.current.lang = l; try { recRef.current.stop(); } catch (_) {} }
  }, []);

  const checkWord = useCallback((spoken: string) => {
    if (!playRef.current || pausedRef.current) return;
    const s = spoken.replace(/[.,!?؟]/g,'').trim().toLowerCase();
    let hit = false;
    pucksRef.current.forEach(p => {
      if (p.isHittable) return;
      if (p.targetAnswers.some(a => s.includes(a.toLowerCase()))) {
        p.isHittable = true; p.color = '#06ffa5'; hit = true;
      }
    });
    if (hit) {
      setLastHeard(spoken); setHeardOk(true);
      pausedRef.current = true;
      setTimeout(() => { pausedRef.current = false; setHeardOk(false); setLastHeard(''); }, 900);
    } else {
      setLastHeard(spoken);
      setTimeout(() => setLastHeard(''), 1200);
    }
  }, []);

  // ── draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    frameRef.current++;
    drawField(ctx, W, H);

    pucksRef.current.forEach(p => {
      if (p.isHittable) p.glowT = (p.glowT + 0.1) % (Math.PI * 2);
      const blur = p.isHittable ? 26 + Math.sin(p.glowT) * 9 : 12;
      glowCircle(ctx, p.x, p.y, p.radius, p.color + '2a', p.color, blur);
      // shine
      ctx.save();
      ctx.beginPath(); ctx.arc(p.x - p.radius*.22, p.y - p.radius*.22, p.radius*.28, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill(); ctx.restore();
      // text
      ctx.save();
      ctx.shadowBlur = 6; ctx.shadowColor = p.isHittable ? '#06ffa5' : '#fff';
      ctx.fillStyle  = p.isHittable ? '#052e16' : '#ffffff';
      ctx.textAlign  = 'center'; ctx.textBaseline = 'middle';
      const len = p.displayWord.length;
      const fs = len > 11 ? p.radius*.34 : len > 7 ? p.radius*.41 : p.radius*.50;
      ctx.font = `bold ${fs}px Heebo,system-ui,sans-serif`;
      ctx.fillText(p.displayWord, p.x, p.y + 3);
      ctx.font = `${p.radius*.24}px Heebo,system-ui,sans-serif`;
      ctx.fillStyle = p.isHittable ? '#a7f3d0' : 'rgba(255,255,255,0.45)';
      ctx.fillText(p.helperText, p.x, p.y - p.radius*.48);
      ctx.restore();
    });

    const pl = playerRef.current;
    glowCircle(ctx, pl.x, pl.y, pl.radius, 'rgba(0,212,255,0.14)', '#00d4ff', 22);
    glowCircle(ctx, pl.x, pl.y, pl.radius * .36, '#00d4ff', '#00d4ff', 10);
  }, []);

  // ── spawn ─────────────────────────────────────────────────────────────────
  const spawn = useCallback((cv: HTMLCanvasElement) => {
    const cfg  = DIFF[diffRef.current];
    const mob  = isMob() ? 0.6 : 1.0;
    const r    = Math.max(28, cv.width * 0.082);
    const spd  = (cfg.base * mob * speedRef.current) + Math.random() * cfg.base * .4 * mob;
    const ang  = (Math.random() * 110 + 35) * (Math.PI / 180);
    const w    = WORDS[Math.floor(Math.random() * WORDS.length)];
    const e2h  = Math.random() > .5;
    switchLang(e2h ? 'he-IL' : 'en-US');
    pucksRef.current.push({
      x: r + Math.random() * (cv.width - r*2), y: r + 8,
      vx: Math.cos(ang) * spd * (Math.random()<.5?1:-1),
      vy: Math.abs(Math.sin(ang) * spd),
      radius: r, color: rNeon(),
      displayWord: e2h ? w.en : w.he[0],
      targetAnswers: e2h ? w.he : [w.en.toLowerCase()],
      helperText: e2h ? ':תרגם לעברית' : 'Translate:',
      isHittable: false, glowT: 0,
    });
  }, [switchLang]);

  // ── physics ───────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    playRef.current = false;
    cancelAnimationFrame(rafRef.current);
    recRef.current?.stop();
    setGameState('gameover');
  }, []);

  const physics = useCallback((cv: HTMLCanvasElement) => {
    const cfg = DIFF[diffRef.current];
    const mob = isMob() ? 0.6 : 1.0;
    scoreRef.current++;
    speedRef.current = Math.min(speedRef.current + cfg.ramp, cfg.max / (cfg.base * mob));
    if (scoreRef.current % 10 === 0) setScore(Math.floor(scoreRef.current / 10));
    if (pucksRef.current.length === 0) spawn(cv);

    const W = cv.width, H = cv.height;
    for (let i = pucksRef.current.length - 1; i >= 0; i--) {
      const p = pucksRef.current[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x - p.radius <= 0)   { p.x = p.radius;   p.vx =  Math.abs(p.vx); }
      if (p.x + p.radius >= W)   { p.x = W-p.radius;  p.vx = -Math.abs(p.vx); }
      if (p.y - p.radius <= 0) {
        if (p.isHittable) {
          pucksRef.current.splice(i,1);
          scoreRef.current += 500; setScore(Math.floor(scoreRef.current/10));
          setTimeout(()=>{ if(playRef.current&&pucksRef.current.length===0) spawn(cv); },350);
          continue;
        }
        p.y = p.radius; p.vy = Math.abs(p.vy);
      }
      if (p.y - p.radius >= H) {
        pucksRef.current.splice(i,1);
        livesRef.current--; setLives(livesRef.current);
        if (livesRef.current<=0) { endGame(); return; }
        setTimeout(()=>{ if(playRef.current&&pucksRef.current.length===0) spawn(cv); },500);
        continue;
      }
      if (!p.isHittable) continue;
      const pl = playerRef.current;
      const dx = p.x-pl.x, dy = p.y-pl.y;
      const dist = Math.sqrt(dx*dx+dy*dy);
      const minD = p.radius+pl.radius;
      if (dist < minD && dist > .001) {
        const nx=dx/dist, ny=dy/dist;
        p.x+=nx*(minD-dist); p.y+=ny*(minD-dist);
        const spd=Math.sqrt(p.vx*p.vx+p.vy*p.vy);
        p.vx=nx*spd*1.08; p.vy=-Math.abs(ny*spd*1.08);
      }
    }
  }, [spawn, endGame]);

  // ── loop ──────────────────────────────────────────────────────────────────
  const loop = useCallback(() => {
    if (!playRef.current || !canvasRef.current) return;
    physics(canvasRef.current);
    draw();
    rafRef.current = requestAnimationFrame(loop);
  }, [physics, draw]);

  // ── resize canvas to container ────────────────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const cv  = canvasRef.current;
    const con = containerRef.current;
    if (!cv || !con) return;
    const dpr = window.devicePixelRatio || 1;
    const W   = con.clientWidth;
    const H   = con.clientHeight;
    cv.width  = W * dpr;
    cv.height = H * dpr;
    cv.style.width  = W + 'px';
    cv.style.height = H + 'px';
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);           // crisp on retina
    const pl = playerRef.current;
    pl.radius = W * 0.082;
    if (playRef.current) {
      pl.x = Math.min(Math.max(pl.x, pl.radius), W - pl.radius);
      pl.y = Math.max(H * .5, Math.min(H - pl.radius, pl.y));
    } else {
      pl.x = W / 2;
      pl.y = H - pl.radius - 14;
    }
  }, []);

  // ── start ─────────────────────────────────────────────────────────────────
  const startGame = useCallback((diff: Difficulty) => {
    diffRef.current  = diff;
    scoreRef.current = 0; livesRef.current = 5; speedRef.current = 1;
    pucksRef.current = []; pausedRef.current = false;
    setScore(0); setLives(5); setLastHeard(''); setHeardOk(false);

    resizeCanvas();                // size canvas to container before spawning

    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    // reset scale (resizeCanvas already applied dpr scale, reset for fresh start)
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pl = playerRef.current;
    const W  = cv.width / dpr, H = cv.height / dpr;
    pl.x = W / 2; pl.y = H - pl.radius - 14;

    setGameState('playing');
    playRef.current = true;
    try { recRef.current?.start(); } catch (_) {}
    spawn(cv);
    rafRef.current = requestAnimationFrame(loop);
  }, [resizeCanvas, spawn, loop]);

  // ── pointer ───────────────────────────────────────────────────────────────
  const onPointer = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!playRef.current || !canvasRef.current) return;
    const cv   = canvasRef.current;
    const rect = cv.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    const cx   = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy   = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const W    = cv.width / dpr, H = cv.height / dpr;
    const pl   = playerRef.current;
    const rx   = (cx - rect.left) * (cv.width  / rect.width)  / dpr;
    const ry   = (cy - rect.top)  * (cv.height / rect.height) / dpr;
    pl.x = Math.max(pl.radius, Math.min(W - pl.radius, rx));
    pl.y = Math.max(H * .5,    Math.min(H - pl.radius, ry));
  }, []);

  useEffect(() => {
    const p = (e: TouchEvent) => { if (playRef.current) e.preventDefault(); };
    document.body.addEventListener('touchmove', p, { passive: false });
    return () => document.body.removeEventListener('touchmove', p);
  }, []);

  // window resize → re-size canvas
  useEffect(() => {
    const onResize = () => resizeCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resizeCanvas]);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); recRef.current?.stop(); }, []);

  // ── save ──────────────────────────────────────────────────────────────────
  const save = useCallback(() => {
    const name = playerName.trim() || 'שחקן אנונימי';
    const updated = [...leaderboard, {
      name, score: Math.floor(scoreRef.current/10), difficulty: DIFF[diffRef.current].label,
    }].sort((a,b)=>b.score-a.score).slice(0,10);
    setLeaderboard(updated);
    localStorage.setItem('yonatan_hockey_v2', JSON.stringify(updated));
    setGameState('start');
  }, [playerName, leaderboard]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div
      dir="rtl"
      className="w-screen overflow-hidden flex flex-col"
      style={{ height:'100svh', background:'radial-gradient(ellipse at 50% -5%, #0c1a2e 0%, #030712 60%)' }}
    >
      {/* ── HUD bar (only while playing) ── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4"
        style={{ height: gameState==='playing' ? 52 : 0, overflow:'hidden', transition:'height .25s' }}
      >
        <span className="text-cyan-400 font-black text-base tabular-nums"
              style={{ textShadow:'0 0 10px #00d4ff' }}>
          {score.toLocaleString()} נק׳
        </span>
        <div className="flex gap-0.5">
          {Array.from({length:5},(_,i)=>(
            <span key={i} className={`text-lg ${i<lives?'opacity-100':'opacity-15 grayscale'}`}>❤️</span>
          ))}
        </div>
        <div
          className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-all ${
            listening
              ? 'text-emerald-400 border-emerald-400/50 bg-emerald-900/20'
              : 'text-slate-500 border-slate-700/50'
          }`}
          style={listening ? { boxShadow:'0 0 8px rgba(74,222,128,.4)' } : {}}
        >
          {micText}
        </div>
      </div>

      {/* ── canvas container (fills remaining height) ── */}
      <div ref={containerRef} className="flex-1 relative" style={{ minHeight:0 }}>
        <canvas
          ref={canvasRef}
          onMouseMove={onPointer}
          onTouchMove={onPointer}
          className="block touch-none"
          style={{ width:'100%', height:'100%' }}
        />

        {/* heard bubble */}
        {gameState==='playing' && lastHeard && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
            <div
              className={`text-sm font-bold px-4 py-2 rounded-full border backdrop-blur-sm ${
                heardOk
                  ? 'text-emerald-300 border-emerald-400/50 bg-emerald-900/60'
                  : 'text-slate-300  border-slate-600/40    bg-slate-900/70'
              }`}
              style={heardOk ? { boxShadow:'0 0 14px rgba(6,255,165,.5)' } : {}}
            >
              {heardOk ? `✔ ${lastHeard}` : `"${lastHeard}"`}
            </div>
          </div>
        )}

        {/* ══ START ══ */}
        {gameState==='start' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-start gap-4 px-5 overflow-y-auto py-6"
            style={{ background:'rgba(3,7,20,0.95)', backdropFilter:'blur(8px)' }}
          >
            <h1
              className="text-4xl font-black tracking-widest mt-2"
              style={{ color:'#00d4ff', textShadow:'0 0 22px #00d4ff, 0 0 50px #00d4ff44' }}
            >
              HOKI WORDS
            </h1>
            <p className="text-slate-400 text-sm -mt-2">הוקי אוויר · אנגלית</p>

            {/* difficulty */}
            <div className="w-full max-w-sm">
              <p className="text-slate-500 text-xs text-center mb-2">רמת קושי — מהירות הפאק</p>
              <div className="flex gap-2">
                {(Object.keys(DIFF) as Difficulty[]).map(d=>(
                  <button
                    key={d}
                    onClick={()=>setDifficulty(d)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95"
                    style={difficulty===d
                      ? { background:DIFF[d].neon, borderColor:DIFF[d].neon, color:'#030712',
                          boxShadow:`0 0 16px ${DIFF[d].neon}99` }
                      : { background:'transparent', borderColor:DIFF[d].neon+'55', color:DIFF[d].neon }
                    }
                  >
                    {DIFF[d].label}
                  </button>
                ))}
              </div>
            </div>

            {/* buttons */}
            <div className="flex flex-col gap-3 w-full max-w-sm">
              <button
                onClick={()=>setGameState('learn')}
                className="w-full py-3 rounded-xl font-bold text-sm border-2 border-violet-500/50 text-violet-300 transition-all hover:bg-violet-900/25 active:scale-95"
                style={{ boxShadow:'0 0 10px rgba(167,139,250,0.18)' }}
              >
                📚 למד את המילים קודם
              </button>
              <button
                onClick={()=>startGame(difficulty)}
                className="w-full py-4 rounded-xl font-black text-xl text-slate-900 transition-all active:scale-95"
                style={{ background:DIFF[difficulty].neon, boxShadow:`0 0 24px ${DIFF[difficulty].neon}aa` }}
              >
                🏒 התחל משחק!
              </button>
            </div>

            {/* leaderboard */}
            {leaderboard.length > 0 && (
              <div className="w-full max-w-sm rounded-xl p-3"
                   style={{ background:'rgba(0,212,255,0.04)', border:'1px solid rgba(0,212,255,0.14)' }}>
                <p className="text-cyan-400 font-bold text-xs text-center mb-2"
                   style={{ textShadow:'0 0 8px #00d4ff' }}>🏆 שיאים</p>
                {leaderboard.slice(0,5).map((e,i)=>(
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

        {/* ══ LEARN ══ */}
        {gameState==='learn' && (
          <div
            className="absolute inset-0 flex flex-col"
            style={{ background:'rgba(3,7,20,0.97)', backdropFilter:'blur(8px)' }}
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
              <button onClick={()=>setGameState('start')}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 transition-colors">
                ← חזור
              </button>
              <h2 className="font-black text-sm" style={{ color:'#bf5af2', textShadow:'0 0 10px #bf5af2' }}>
                📚 {WORDS.length} מילים ללמוד
              </h2>
              <div className="w-12"/>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-2">
              <div className="grid grid-cols-2 gap-2.5">
                {WORDS.map((w,i)=>(
                  <button
                    key={i}
                    onClick={()=>setFlipped(f=>({...f,[i]:!f[i]}))}
                    className="rounded-xl p-3.5 text-right transition-all active:scale-95 flex flex-col gap-1.5 min-h-[72px] justify-center"
                    style={{
                      background: flipped[i] ? 'rgba(191,90,242,0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${flipped[i] ? '#bf5af2' : 'rgba(255,255,255,0.07)'}`,
                      boxShadow: flipped[i] ? '0 0 12px rgba(191,90,242,0.25)' : 'none',
                    }}
                  >
                    <span className="text-white font-bold text-sm" dir="ltr" style={{ textAlign:'left', display:'block' }}>
                      {w.en}
                    </span>
                    {flipped[i]
                      ? <span className="text-violet-300 text-sm">{w.he.join(' / ')}</span>
                      : <span className="text-slate-600 text-xs">לחץ לגלות</span>
                    }
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 flex-shrink-0">
              <button
                onClick={()=>startGame(difficulty)}
                className="w-full py-4 rounded-xl font-black text-lg text-slate-900 transition-all active:scale-95"
                style={{ background:DIFF[difficulty].neon, boxShadow:`0 0 22px ${DIFF[difficulty].neon}88` }}
              >
                🏒 מוכן — בוא נשחק!
              </button>
            </div>
          </div>
        )}

        {/* ══ GAME OVER ══ */}
        {gameState==='gameover' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 overflow-y-auto py-8"
            style={{ background:'rgba(3,7,20,0.96)', backdropFilter:'blur(8px)' }}
          >
            <div className="text-5xl">💀</div>
            <h2 className="text-3xl font-black text-white">נגמרו החיים!</h2>
            <p className="text-3xl font-black"
               style={{ color:DIFF[diffRef.current].neon, textShadow:`0 0 18px ${DIFF[diffRef.current].neon}` }}>
              {Math.floor(scoreRef.current/10).toLocaleString()} נק׳
            </p>
            <p className="text-slate-500 text-sm">רמה: {DIFF[diffRef.current].label}</p>

            <div className="w-full flex flex-col gap-2.5 max-w-xs">
              <input
                dir="rtl" type="text" value={playerName}
                onChange={e=>setPlayerName(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&save()}
                placeholder="שם לשיאים..."
                autoFocus
                className="w-full text-center text-base font-bold rounded-xl px-4 py-3 outline-none transition-colors placeholder-slate-600"
                style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.12)',
                  color:'#fff' }}
              />
              <button onClick={save}
                className="w-full py-3 rounded-xl font-black text-slate-900 text-base transition-all active:scale-95"
                style={{ background:'#00d4ff', boxShadow:'0 0 18px rgba(0,212,255,.6)' }}>
                שמור שיא
              </button>
              <button onClick={()=>setGameState('start')}
                className="text-slate-500 hover:text-slate-300 text-sm py-1 transition-colors">דלג</button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={()=>startGame(diffRef.current)}
                className="px-5 py-2.5 rounded-xl font-bold text-sm border-2 transition-all active:scale-95"
                style={{ borderColor:DIFF[diffRef.current].neon, color:DIFF[diffRef.current].neon }}
              >שחק שוב</button>
              <button
                onClick={()=>setGameState('learn')}
                className="px-5 py-2.5 rounded-xl font-bold text-sm border-2 border-violet-500/60 text-violet-300 transition-all active:scale-95"
              >חזור למילים</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
