export const QUESTIONS = [
  "Should homework be banned in schools?",
  "Is social media doing more harm than good?",
  "Should cities ban private cars from downtown?",
  "Is it better to be a specialist or a generalist?",
  "Should AI-generated art be allowed in competitions?",
  "Would a four-day work week make society better?",
  "Should college be free for everyone?",
  "Is fame worth the cost of privacy?",
  "Should video games be considered a sport?",
  "Is it ethical to keep animals in zoos?",
  "Should voting be mandatory?",
  "Does remote work kill company culture — and should we care?",
];

export function pickQuestion(exclude?: string): string {
  const pool = QUESTIONS.filter((q) => q !== exclude);
  const list = pool.length > 0 ? pool : QUESTIONS;
  return list[Math.floor(Math.random() * list.length)]!;
}
