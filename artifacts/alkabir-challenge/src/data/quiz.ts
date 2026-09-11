export interface Question {
  id: string;
  text: string;
  options: { id: string; label: string; isCorrect: boolean }[];
  sourceLabel: string;
  explanation: string;
}

/**
 * The challenge date is always the UTC calendar date. Viewer-local formatting
 * is only used for explaining when the next UTC reset will be visible locally.
 */
export function getChallengeDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function formatChallengeDateUTC(challengeDate: string = getChallengeDate()): string {
  const [year, month, day] = challengeDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return `${new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)} (UTC)`;
}

export function getNextChallengeReset(now: Date = new Date()): Date {
  const nextReset = new Date(now);
  nextReset.setUTCHours(24, 0, 0, 0);
  return nextReset;
}

export function formatNextChallengeReset(now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(getNextChallengeReset(now));
}

export const challengeQuestions: Question[] = [
  {
    id: "q1",
    text: "What is the first Surah of the Qur'an?",
    options: [
      { id: "opt1", label: "Al-Fatihah", isCorrect: true },
      { id: "opt2", label: "Al-Baqarah", isCorrect: false },
      { id: "opt3", label: "Al-Ikhlas", isCorrect: false },
      { id: "opt4", label: "An-Nas", isCorrect: false },
    ],
    sourceLabel: "Qur'an 1:1-7",
    explanation: "Surah Al-Fatihah is known as the 'Opening' of the Qur'an and is recited in every unit of daily prayers.",
  },
  {
    id: "q2",
    text: "Which Prophet built the Kaaba in Makkah with his son?",
    options: [
      { id: "opt1", label: "Musa (AS)", isCorrect: false },
      { id: "opt2", label: "Isa (AS)", isCorrect: false },
      { id: "opt3", label: "Ibrahim (AS)", isCorrect: true },
      { id: "opt4", label: "Nuh (AS)", isCorrect: false },
    ],
    sourceLabel: "Qur'an 2:127",
    explanation: "Prophet Ibrahim (AS) and his son Ismail (AS) raised the foundations of the Kaaba as a house of worship for One God.",
  },
  {
    id: "q3",
    text: "In which month was the Qur'an first revealed to Prophet Muhammad (SAW)?",
    options: [
      { id: "opt1", label: "Shawwal", isCorrect: false },
      { id: "opt2", label: "Ramadan", isCorrect: true },
      { id: "opt3", label: "Muharram", isCorrect: false },
      { id: "opt4", label: "Safar", isCorrect: false },
    ],
    sourceLabel: "Qur'an 2:185",
    explanation: "The month of Ramadan is that in which the Qur'an was revealed as a guidance for mankind.",
  },
  {
    id: "q4",
    text: "What is the first pillar of Islam?",
    options: [
      { id: "opt1", label: "Salah (Prayer)", isCorrect: false },
      { id: "opt2", label: "Zakat (Charity)", isCorrect: false },
      { id: "opt3", label: "Hajj (Pilgrimage)", isCorrect: false },
      { id: "opt4", label: "Shahada (Faith)", isCorrect: true },
    ],
    sourceLabel: "Sahih al-Bukhari 8",
    explanation: "The Shahada, the declaration of faith that there is no deity but Allah and Muhammad is His messenger, is the foundational pillar.",
  },
  {
    id: "q5",
    text: "The migration of the Prophet (SAW) from Makkah to Madinah is known as?",
    options: [
      { id: "opt1", label: "Isra", isCorrect: false },
      { id: "opt2", label: "Hijrah", isCorrect: true },
      { id: "opt3", label: "Mi'raj", isCorrect: false },
      { id: "opt4", label: "Tawaf", isCorrect: false },
    ],
    sourceLabel: "Seerah (Prophetic Biography)",
    explanation: "The Hijrah marks the journey of the Prophet (SAW) to Madinah in 622 CE, establishing the first Islamic community.",
  }
];
