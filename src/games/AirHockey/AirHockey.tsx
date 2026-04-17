import { useRef, useState, useEffect, useCallback } from 'react';
import { Mic, MicOff, Trophy } from 'lucide-react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { WORDS, shuffle } from '../../data/words';
import type { Word } from '../../data/words';

// ── types ──────────────────────────────────────────────────────────────────
interface Puck {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  color: string;
  word: Word;
  displayText: string;
  targetAnswers: string[];
  targetLang: 'he-IL' | 'en-US';
  helperLabel: string;
  unlocked: boolean;
}

type Phase = 'MENU' | 'PLAYING' | 'GAME_OVER';
interface LeaderEntry { name: string; score: number; date: string; }

// ── constants ──────────────────────────────────────────────────────────────
const W = 360, H = 580;
const PLAYER_R = 34;
const PUCK_R   = 38;
const COLORS   = ['#f97316','#a855f7','#3b82f6','#ec4899','#facc15','#14b8a6'];
let nextId = 0;

// ── helpers ────────────────────────────────────────────────────────────────
function randCol() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

function makePuck(pool: Word[]): Puck {
  const word = pool[Math.floor(Math.random() * pool.length)];
  const useHe = Math.random() < 0.5;
  const speed = 2.6 + Math.random() * 1.2;
  const angle = Math.PI * 0.3 + Math.random() * Math.PI * 0.4;
  return {
    id: nextId++,
    x: PUCK_R + 20 + Math.random() * (W - (PUCK_R + 20) * 2),
    y: PUCK_R + 10,
    vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
    vy: Math.abs(Math.sin(angle) * speed),
    radius: PUCK_R,
    color: randCol(),
    word,
    displayText: useHe ? word.he[0] : word.en,
    targetAnswers: useHe ? [word.en] : word.he,
    targetLang: useHe ? 'en-US' : 'he-IL',
    helperLabel: useHe ? '!Say in English' : ':תגיד בעברית',
    unlocked: false,
  };
}

// ── draw ───────────────────────────────────────────────────────────────────
function drawFrame(
  ctx: CanvasRenderingContext2D,
  pucks: Puck[],
  player: { x: number; y: number },
  frame: number
) {
  // bg
  ctx.fillStyle = '#050e1f';
  ctx.fillRect(0, 0, W, H);

  // field
  ctx.save();
  ctx.strokeStyle = '#0f3460';
  ctx.lineWidth = 2;
  ctx.setLineDash([12, 8]);
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 46, 0, Math.PI * 2); ctx.stroke();
  // goals
  const gw = 100;
  ctx.beginPath(); ctx.rect((W - gw) / 2, 0, gw, 12); ctx.stroke();
  ctx.beginPath(); ctx.rect((W - gw) / 2, H - 12, gw, 12); ctx.stroke();
  ctx.restore();

  // pucks
  pucks.forEach(p => {
    const col = p.unlocked ? '#4ade80' : p.color;
    const glow = p.unlocked ? 22 + Math.sin(frame * 0.14) * 6 : 10;

    ctx.save();
    ctx.shadowBlur = glow;
    ctx.shadowColor = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = col + (p.unlocked ? '55' : '33');
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // text
    ctx.save();
    ctx.fillStyle = p.unlocked ? '#052e16' : '#fff';
    const fs = p.displayText.length > 9 ? 10 : p.displayText.length > 6 ? 12 : 14;
    ctx.font = `bold ${fs}px Heebo,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.displayText, p.x, p.y);
    ctx.restore();
  });

  // player paddle
  ctx.save();
  ctx.shadowBlur = 22;
  ctx.shadowColor = '#60a5fa';
  ctx.beginPath();
  ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
  ctx.fillStyle = '#1e40af66';
  ctx.fill();
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(player.x, player.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#93c5fd';
  ctx.fill();
}

// ── component ──────────────────────────────────────────────────────────────
export function AirHockey() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase]     = useState<Phase>('MENU');
  const [lives, setLives]     = useState(5);
  const [score, setScore]     = useState(0);
  const [helperLabel, setHelperLabel] = useState('');
  const [currentLang, setCurrentLang] = useState<'he-IL' | 'en-US'>('he-IL');
  const [nameInput, setNameInput] = useState('');
  const [showLeader, setShowLeader] = useState(false);
  const [leaderboard, setLeaderboard] = useLocalStorage<LeaderEntry[]>('yonatan_hockey_scores', []);

  // mutable game state — all lives in refs, NEVER setX inside RAF
  const gameRef = useRef({
    running: false,
    pucks: [] as Puck[],
    player: { x: W / 2, y: H - 80 },
    score: 0,
    lives: 5,
    frame: 0,
    speedMult: 1,
    wordPool: shuffle([...WORDS]),
    raf: 0,
  });

  const speech = useSpeechRecognition('he-IL');

  // ── pointer ──────────────────────────────────────────────────────────────
  const toXY = useCallback((cx: number, cy: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    gameRef.current.player.x = ((cx - r.left)  / r.width)  * W;
    gameRef.current.player.y = ((cy - r.top)   / r.height) * H;
  }, []);

  // ── unlock ────────────────────────────────────────────────────────────────
  const unlock = useCallback((transcript: string) => {
    const lower = transcript.toLowerCase().trim();
    gameRef.current.pucks.forEach(p => {
      if (p.unlocked) return;
      if (p.targetAnswers.some(a => lower.includes(a.toLowerCase()))) {
        p.unlocked = true;
      }
    });
  }, []);

  // ── game loop (useEffect owns the RAF) ────────────────────────────────────
  useEffect(() => {
    if (phase !== 'PLAYING') return;
    const g = gameRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    let scoreFlush = 0;   // batch score increments
    let livesLocal = g.lives;

    function loop() {
      if (!g.running) return;
      g.frame++;
      scoreFlush++;

      // flush score to React every 60 frames
      if (scoreFlush >= 60) {
        setScore(g.score);
        scoreFlush = 0;
      }

      // difficulty
      if (g.frame % 400 === 0 && g.speedMult < 2.5) {
        g.speedMult = Math.min(2.5, +(g.speedMult + 0.12).toFixed(2));
      }

      // spawn
      if (g.pucks.length === 0) {
        const p = makePuck(g.wordPool);
        p.vx *= g.speedMult;
        p.vy *= g.speedMult;
        g.pucks.push(p);
        setHelperLabel(p.helperLabel);
        setCurrentLang(p.targetLang);
        speech.switchLang(p.targetLang);
      }

      // physics
      g.pucks = g.pucks.filter(p => {
        p.x += p.vx;
        p.y += p.vy;

        // wall bounce
        if (p.x - p.radius < 0)  { p.x = p.radius;      p.vx =  Math.abs(p.vx); }
        if (p.x + p.radius > W)  { p.x = W - p.radius;  p.vx = -Math.abs(p.vx); }
        if (p.y - p.radius < 0)  { p.y = p.radius;       p.vy =  Math.abs(p.vy); }

        // goal
        if (p.unlocked && p.y + p.radius < 0) {
          g.score += 100;
          return false;
        }

        // missed
        if (p.y - p.radius > H) {
          livesLocal--;
          g.lives = livesLocal;
          setLives(livesLocal);
          if (livesLocal <= 0) {
            g.running = false;
            setScore(g.score);
            speech.stop();
            setPhase('GAME_OVER');
          }
          return false;
        }

        // paddle collision
        const pl = g.player;
        const dx = p.x - pl.x, dy = p.y - pl.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = p.radius + PLAYER_R;
        if (dist < minD && dist > 0.001) {
          const nx = dx / dist, ny = dy / dist;
          p.x += nx * (minD - dist);
          p.y += ny * (minD - dist);
          const dot = p.vx * nx + p.vy * ny;
          p.vx -= 2 * dot * nx;
          p.vy -= 2 * dot * ny;
          if (p.unlocked) p.vy = -Math.abs(p.vy) * 1.3;
        }

        return true;
      });

      g.score++;
      drawFrame(ctx, g.pucks, g.player, g.frame);
      g.raf = requestAnimationFrame(loop);
    }

    g.raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(g.raf);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── start ─────────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const g = gameRef.current;
    g.running = true;
    g.pucks = [];
    g.score = 0;
    g.lives = 5;
    g.frame = 0;
    g.speedMult = 1;
    g.player = { x: W / 2, y: H - 80 };
    g.wordPool = shuffle([...WORDS]);
    setScore(0);
    setLives(5);
    setHelperLabel('');
    setShowLeader(false);
    setPhase('PLAYING');   // triggers the useEffect above
    speech.start(unlock);
  }, [speech, unlock]);

  const stopGame = useCallback(() => {
    gameRef.current.running = false;
    cancelAnimationFrame(gameRef.current.raf);
    speech.stop();
  }, [speech]);

  useEffect(() => () => stopGame(), [stopGame]);

  // ── save score ─────────────────────────────────────────────────────────────
  const saveScore = useCallback(() => {
    if (!nameInput.trim()) return;
    setLeaderboard(prev =>
      [...prev, { name: nameInput.trim(), score: gameRef.current.score, date: new Date().toLocaleDateString('he-IL') }]
        .sort((a, b) => b.score - a.score).slice(0, 10)
    );
    setNameInput('');
    setShowLeader(true);
  }, [nameInput, setLeaderboard]);

  // ── hearts ─────────────────────────────────────────────────────────────────
  const hearts = Array.from({ length: 5 }, (_, i) => (
    <span key={i} className={`text-xl transition-opacity ${i < lives ? 'opacity-100' : 'opacity-20'}`}>❤️</span>
  ));

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center select-none"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0f2a4a 0%, #050d1a 70%)' }}
    >
      {/* HUD */}
      {phase === 'PLAYING' && (
        <div className="w-full max-w-[360px] flex justify-between items-center px-2 mb-2">
          <span className="text-white font-black text-lg tabular-nums">{score.toLocaleString()}</span>
          <div className="flex gap-0.5">{hearts}</div>
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full border transition-all ${
            speech.isListening
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-900/20'
              : 'text-slate-500 border-slate-700/40'
          }`}>
            {speech.isListening ? <Mic size={13}/> : <MicOff size={13}/>}
            {currentLang === 'he-IL' ? 'עברית' : 'English'}
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={W} height={H}
          className="block rounded-2xl border border-slate-700/50 touch-none"
          style={{ maxHeight: 'calc(100svh - 120px)', width: 'auto', boxShadow: '0 0 48px #0a1e36' }}
          onMouseMove={e => toXY(e.clientX, e.clientY)}
          onTouchMove={e => { e.preventDefault(); toXY(e.touches[0].clientX, e.touches[0].clientY); }}
        />

        {/* helper label */}
        {phase === 'PLAYING' && helperLabel && (
          <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
            <div className="bg-slate-900/85 text-yellow-300 text-xs font-bold px-3 py-1.5 rounded-full border border-yellow-500/30">
              {helperLabel}
            </div>
          </div>
        )}

        {/* interim */}
        {phase === 'PLAYING' && speech.interim && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
            <div className="bg-slate-900/85 text-slate-300 text-sm px-3 py-1.5 rounded-full border border-slate-600/40 italic">
              {speech.interim}
            </div>
          </div>
        )}

        {/* ── MENU ── */}
        {phase === 'MENU' && (
          <div className="absolute inset-0 rounded-2xl bg-slate-950/90 flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-6xl">🏒</div>
            <div className="text-center">
              <h1 className="text-3xl font-black text-white mb-1">הוקי אוויר</h1>
              <p className="text-slate-400 text-sm">יונתן</p>
            </div>
            <p className="text-slate-400 text-sm text-center leading-relaxed px-2">
              הזז את הכן עם העכבר או מגע.<br/>
              כשפאק מופיע — תרגם בקול כדי לפתוח,<br/>
              ואז שגר אותו לשער העליון!
            </p>
            {!speech.isSupported && (
              <p className="text-amber-400 text-xs text-center bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-2">
                ⚠️ זיהוי קול דורש Chrome
              </p>
            )}
            <button
              onClick={startGame}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:brightness-110 text-white font-black text-xl py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-orange-900/40"
            >
              התחל!
            </button>
            {leaderboard.length > 0 && (
              <button onClick={() => setShowLeader(v => !v)} className="flex items-center gap-2 text-slate-400 hover:text-yellow-400 text-sm transition-colors">
                <Trophy size={15}/>
                טבלת שיאים
              </button>
            )}
            {showLeader && (
              <div className="w-full bg-slate-900/80 border border-slate-700/40 rounded-xl p-3">
                <p className="text-yellow-400 font-bold text-sm text-center mb-2">🏆 שיאים</p>
                {leaderboard.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-800 last:border-0">
                    <span className="text-slate-300">{i + 1}. {e.name}</span>
                    <span className="text-yellow-400 font-bold">{e.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── GAME OVER ── */}
        {phase === 'GAME_OVER' && (
          <div className="absolute inset-0 rounded-2xl bg-slate-950/92 flex flex-col items-center justify-center gap-4 px-6">
            <div className="text-5xl">💀</div>
            <h2 className="text-3xl font-black text-white">נגמרו החיים!</h2>
            <p className="text-2xl font-black text-yellow-400">{gameRef.current.score.toLocaleString()} נק׳</p>
            {!showLeader ? (
              <div className="w-full flex flex-col gap-3">
                <input
                  type="text" dir="rtl" value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveScore()}
                  placeholder="שם לשיאים..."
                  className="w-full bg-slate-800 border border-slate-600 focus:border-yellow-400 text-white text-center text-lg font-bold rounded-xl px-4 py-3 outline-none transition-colors placeholder-slate-600"
                  autoFocus
                />
                <button onClick={saveScore} disabled={!nameInput.trim()}
                  className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-900 font-black py-3 rounded-xl transition-all">
                  שמור שיא
                </button>
                <button onClick={() => setPhase('MENU')} className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
                  דלג
                </button>
              </div>
            ) : (
              <div className="w-full bg-slate-900/80 border border-slate-700/40 rounded-xl p-3">
                <p className="text-yellow-400 font-bold text-sm text-center mb-2">🏆 שיאים</p>
                {leaderboard.slice(0, 5).map((e, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-800 last:border-0">
                    <span className="text-slate-300">{i + 1}. {e.name}</span>
                    <span className="text-yellow-400 font-bold">{e.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={startGame}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:brightness-110 text-white font-black text-lg py-3 rounded-2xl transition-all active:scale-95">
              שחק שוב
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
