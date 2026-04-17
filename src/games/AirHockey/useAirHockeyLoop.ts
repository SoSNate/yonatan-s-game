import { useRef, useCallback } from 'react';
import { WORDS, shuffle } from '../../data/words';
import type { Word } from '../../data/words';

export interface Puck {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  word: Word;
  displayText: string;
  targetLang: 'he-IL' | 'en-US';
  targetAnswers: string[];
  helperLabel: string;
  isUnlocked: boolean;
  unlockAnim: number; // 0..1 glow ramp
}

interface Callbacks {
  onScore: (pts: number) => void;
  onLifeLost: () => void;
  onGoal: (wordEn: string) => void;
  onPuckSpawned: (helperLabel: string, lang: 'he-IL' | 'en-US') => void;
  onGameEnd: () => void;
}

const COLORS = ['#f97316', '#a855f7', '#3b82f6', '#ec4899', '#facc15', '#14b8a6'];
let puckId = 0;

function randColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export function useAirHockeyLoop(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  cb: Callbacks
) {
  const state = useRef({
    pucks: [] as Puck[],
    player: { x: 180, y: 520, radius: 36 },
    lives: 5,
    score: 0,
    frame: 0,
    speedMult: 1,
    wordPool: shuffle([...WORDS]),
    wordIdx: 0,
    running: false,
    raf: 0,
  });

  const cbRef = useRef(cb);
  cbRef.current = cb;

  // ── spawn ──────────────────────────────────────────────────────────────────
  const spawn = useCallback(() => {
    const s = state.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (s.wordIdx >= s.wordPool.length) {
      s.wordPool = shuffle([...WORDS]);
      s.wordIdx = 0;
    }
    const word = s.wordPool[s.wordIdx++];
    const useHe = Math.random() < 0.5;
    const displayText = useHe ? word.he[0] : word.en;
    const targetLang: 'he-IL' | 'en-US' = useHe ? 'en-US' : 'he-IL';
    const targetAnswers = useHe ? [word.en] : word.he;
    const helperLabel = useHe ? '!Say in English' : ':תגיד בעברית';

    const r = 40;
    const speed = (2.8 + Math.random() * 1.4) * s.speedMult;
    const angle = Math.PI * 0.3 + Math.random() * Math.PI * 0.4;

    s.pucks.push({
      id: puckId++,
      x: r + Math.random() * (canvas.width - r * 2),
      y: r + 10,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
      vy: Math.abs(Math.sin(angle) * speed),
      radius: r,
      color: randColor(),
      word,
      displayText,
      targetLang,
      targetAnswers,
      helperLabel,
      isUnlocked: false,
      unlockAnim: 0,
    });

    cbRef.current.onPuckSpawned(helperLabel, targetLang);
  }, [canvasRef]);

  // ── unlock by speech ───────────────────────────────────────────────────────
  const unlockByTranscript = useCallback((transcript: string) => {
    const lower = transcript.toLowerCase().trim();
    state.current.pucks.forEach(p => {
      if (p.isUnlocked) return;
      if (p.targetAnswers.some(a => lower.includes(a.toLowerCase()))) {
        p.isUnlocked = true;
      }
    });
  }, []);

  // ── draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const s = state.current;

    // background
    ctx.fillStyle = '#050d1a';
    ctx.fillRect(0, 0, W, H);

    // field lines
    ctx.save();
    ctx.strokeStyle = '#0f3460';
    ctx.lineWidth = 2;
    // centre line
    ctx.setLineDash([14, 8]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);
    // centre circle
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 48, 0, Math.PI * 2); ctx.stroke();
    // goal areas
    const gw = 110;
    ctx.beginPath(); ctx.rect((W - gw) / 2, 0, gw, 14); ctx.stroke();
    ctx.beginPath(); ctx.rect((W - gw) / 2, H - 14, gw, 14); ctx.stroke();
    ctx.restore();

    // pucks
    s.pucks.forEach(p => {
      if (p.isUnlocked) {
        p.unlockAnim = Math.min(1, p.unlockAnim + 0.06);
      }

      ctx.save();
      // outer glow
      const glow = p.isUnlocked ? 28 + Math.sin(s.frame * 0.15) * 8 : 10;
      ctx.shadowBlur = glow;
      ctx.shadowColor = p.isUnlocked ? '#4ade80' : p.color;

      // puck body
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(p.x - 8, p.y - 8, 4, p.x, p.y, p.radius);
      const col = p.isUnlocked ? '#4ade80' : p.color;
      grad.addColorStop(0, col + 'cc');
      grad.addColorStop(1, col + '44');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();

      // word text
      ctx.save();
      ctx.fillStyle = p.isUnlocked ? '#052e16' : '#fff';
      const fontSize = p.displayText.length > 9 ? 10 : p.displayText.length > 6 ? 12 : 14;
      ctx.font = `bold ${fontSize}px Heebo, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.displayText, p.x, p.y);
      ctx.restore();
    });

    // player paddle
    const pl = s.player;
    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#60a5fa';
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, pl.radius, 0, Math.PI * 2);
    const pg = ctx.createRadialGradient(pl.x - 6, pl.y - 6, 4, pl.x, pl.y, pl.radius);
    pg.addColorStop(0, '#3b82f6cc');
    pg.addColorStop(1, '#1e40af44');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    // grip
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#93c5fd';
    ctx.fill();
  }, [canvasRef]);

  // ── main loop ──────────────────────────────────────────────────────────────
  const loop = useCallback(() => {
    const s = state.current;
    if (!s.running) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;

    s.frame++;
    s.score++;

    // difficulty ramp
    if (s.frame % 400 === 0 && s.speedMult < 2.6) {
      s.speedMult = Math.min(2.6, +(s.speedMult + 0.12).toFixed(2));
    }

    // spawn if empty
    if (s.pucks.length === 0) spawn();

    // move pucks
    s.pucks = s.pucks.filter(p => {
      p.x += p.vx;
      p.y += p.vy;

      // wall bounce
      if (p.x - p.radius < 0)  { p.x = p.radius;      p.vx =  Math.abs(p.vx); }
      if (p.x + p.radius > W)  { p.x = W - p.radius;  p.vx = -Math.abs(p.vx); }
      if (p.y - p.radius < 0)  { p.y = p.radius;       p.vy =  Math.abs(p.vy); }

      // goal scored (unlocked puck exits top)
      if (p.isUnlocked && p.y + p.radius < 0) {
        cbRef.current.onScore(100);
        cbRef.current.onGoal(p.word.en);
        return false;
      }

      // missed — life lost
      if (p.y - p.radius > H) {
        s.lives--;
        cbRef.current.onLifeLost();
        if (s.lives <= 0) {
          s.running = false;
          cbRef.current.onGameEnd();
        }
        return false;
      }

      // paddle collision
      const pl = s.player;
      const dx = p.x - pl.x;
      const dy = p.y - pl.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = p.radius + pl.radius;
      if (dist < minD && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        p.x += nx * (minD - dist);
        p.y += ny * (minD - dist);
        const dot = p.vx * nx + p.vy * ny;
        p.vx -= 2 * dot * nx;
        p.vy -= 2 * dot * ny;
        if (p.isUnlocked) {
          // extra upward kick when unlocked
          p.vy = -Math.abs(p.vy) * 1.4;
        }
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const maxSpd = 10 * s.speedMult;
        if (spd > maxSpd) { p.vx *= maxSpd / spd; p.vy *= maxSpd / spd; }
      }

      return true;
    });

    draw();
    s.raf = requestAnimationFrame(loop);
  }, [spawn, draw, canvasRef]);

  // ── controls ───────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    const s = state.current;
    s.running = true;
    s.lives = 5;
    s.score = 0;
    s.frame = 0;
    s.speedMult = 1;
    s.pucks = [];
    s.wordIdx = 0;
    s.wordPool = shuffle([...WORDS]);
    s.raf = requestAnimationFrame(loop);
  }, [loop]);

  const stop = useCallback(() => {
    state.current.running = false;
    cancelAnimationFrame(state.current.raf);
  }, []);

  const getScore = useCallback(() => state.current.score, []);

  const updatePlayer = useCallback((x: number, y: number) => {
    state.current.player.x = x;
    state.current.player.y = y;
  }, []);

  return { start, stop, getScore, updatePlayer, unlockByTranscript };
}
