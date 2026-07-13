import { QUESTION_BANK } from './questions.js';

export const LEARNING_SUBJECTS = [
  { id: 'Mathematics', label: 'Mathematics', description: 'Numbers, algebra, geometry, and problem solving.' },
  { id: 'Physics', label: 'Physics', description: 'Motion, forces, energy, waves, and electricity.' },
  { id: 'Chemistry', label: 'Chemistry', description: 'Elements, compounds, reactions, and atomic structure.' },
  { id: 'Biology', label: 'Biology', description: 'Cells, organisms, genetics, and living systems.' },
  { id: 'Space', label: 'Space', description: 'Planets, stars, galaxies, and the universe.' },
  { id: 'Computing', label: 'Computing', description: 'Code, data, hardware, and digital systems.' },
  { id: 'Engineering', label: 'Engineering', description: 'Design, machines, structures, and electronics.' },
];

export const LEARNING_DIFFICULTIES = [
  { id: 'Easy', label: 'Easy', description: 'Core facts and one-step problems.' },
  { id: 'Medium', label: 'Medium', description: 'Applied concepts and multi-step thinking.' },
  { id: 'Hard', label: 'Hard', description: 'Advanced concepts and less familiar relationships.' },
];

const DIFFICULTY_ORDER = LEARNING_DIFFICULTIES.map(({ id }) => id);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stripPracticePrefix(prompt) {
  return String(prompt).replace(/^Practice \d+:\s*/i, '').trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
}

export function getLearningQuestionKey(question) {
  // The ordered choices are part of the identity because the server validates
  // a selected index, not a client-provided answer value.
  const fingerprint = JSON.stringify([
    question.category,
    stripPracticePrefix(question.q),
    question.choices,
    question.answer,
  ]);
  return `learn-${slugify(question.category)}-${stableHash(fingerprint).toString(16).padStart(8, '0')}`;
}

const TOPIC_RULES = {
  Mathematics: [
    ['Calculus', /derivative|integral|sin\(|cos\(|log/i],
    ['Probability', /probability|coin|chance/i],
    ['Geometry', /triangle|circle|rectangle|area|perimeter|angle|hypotenuse|slope/i],
    ['Algebra', /solve|\bx\b|f\(|equation|sequence|comes next/i],
    ['Number theory', /prime|factor|divisor|binary/i],
    ['Fractions and percent', /fraction|percent|%|decimal/i],
    ['Arithmetic', /\+|×|÷|squared|square root|median|sum/i],
  ],
  Physics: [
    ['Electricity', /electric|current|voltage|resistor|resistance|ohm|circuit|charge|ampere/i],
    ['Waves and optics', /wave|frequency|wavelength|light|sound|mirror|reflection|vacuum/i],
    ['Forces and motion', /force|speed|accelerat|momentum|gravity|gravitational|moving object/i],
    ['Energy and work', /energy|power|work|spring|joule|watt/i],
    ['Matter and heat', /density|pressure|temperature|absolute zero|gas/i],
    ['Units and measurement', /SI unit|unit of/i],
  ],
  Chemistry: [
    ['Elements and symbols', /element|symbol|gold|iron|oxygen|hydrogen|carbon|sodium|chlorine|helium/i],
    ['Compounds and formulas', /formula|water|salt|carbon dioxide|ethanol|molar mass/i],
    ['Acids and bases', /\bpH\b|acid|basic|neutral|litmus/i],
    ['Atomic structure', /atom|atomic|proton|electron|neutron|nucleus/i],
    ['Bonding', /bond|share electrons|ionic|covalent/i],
    ['Reactions and energy', /oxidation|catalyst|activation|reaction|affinity/i],
    ['Moles and particles', /mole|particles|Avogadro/i],
  ],
  Biology: [
    ['Cells', /cell|organelle|mitochond|ribosome|nucleus/i],
    ['Genetics', /DNA|heredit|chromosome|genetic|mutation/i],
    ['Human body', /organ|blood|brain|insulin|kidney|pancreas|skin|heart/i],
    ['Plants', /plant|photosynthesis|chloroplast|roots/i],
    ['Ecology', /ecosystem|producer|organism/i],
    ['Life processes', /enzyme|homeostasis|mitosis|respiration|growth|repair/i],
    ['Microbiology', /virus|bacteria|fungi|bacteriophage|mycology/i],
  ],
  Space: [
    ['Solar system', /planet|solar system|Moon|Sun|Mercury|Venus|Earth|Mars|Jupiter|Saturn|Neptune|Pluto/i],
    ['Stars', /star|supernova|fusion|Proxima|Polaris|Sirius/i],
    ['Galaxies', /galaxy|Milky Way|Andromeda/i],
    ['Gravity and orbits', /gravity|orbit|tides|satellite|International Space Station/i],
    ['Cosmology', /universe|black hole|event horizon|Hubble|light-year/i],
  ],
  Computing: [
    ['Programming', /algorithm|loop|Boolean|software bug|program/i],
    ['Web technology', /HTML|CSS|HTTP|website/i],
    ['Data and security', /database|data|encryption/i],
    ['Computer hardware', /CPU|RAM|memory|processor|bit|binary/i],
    ['Developer tools', /Git|version control/i],
    ['Logic', /logic gate|AND|true|false/i],
  ],
  Engineering: [
    ['Machines and motion', /machine|lever|pulley|gear|motor|pump|slip ring/i],
    ['Structures and materials', /structure|truss|strain|material|steel|galvan|factor of safety/i],
    ['Electronics', /circuit|MOSFET|BJT|impedance|electrical/i],
    ['Design process', /prototype|design|redundancy|3D print|manufacturing/i],
    ['Measurement and control', /sensor|measure|thermometer|gauge/i],
    ['Energy systems', /energy|heat|insulation|power/i],
  ],
};

export function getLearningTopic(question) {
  const prompt = stripPracticePrefix(question.q);
  const match = TOPIC_RULES[question.category]?.find(([, pattern]) => pattern.test(prompt));
  return match?.[0] || `${question.category} foundations`;
}

function generatedDifficulty(question, prompt) {
  if (!/^Practice \d+:/i.test(question.q)) return null;

  if (question.category === 'Mathematics') {
    if (/percent|%|squared/i.test(prompt)) return 'Hard';
    if (/×|rectangle|perimeter|area/i.test(prompt)) return 'Medium';
    return 'Easy';
  }

  if (question.category === 'Physics') {
    if (/accelerates|wave has frequency|resistor/i.test(prompt)) return 'Hard';
    if (/moves .* meters|work is done/i.test(prompt)) return 'Medium';
    return 'Easy';
  }

  if (question.category === 'Chemistry') {
    if (/bond|particle|substance|state of matter/i.test(prompt)) return 'Hard';
    if (/atomic number|pH/i.test(prompt)) return 'Medium';
    return 'Easy';
  }

  return null;
}

const ADVANCED_TERMS = /derivative|logarithm|probability|momentum|parallel circuit|ideal gas|activation energy|electron affinity|oxidation|molar|homeostasis|bacteriophage|cerebral cortex|mycology|event horizon|supernova|fusion|encryption|logic gate|impedance|MOSFET|factor of safety|strain gauge/i;
const APPLIED_TERMS = /calculate|solve|speed|force|energy|work|density|formula|process|system|convert|relationship|area|perimeter|angle|percentage|percent|current|voltage|resistance|orbit|chromosome|enzyme|algorithm|database|sensor|gear|motor/i;

function getDifficultyScore(question) {
  const prompt = stripPracticePrefix(question.q);
  const generated = generatedDifficulty(question, prompt);
  if (generated) return DIFFICULTY_ORDER.indexOf(generated) * 4;

  let score = 0;
  if (ADVANCED_TERMS.test(prompt)) score += 6;
  if (APPLIED_TERMS.test(prompt)) score += 2;
  if (/\d/.test(prompt)) score += 1;
  if (prompt.split(/\s+/).length > 13) score += 1;
  return score;
}

function getDifficultyFingerprint(question) {
  return `${question.category}|${stripPracticePrefix(question.q)}|${question.choices[question.answer]}`;
}

function buildDifficultyMap() {
  const map = new Map();
  for (const { id: subject } of LEARNING_SUBJECTS) {
    const unique = new Map();
    QUESTION_BANK
      .filter((question) => question.category === subject)
      .forEach((question) => unique.set(getDifficultyFingerprint(question), question));
    const ranked = [...unique.entries()].sort(([leftKey, left], [rightKey, right]) => {
      const scoreDifference = getDifficultyScore(left) - getDifficultyScore(right);
      return scoreDifference || stableHash(leftKey) - stableHash(rightKey);
    });
    ranked.forEach(([fingerprint], index) => {
      const percentile = index / ranked.length;
      map.set(fingerprint, percentile < 1 / 3 ? 'Easy' : percentile < 2 / 3 ? 'Medium' : 'Hard');
    });
  }
  return map;
}

const DIFFICULTY_BY_QUESTION = buildDifficultyMap();

export function classifyLearningDifficulty(question) {
  return DIFFICULTY_BY_QUESTION.get(getDifficultyFingerprint(question)) || 'Easy';
}

function mathExplanation(prompt, answer) {
  let match = prompt.match(/What is (-?\d+(?:\.\d+)?) \+ (-?\d+(?:\.\d+)?)\?/i);
  if (match) return `Add the two values: ${match[1]} + ${match[2]} = ${answer}.`;

  match = prompt.match(/What is (-?\d+(?:\.\d+)?) × (-?\d+(?:\.\d+)?)\?/i);
  if (match) return `Multiply the two factors: ${match[1]} × ${match[2]} = ${answer}.`;

  match = prompt.match(/Solve x \+ (-?\d+(?:\.\d+)?) = (-?\d+(?:\.\d+)?)\./i);
  if (match) return `Undo the addition by subtracting ${match[1]} from both sides: ${match[2]} - ${match[1]} = ${answer}.`;

  match = prompt.match(/What is (-?\d+(?:\.\d+)?)% of (-?\d+(?:\.\d+)?)\?/i);
  if (match) return `Convert ${match[1]}% to ${Number(match[1]) / 100}, then multiply by ${match[2]}. The result is ${answer}.`;

  match = prompt.match(/rectangle is (-?\d+(?:\.\d+)?) by (-?\d+(?:\.\d+)?).*area/i);
  if (match) return `Rectangle area is length × width: ${match[1]} × ${match[2]} = ${answer}.`;

  match = prompt.match(/rectangle is (-?\d+(?:\.\d+)?) by (-?\d+(?:\.\d+)?).*perimeter/i);
  if (match) return `Rectangle perimeter is 2 × (length + width): 2 × (${match[1]} + ${match[2]}) = ${answer}.`;

  match = prompt.match(/What is (-?\d+(?:\.\d+)?) squared\?/i);
  if (match) return `Squaring means multiplying a number by itself: ${match[1]} × ${match[1]} = ${answer}.`;

  match = prompt.match(/What is (-?\d+(?:\.\d+)?) ÷ (-?\d+(?:\.\d+)?)\?/i);
  if (match) return `Division asks how many groups of ${match[2]} fit into ${match[1]}. The quotient is ${answer}.`;

  return null;
}

function physicsExplanation(prompt, answer) {
  let match = prompt.match(/moves (-?\d+(?:\.\d+)?) meters in (-?\d+(?:\.\d+)?) seconds.*speed/i);
  if (match) return `Use speed = distance ÷ time: ${match[1]} ÷ ${match[2]} = ${answer}.`;

  match = prompt.match(/A (-?\d+(?:\.\d+)?) kg object accelerates at (-?\d+(?:\.\d+)?) m\/s².*force/i);
  if (match) return `Use Newton's second law, F = ma: ${match[1]} × ${match[2]} = ${answer}.`;

  match = prompt.match(/frequency (-?\d+(?:\.\d+)?) Hz and wavelength (-?\d+(?:\.\d+)?) m.*speed/i);
  if (match) return `Use wave speed = frequency × wavelength: ${match[1]} × ${match[2]} = ${answer}.`;

  match = prompt.match(/A (-?\d+(?:\.\d+)?) ohm resistor has (-?\d+(?:\.\d+)?) volts.*current/i);
  if (match) return `Use Ohm's law, I = V ÷ R: ${match[2]} ÷ ${match[1]} = ${answer}.`;

  match = prompt.match(/force of (-?\d+(?:\.\d+)?) N moves an object (-?\d+(?:\.\d+)?) m.*work/i);
  if (match) return `For force along the motion, work = force × distance: ${match[1]} × ${match[2]} = ${answer}.`;

  if (/SI unit of|unit of/i.test(prompt)) return `This is a units question. The standard unit requested in the prompt is ${answer}.`;
  return null;
}

function chemistryExplanation(prompt, answer) {
  let match = prompt.match(/atom has (\d+) protons.*atomic number/i);
  if (match) return `Atomic number equals the number of protons. With ${match[1]} protons, the atomic number is ${answer}.`;

  match = prompt.match(/solution with pH (\d+(?:\.\d+)?) is usually what/i);
  if (match) return `${match[1]} is above neutral pH 7, so the solution is ${String(answer).toLowerCase()}.`;

  if (/chemical symbol for/i.test(prompt)) return `Element symbols use exact capitalization. The symbol requested here is ${answer}.`;
  if (/formula for/i.test(prompt)) return `A chemical formula records the elements and their ratios. The formula requested here is ${answer}.`;
  if (/What pH is neutral/i.test(prompt)) return `At room temperature, the neutral point on the pH scale is ${answer}.`;
  return null;
}

export function getLearningExplanation(question) {
  const prompt = stripPracticePrefix(question.q);
  const answer = question.choices[question.answer];
  const generated = question.category === 'Mathematics'
    ? mathExplanation(prompt, answer)
    : question.category === 'Physics'
      ? physicsExplanation(prompt, answer)
      : question.category === 'Chemistry'
        ? chemistryExplanation(prompt, answer)
        : null;

  if (generated) return generated;

  const topic = getLearningTopic(question).toLowerCase();
  return `The correct answer is ${answer}. This ${topic} question tests which choice directly matches the fact or relationship named in the prompt.`;
}

export function decorateLearningQuestion(question) {
  return {
    ...question,
    key: getLearningQuestionKey(question),
    difficulty: classifyLearningDifficulty(question),
    topic: getLearningTopic(question),
    explanation: getLearningExplanation(question),
  };
}

const TRUSTED_LEARNING_QUESTIONS = new Map();
for (const sourceQuestion of QUESTION_BANK) {
  const question = decorateLearningQuestion(sourceQuestion);
  const trusted = Object.freeze({
    key: question.key,
    category: question.category,
    difficulty: question.difficulty,
    answer: question.answer,
    choiceCount: question.choices.length,
  });
  const existing = TRUSTED_LEARNING_QUESTIONS.get(trusted.key);
  if (existing && (
    existing.category !== trusted.category
    || existing.difficulty !== trusted.difficulty
    || existing.answer !== trusted.answer
    || existing.choiceCount !== trusted.choiceCount
  )) {
    throw new Error(`Conflicting learning question key: ${trusted.key}`);
  }
  TRUSTED_LEARNING_QUESTIONS.set(trusted.key, trusted);
}

export function getLearningQuestionByKey(questionKey) {
  return typeof questionKey === 'string'
    ? TRUSTED_LEARNING_QUESTIONS.get(questionKey) || null
    : null;
}

function selectionScore(seed, question) {
  return stableHash(`${seed}:${question.key}`);
}

export function createLearningSession({ subject, difficulty, seed = 'learning-v1', count = 10 }) {
  const normalizedCount = Math.max(1, Math.min(25, Number(count) || 10));
  const targetDifficulty = DIFFICULTY_ORDER.includes(difficulty) ? difficulty : 'Easy';
  const targetIndex = DIFFICULTY_ORDER.indexOf(targetDifficulty);
  const decorated = QUESTION_BANK
    .filter((question) => question.category === subject)
    .map(decorateLearningQuestion);

  if (!decorated.length) throw new Error(`Unknown learning subject: ${subject}`);

  const ordered = [...decorated].sort((left, right) => {
    const difficultyDistance = Math.abs(DIFFICULTY_ORDER.indexOf(left.difficulty) - targetIndex)
      - Math.abs(DIFFICULTY_ORDER.indexOf(right.difficulty) - targetIndex);
    if (difficultyDistance) return difficultyDistance;
    return selectionScore(seed, left) - selectionScore(seed, right);
  });

  const selected = [];
  const seenConcepts = new Set();
  for (const question of ordered) {
    const conceptKey = stripPracticePrefix(question.q).toLowerCase();
    if (seenConcepts.has(conceptKey)) continue;
    selected.push(question);
    seenConcepts.add(conceptKey);
    if (selected.length === normalizedCount) return selected;
  }

  for (const question of ordered) {
    if (selected.some(({ q }) => q === question.q)) continue;
    selected.push(question);
    if (selected.length === normalizedCount) break;
  }
  return selected;
}

export function normalizeLearningSubject(value) {
  const candidate = String(value || '').toLowerCase();
  return LEARNING_SUBJECTS.find(({ id }) => id.toLowerCase() === candidate)?.id || null;
}

export function normalizeLearningDifficulty(value) {
  const candidate = String(value || '').toLowerCase();
  return LEARNING_DIFFICULTIES.find(({ id }) => id.toLowerCase() === candidate)?.id || null;
}

function normalizeAccuracy(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
}

export function getWeakAreaRecommendation(hubData) {
  const directWeakArea = Array.isArray(hubData?.weakAreas)
    ? hubData.weakAreas.find((area) => normalizeLearningSubject(area?.subject || area?.category))
    : null;
  if (directWeakArea) {
    return {
      subject: normalizeLearningSubject(directWeakArea.subject || directWeakArea.category),
      difficulty: normalizeLearningDifficulty(directWeakArea.difficulty),
      topic: directWeakArea.topic || null,
      accuracy: normalizeAccuracy(directWeakArea.accuracy),
    };
  }

  if (Array.isArray(hubData?.mastery)) {
    const weakest = hubData.mastery
      .map((entry) => ({
        subject: normalizeLearningSubject(entry?.subject || entry?.category),
        difficulty: normalizeLearningDifficulty(entry?.difficulty),
        topic: entry?.topic || null,
        accuracy: normalizeAccuracy(entry?.masteryScore ?? entry?.accuracy),
      }))
      .filter(({ subject, accuracy }) => subject && accuracy !== null)
      .sort((left, right) => left.accuracy - right.accuracy)[0];
    if (weakest) return weakest;
  }

  const mastery = hubData?.masteryByCategory || hubData?.categoryMastery;
  if (!mastery || typeof mastery !== 'object') return null;
  const weakest = Object.entries(mastery)
    .map(([subject, value]) => ({ subject: normalizeLearningSubject(subject), value: normalizeAccuracy(value) }))
    .filter(({ subject, value }) => subject && Number.isFinite(value))
    .sort((left, right) => left.value - right.value)[0];

  return weakest ? { subject: weakest.subject, difficulty: null, topic: null, accuracy: weakest.value } : null;
}
