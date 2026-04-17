import { X } from 'lucide-react';

interface Props {
  onExit: () => void;
}

export function ExitButton({ onExit }: Props) {
  return (
    <button
      onClick={onExit}
      className="fixed top-4 right-4 z-50 flex items-center gap-1.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-600/50 text-slate-300 hover:text-white px-3 py-2 rounded-xl text-sm font-semibold transition-all"
    >
      <X size={16} />
      יציאה
    </button>
  );
}
