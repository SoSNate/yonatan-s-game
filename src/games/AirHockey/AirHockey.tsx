import { useRef, useState, useEffect, useCallback } from 'react';
import { Mic, MicOff, Trophy } from 'lucide-react';
import { useAirHockeyLoop } from './useAirHockeyLoop';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useLocalStorage } from '../../hooks/useLocalStorage';

type Phase = 'MENU' | 'PLAYING' | 'GAME_OVER';

interface LeaderEntry { name: string; score: number; date: string; }

const CANVAS_W = 360;
const CANVAS_H = 600;

export function AirHockey() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase]           = useState<Phase>('MENU');
  const [lives, setLives]           = useState(5);
  const [score, setScore]           = useState(0);
  const [helperLabel, setHelperLabel] = useState('');
  const [currentLang, setCurrentLang] = useState<'he-IL' | 'en-US'>('he-IL');
  const [nameInput, setNameInput]   = useState('');
  const [showLeader, setShowLeader] = useState(false);
  const [leaderboard, setLeaderboard] = useLocalStorage<LeaderEntry[]>('yonatan_hockey_scores', []);

  const scoreRef = useRef(0);
  const livesRef = useRef(5);

  const speech = useSpeechRecognition('he-IL');

  const { start, stop, updatePlayer, unlockByTranscript } = useAirHockeyLoop(
    canvasRef as React.RefObject<HTMLCanvasElement>,
    {
      onScore: (pts) => {
        scoreRef.current += pts;
        setScore(s => s + pts);
      },
      onLifeLost: () => {
        livesRef.current -= 1;
        setLives(livesRef.current);
      },
      onGoal: (_wordEn) => {},
      onPuckSpawned: (label, lang) => {
        setHelperLabel(label);
        setCurrentLang(lang);
        speech.switchLang(lang);
      },
      onGameEnd: () => {
        speech.stop();
        setPhase('GAME_OVER');
      },
    }
  );

  // ── pointer handling ───────────────────────────────────────────────────────
  const toCanvasXY = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: CANVAS_W / 2, y: CANVAS_H - 80 };
    const r = el.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width)  * CANVAS_W,
      y: ((clientY - r.top)  / r.height) * CANVAS_H,
    };
  }, []);

  const onMouseMove  = useCallback((e: React.MouseEvent)  => { if (phase === 'PLAYING') { const p = toCanvasXY(e.clientX, e.clientY); updatePlayer(p.x, p.y); } }, [phase, toCanvasXY, updatePlayer]);
  const onTouchMove  = useCallback((e: React.TouchEvent)  => { if (phase === 'PLAYING') { e.preventDefault(); const t = e.touches[0]; const p = toCanvasXY(t.clientX, t.clientY); updatePlayer(p.x, p.y); } }, [phase, toCanvasXY, updatePlayer]);

  // ── game control ───────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    scoreRef.current = 0;
    livesRef.current = 5;
    setScore(0);
    setLives(5);
    setHelperLabel('');
    setShowLeader(false);
    setPhase('PLAYING');
    start();
    speech.start(unlockByTranscript);
  }, [start, speech, unlockByTranscript]);

  const saveScore = useCallback(() => {
    if (!nameInput.trim()) return;
    const entry: LeaderEntry = {
      name: nameInput.trim(),
      score: scoreRef.current,
      date: new Date().toLocaleDateString('he-IL'),
    };
    setLeaderboard(prev =>
      [...prev, entry].sort((a, b) => b.score - a.score).slice(0, 10)
    );
    setNameInput('');
    setShowLeader(true);
  }, [nameInput, setLeaderboard]);

  useEffect(() => () => { stop(); speech.stop(); }, [stop, speech]);

  const hearts = Array.from({ length: 5 }, (_, i) => (
    <span key={i} className={`text-xl transition-all ${i < lives ? 'opacity-100' : 'opacity-20 grayscale'}`}>❤️</span>
  ));

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-slate-950 flex flex-col items-center justify-center select-none"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0f2a4a 0%, #050d1a 70%)' }}
    >
      {/* ── HUD ── */}
      {phase === 'PLAYING' && (
        <div className="w-full max-w-[360px] flex justify-between items-center px-2 mb-2">
          <div className="text-white font-black text-lg tabular-nums">{score.toLocaleString()}</div>
          <div className="flex gap-0.5">{hearts}</div>
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full border transition-all ${
            speech.isListening
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-900/20'
              : 'text-slate-500 border-slate-700/40'
          }`}>
            {speech.isListening ? <Mic size={13} /> : <MicOff size={13} />}
            {currentLang === 'he-IL' ? 'עברית' : 'English'}
          </div>
        </div>
      )}

      {/* ── Canvas ── */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block rounded-2xl border border-slate-700/60 touch-none"
          style={{ maxHeight: 'calc(100svh - 120px)', width: 'auto', boxShadow: '0 0 40px #0f2a4a' }}
          onMouseMove={onMouseMove}
          onTouchMove={onTouchMove}
        />

        {/* ── helper label ── */}
        {phase === 'PLAYING' && helperLabel && (
          <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none">
            <div className="bg-slate-900/85 text-yellow-300 text-xs font-bold px-3 py-1.5 rounded-full border border-yellow-500/30 backdrop-blur-sm">
              {helperLabel}
            </div>
          </div>
        )}

        {/* ── interim transcript ── */}
        {phase === 'PLAYING' && speech.interim && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
            <div className="bg-slate-900/85 text-slate-300 text-sm px-3 py-1.5 rounded-full border border-slate-600/40 italic backdrop-blur-sm">
              {speech.interim}
            </div>
          </div>
        )}

        {/* ── MENU overlay ── */}
        {phase === 'MENU' && (
          <div className="absolute inset-0 rounded-2xl bg-slate-950/92 backdrop-blur-sm flex flex-col items-center justify-center gap-5 px-6">
            <div className="text-6xl">🏒</div>
            <div className="text-center">
              <h1 className="text-3xl font-black text-white mb-1">הוקי אוויר</h1>
              <p className="text-slate-400 text-sm">יונתן</p>
            </div>
            <p className="text-slate-400 text-sm text-center leading-relaxed">
              הזז את הכן בעכבר או מגע.<br />
              כשפאק מופיע — תרגם בקול כדי לפתוח אותו,<br />
              ואז שלח אותו לשער העליון!
            </p>

            {!speech.isSupported && (
              <p className="text-amber-400 text-xs text-center bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-2">
                ⚠️ זיהוי קול דורש Chrome
              </p>
            )}

            <button
              onClick={startGame}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white font-black text-xl py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-orange-900/40"
            >
              התחל!
            </button>

            {leaderboard.length > 0 && (
              <button
                onClick={() => setShowLeader(true)}
                className="flex items-center gap-2 text-slate-400 hover:text-yellow-400 text-sm transition-colors"
              >
                <Trophy size={15} />
                טבלת שיאים
              </button>
            )}

            {/* inline leaderboard */}
            {showLeader && leaderboard.length > 0 && (
              <div className="w-full bg-slate-900/80 border border-slate-700/40 rounded-xl p-3 mt-1">
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

        {/* ── GAME OVER overlay ── */}
        {phase === 'GAME_OVER' && (
          <div className="absolute inset-0 rounded-2xl bg-slate-950/92 backdrop-blur-sm flex flex-col items-center justify-center gap-4 px-6">
            <div className="text-5xl">💀</div>
            <h2 className="text-3xl font-black text-white">נגמרו החיים!</h2>
            <p className="text-2xl font-black text-yellow-400">{scoreRef.current.toLocaleString()} נק׳</p>

            {/* name entry */}
            {!showLeader ? (
              <div className="w-full flex flex-col gap-3">
                <input
                  type="text"
                  dir="rtl"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveScore()}
                  placeholder="שם לשיאים..."
                  className="w-full bg-slate-800 border border-slate-600 focus:border-yellow-400 text-white text-center text-lg font-bold rounded-xl px-4 py-3 outline-none transition-colors placeholder-slate-600"
                  autoFocus
                />
                <button
                  onClick={saveScore}
                  disabled={!nameInput.trim()}
                  className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-900 font-black py-3 rounded-xl transition-all"
                >
                  שמור שיא
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

            <button
              onClick={startGame}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white font-black text-lg py-3 rounded-2xl transition-all active:scale-95"
            >
              שחק שוב
            </button>
            <button
              onClick={() => setPhase('MENU')}
              className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
            >
              תפריט ראשי
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
