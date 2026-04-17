export interface Word {
  en: string;
  he: string[];
}

export const WORDS: Word[] = [
  { en: 'above',       he: ['מעל'] },
  { en: 'down',        he: ['למטה', 'לאורך'] },
  { en: 'kill',        he: ['להרוג'] },
  { en: 'round',       he: ['עגול', 'סיבוב'] },
  { en: 'would',       he: ['היה', 'הייתי'] },
  { en: 'company',     he: ['חברה'] },
  { en: 'form',        he: ['טופס', 'צורה'] },
  { en: 'pair',        he: ['זוג'] },
  { en: 'spend',       he: ['לבזבז', 'לבלות'] },
  { en: 'department',  he: ['מחלקה'] },
  { en: 'have got',    he: ['יש לי', 'חייב'] },
  { en: 'pass',        he: ['לעבור'] },
  { en: 'unusual',     he: ['יוצא דופן', 'לא רגיל'] },
  { en: 'a few',       he: ['כמה', 'מספר'] },
  { en: 'classmate',   he: ['חבר לכיתה', 'בן כיתה'] },
  { en: 'hear',        he: ['לשמוע'] },
  { en: 'meeting',     he: ['פגישה', 'ישיבה'] },
  { en: 'the truth',   he: ['האמת', 'אמת'] },
  { en: 'advice',      he: ['עצה'] },
  { en: 'clear',       he: ['ברור'] },
  { en: 'information', he: ['מידע'] },
  { en: 'news',        he: ['חדשות'] },
  { en: 'advise',      he: ['לייעץ'] },
  { en: 'effort',      he: ['מאמץ'] },
  { en: 'lie',         he: ['לשקר', 'שקר'] },
  { en: 'sure',        he: ['בטוח'] },
];

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
