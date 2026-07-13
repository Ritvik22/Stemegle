import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  Binary,
  BrainCircuit,
  Calculator,
  Check,
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  GraduationCap,
  Lightbulb,
  Orbit,
  RotateCcw,
  Sparkles,
  Target,
  Trophy,
  Wrench,
  X,
} from 'lucide-react';
import {
  createLearningSession,
  getWeakAreaRecommendation,
  LEARNING_DIFFICULTIES,
  LEARNING_SUBJECTS,
  normalizeLearningDifficulty,
  normalizeLearningSubject,
} from './data/learning';
import './learning.css';

const SUBJECT_ICONS = {
  Mathematics: Calculator,
  Physics: Atom,
  Chemistry: FlaskConical,
  Biology: BrainCircuit,
  Space: Orbit,
  Computing: Binary,
  Engineering: Wrench,
};

const ANSWER_LABELS = ['A', 'B', 'C', 'D'];
const GUEST_MASTERY_KEY = 'stemegle_learning_mastery_v1';

function createAttemptId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readGuestMastery() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(GUEST_MASTERY_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function addGuestAttempt(current, attempt) {
  const key = `${attempt.category}:${attempt.difficulty.toLowerCase()}`;
  const previous = current[key] || { category: attempt.category, difficulty: attempt.difficulty, correct: 0, attempts: 0 };
  const next = {
    ...current,
    [key]: {
      category: attempt.category,
      difficulty: attempt.difficulty,
      correct: Number(previous.correct || 0) + (attempt.correct ? 1 : 0),
      attempts: Number(previous.attempts || 0) + 1,
      updatedAt: attempt.attemptedAt,
    },
  };
  try {
    globalThis.localStorage?.setItem(GUEST_MASTERY_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return next;
}

function guestMasteryAsHubData(guestMastery) {
  return {
    mastery: Object.values(guestMastery).map((entry) => ({
      category: entry.category,
      difficulty: entry.difficulty,
      masteryScore: entry.attempts ? (entry.correct / entry.attempts) * 100 : 0,
    })),
  };
}

function getGuestHistory(guestMastery, subject, difficulty) {
  const entry = guestMastery[`${subject}:${difficulty.toLowerCase()}`];
  if (!entry?.attempts) return null;
  return {
    accuracy: Math.round((entry.correct / entry.attempts) * 100),
    attempts: entry.attempts,
  };
}

function getMasteryFeedback(accuracy) {
  if (accuracy >= 90) return { label: 'Mastered', detail: 'You can move up a difficulty or reinforce another topic.' };
  if (accuracy >= 70) return { label: 'Building confidence', detail: 'One more focused round should make this feel automatic.' };
  if (accuracy >= 50) return { label: 'Developing', detail: 'Review the misses, then retry this subject.' };
  return { label: 'Needs reinforcement', detail: 'Slow down, review each explanation, and try an easier round.' };
}

function buildTopicStats(attempts) {
  const byTopic = new Map();
  attempts.forEach((attempt) => {
    const current = byTopic.get(attempt.topic) || { topic: attempt.topic, correct: 0, total: 0 };
    current.total += 1;
    current.correct += attempt.correct ? 1 : 0;
    byTopic.set(attempt.topic, current);
  });
  return [...byTopic.values()]
    .map((topic) => ({ ...topic, accuracy: Math.round((topic.correct / topic.total) * 100) }))
    .sort((left, right) => left.accuracy - right.accuracy || right.total - left.total);
}

function LearningHeader({ onExit }) {
  return (
    <header className="learning-header">
      <div className="learning-brand" aria-label="Stemegle learning mode">
        <span className="learning-brand-mark"><GraduationCap size={19} aria-hidden="true" /></span>
        <span>STEMEGLE <small>LEARN</small></span>
      </div>
      {onExit && (
        <button className="learning-icon-button" type="button" onClick={onExit} aria-label="Close learning mode" title="Close learning mode">
          <X aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

function SetupScreen({ difficulty, headingRef, isSignedIn, onDifficulty, onRecommendation, onStart, onSubject, recommendation, subject }) {
  return (
    <main className="learning-main learning-setup">
      <section className="learning-intro" aria-labelledby="learning-title">
        <p className="learning-eyebrow"><Sparkles size={14} aria-hidden="true" /> Focused practice</p>
        <h1 id="learning-title" ref={headingRef} tabIndex="-1">Train a skill. Understand the answer.</h1>
        <p>Complete a ten-question lesson with feedback after every answer.</p>
      </section>

      {recommendation && (
        <aside className="learning-recommendation" aria-label="Recommended learning focus">
          <span><Target aria-hidden="true" /></span>
          <div>
            <small>RECOMMENDED FROM YOUR PROGRESS</small>
            <strong>{recommendation.subject}{recommendation.topic ? `: ${recommendation.topic}` : ''}</strong>
            <p>{recommendation.accuracy === null ? 'This is your current weak area.' : `Recent mastery: ${Math.round(recommendation.accuracy)}%.`}</p>
          </div>
          <button type="button" onClick={onRecommendation}>Use focus</button>
        </aside>
      )}

      <section className="learning-picker" aria-labelledby="subject-heading">
        <div className="learning-section-heading">
          <span>01</span>
          <div><h2 id="subject-heading">Subject</h2><p>Pick one area for this lesson.</p></div>
        </div>
        <div className="learning-subject-grid">
          {LEARNING_SUBJECTS.map((option) => {
            const Icon = SUBJECT_ICONS[option.id];
            const selected = subject === option.id;
            return (
              <button
                className={`learning-subject${selected ? ' selected' : ''}`}
                type="button"
                key={option.id}
                onClick={() => onSubject(option.id)}
                aria-pressed={selected}
              >
                <span className="learning-subject-icon"><Icon aria-hidden="true" /></span>
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
                {selected && <Check className="learning-selection-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="learning-picker" aria-labelledby="difficulty-heading">
        <div className="learning-section-heading">
          <span>02</span>
          <div><h2 id="difficulty-heading">Difficulty</h2><p>Set the level for this lesson.</p></div>
        </div>
        <div className="learning-difficulty" role="group" aria-label="Choose difficulty">
          {LEARNING_DIFFICULTIES.map((option) => (
            <button
              type="button"
              key={option.id}
              className={difficulty === option.id ? 'selected' : ''}
              onClick={() => onDifficulty(option.id)}
              aria-pressed={difficulty === option.id}
            >
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="learning-start-row">
        <div className={`learning-save-note${isSignedIn ? ' signed-in' : ''}`}>
          {isSignedIn ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <span>{isSignedIn ? 'Attempts will be added to your progress.' : 'Guest lesson: progress stays on this device only.'}</span>
        </div>
        <button className="learning-primary" type="button" onClick={onStart}>
          Start lesson <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}

function LessonScreen({ attempts, difficulty, failedCount, headingRef, isSignedIn, onAnswer, onBack, onNext, pendingCount, question, questionIndex, selectedIndex, subject, total }) {
  const isAnswered = selectedIndex !== null;
  const wasCorrect = isAnswered && selectedIndex === question.answer;
  const progress = ((questionIndex + (isAnswered ? 1 : 0)) / total) * 100;

  return (
    <main className="learning-main learning-lesson">
      <div className="learning-lesson-topline">
        <button className="learning-back" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Change lesson
        </button>
        <div className="learning-lesson-labels">
          <span>{subject}</span><span>{difficulty}</span>
        </div>
      </div>

      <div className="learning-progress-meta">
        <span>Question {questionIndex + 1} of {total}</span>
        <span>{attempts.filter(({ correct }) => correct).length} correct</span>
      </div>
      <div className="learning-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)} aria-label="Lesson progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <article className="learning-question-card" aria-labelledby="learning-question">
        <div className="learning-question-meta">
          <span><BrainCircuit size={15} aria-hidden="true" /> {question.topic}</span>
          <span>{question.difficulty}</span>
        </div>
        <h1 id="learning-question" ref={headingRef} tabIndex="-1">{question.q}</h1>

        <div className="learning-answers" role="group" aria-label="Answer choices">
          {question.choices.map((choice, index) => {
            const isCorrectChoice = isAnswered && index === question.answer;
            const isWrongChoice = isAnswered && index === selectedIndex && index !== question.answer;
            const statusClass = isCorrectChoice ? ' correct' : isWrongChoice ? ' wrong' : '';
            return (
              <button
                type="button"
                key={`${index}-${choice}`}
                className={statusClass}
                onClick={() => onAnswer(index)}
                disabled={isAnswered}
                aria-pressed={selectedIndex === index}
              >
                <span>{ANSWER_LABELS[index] || index + 1}</span>
                <strong>{choice}</strong>
                {isCorrectChoice && <CheckCircle2 aria-label="Correct answer" />}
                {isWrongChoice && <X aria-label="Your answer was incorrect" />}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <section className={`learning-feedback ${wasCorrect ? 'correct' : 'wrong'}`} aria-live="polite">
            <span className="learning-feedback-icon">{wasCorrect ? <CheckCircle2 aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}</span>
            <div>
              <strong>{wasCorrect ? 'Correct' : `Not quite. The answer is ${question.choices[question.answer]}.`}</strong>
              <p>{question.explanation}</p>
            </div>
          </section>
        )}
      </article>

      <div className="learning-lesson-footer">
        <span>{isSignedIn
          ? failedCount > 0
            ? `${failedCount} ${failedCount === 1 ? 'answer has' : 'answers have'} not synced`
            : pendingCount > 0
              ? `Saving ${pendingCount} ${pendingCount === 1 ? 'answer' : 'answers'}...`
              : 'Progress synced'
          : 'Local-only guest lesson'}</span>
        <button className="learning-primary" type="button" onClick={onNext} disabled={!isAnswered}>
          {questionIndex === total - 1 ? 'See results' : 'Next question'} <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}

function ResultsScreen({ attempts, difficulty, guestHistory, headingRef, onAnother, onReview, onSetup, subject }) {
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const mistakes = attempts.length - correct;
  const accuracy = attempts.length ? Math.round((correct / attempts.length) * 100) : 0;
  const mastery = getMasteryFeedback(accuracy);
  const topicStats = buildTopicStats(attempts);

  return (
    <main className="learning-main learning-results">
      <section className="learning-result-hero">
        <span className="learning-result-icon"><Trophy aria-hidden="true" /></span>
        <p className="learning-eyebrow">{subject} / {difficulty}</p>
        <h1 ref={headingRef} tabIndex="-1">{mastery.label}</h1>
        <p>{mastery.detail}</p>
      </section>

      <section className="learning-score-band" aria-label="Lesson results">
        <div><strong>{accuracy}%</strong><span>Accuracy</span></div>
        <div><strong>{correct}/{attempts.length}</strong><span>Correct</span></div>
        <div><strong>{mistakes}</strong><span>To review</span></div>
      </section>

      {guestHistory && (
        <p className="learning-history-note">
          Local {subject} / {difficulty} mastery: <strong>{guestHistory.accuracy}%</strong> across {guestHistory.attempts} answers.
        </p>
      )}

      <section className="learning-topic-results" aria-labelledby="topic-results-heading">
        <div className="learning-section-heading">
          <span><Target aria-hidden="true" /></span>
          <div><h2 id="topic-results-heading">Topic mastery</h2><p>Your performance in this lesson.</p></div>
        </div>
        <div className="learning-topic-list">
          {topicStats.map((topic) => (
            <div key={topic.topic}>
              <span><strong>{topic.topic}</strong><small>{topic.correct} of {topic.total} correct</small></span>
              <div className="learning-topic-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={topic.accuracy} aria-label={`${topic.topic} mastery`}><span style={{ width: `${topic.accuracy}%` }} /></div>
              <b>{topic.accuracy}%</b>
            </div>
          ))}
        </div>
      </section>

      <div className="learning-result-actions">
        <button className="learning-secondary" type="button" onClick={onSetup}><ArrowLeft aria-hidden="true" /> Change focus</button>
        {mistakes > 0 && <button className="learning-secondary" type="button" onClick={onReview}><Lightbulb aria-hidden="true" /> Review mistakes</button>}
        <button className="learning-primary" type="button" onClick={onAnother}><RotateCcw aria-hidden="true" /> Practice again</button>
      </div>
    </main>
  );
}

function ReviewScreen({ attempts, headingRef, onBack }) {
  const mistakes = attempts.filter((attempt) => !attempt.correct);
  return (
    <main className="learning-main learning-review">
      <button className="learning-back" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back to results</button>
      <div className="learning-review-heading">
        <p className="learning-eyebrow"><Lightbulb size={14} aria-hidden="true" /> Mistake review</p>
        <h1 ref={headingRef} tabIndex="-1">Turn misses into memory.</h1>
        <p>{mistakes.length} {mistakes.length === 1 ? 'question' : 'questions'} to revisit.</p>
      </div>
      <div className="learning-mistake-list">
        {mistakes.map((attempt, index) => (
          <article key={`${attempt.questionKey}-${attempt.questionNumber}`}>
            <div className="learning-mistake-meta"><span>{String(index + 1).padStart(2, '0')}</span><strong>{attempt.topic}</strong></div>
            <h2>{attempt.prompt}</h2>
            <dl>
              <div><dt>Your answer</dt><dd className="wrong">{attempt.selectedAnswer}</dd></div>
              <div><dt>Correct answer</dt><dd className="correct">{attempt.correctAnswer}</dd></div>
            </dl>
            <div className="learning-review-explanation"><Lightbulb aria-hidden="true" /><p>{attempt.explanation}</p></div>
          </article>
        ))}
      </div>
      <button className="learning-primary learning-review-done" type="button" onClick={onBack}>Done reviewing <ArrowRight aria-hidden="true" /></button>
    </main>
  );
}

/**
 * Props:
 * - isSignedIn: marks attempts as syncable and changes the persistence notice.
 * - hubData: optional `{ weakAreas }`, `{ masteryByCategory }`, or `{ categoryMastery }` data.
 * - onAttempt(attempt): called after every answer; may return a promise.
 * - onAnalyticsEvent(name, properties, options): receives anonymous-safe lesson telemetry.
 * - onExit(): optional close action supplied by the parent route/shell.
 * - sessionSeed: stable seed used to reproduce lesson selection in tests or demos.
 * - initialFocus: optional `{ subject, difficulty }` preset from the player hub.
 */
export default function LearningMode({
  hubData = null,
  initialFocus = null,
  isSignedIn = false,
  onAnalyticsEvent,
  onAttempt,
  onExit,
  sessionSeed = 'learning-v1',
}) {
  const [guestMastery, setGuestMastery] = useState(readGuestMastery);
  const recommendation = useMemo(
    () => getWeakAreaRecommendation(isSignedIn ? hubData : guestMasteryAsHubData(guestMastery)),
    [guestMastery, hubData, isSignedIn],
  );
  const initialSubject = normalizeLearningSubject(initialFocus?.subject || initialFocus?.category)
    || recommendation?.subject
    || 'Mathematics';
  const initialDifficulty = normalizeLearningDifficulty(initialFocus?.difficulty)
    || recommendation?.difficulty
    || 'Easy';
  const [screen, setScreen] = useState('setup');
  const [subject, setSubject] = useState(initialSubject);
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  const [runNumber, setRunNumber] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [pendingAttemptIds, setPendingAttemptIds] = useState([]);
  const [failedAttempts, setFailedAttempts] = useState([]);
  const questionStartedAt = useRef(Date.now());
  const headingRef = useRef(null);
  const pendingAttemptIdsRef = useRef(new Set());
  const analyticsEventRef = useRef(onAnalyticsEvent);
  const activeLessonRef = useRef(null);

  const currentQuestion = questions[questionIndex];
  const announcement = screen === 'lesson' && currentQuestion
    ? `Question ${questionIndex + 1} of ${questions.length}. ${currentQuestion.q}`
    : screen === 'results'
      ? 'Lesson results'
      : screen === 'review'
        ? 'Mistake review'
        : 'Choose a learning subject and difficulty';

  analyticsEventRef.current = onAnalyticsEvent;

  function emitLearningAnalytics(eventName, properties, options = {}) {
    try {
      Promise.resolve(analyticsEventRef.current?.(eventName, properties, options)).catch(() => {});
    } catch {
      // Analytics is best effort and must never interrupt a lesson.
    }
  }

  function activeLessonProperties(active, extra = {}) {
    return {
      mode: 'learning',
      attempt_id: active.id,
      category: active.subject,
      difficulty: active.difficulty,
      total_rounds: active.total,
      questions_answered: active.answered,
      correct_answers: active.correct,
      status: active.audience,
      ...extra,
    };
  }

  function settleActiveLesson(eventName, reason = '', options = {}) {
    const active = activeLessonRef.current;
    if (!active || active.settled) return false;
    active.settled = true;
    const accuracy = active.answered ? Math.round((active.correct / active.answered) * 100) : 0;
    emitLearningAnalytics(eventName, activeLessonProperties(active, {
      accuracy,
      ...(reason ? { reason } : {}),
    }), options);
    return true;
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [questionIndex, screen]);

  useEffect(() => {
    const handlePageHide = (event) => {
      if (!event.persisted) settleActiveLesson('lesson_abandoned', 'page_exit', { keepalive: true });
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      settleActiveLesson('lesson_abandoned', 'navigation');
    };
  }, []);

  function persistAttempt(attempt) {
    if (!isSignedIn || !onAttempt || pendingAttemptIdsRef.current.has(attempt.attemptId)) return;
    pendingAttemptIdsRef.current.add(attempt.attemptId);
    setPendingAttemptIds([...pendingAttemptIdsRef.current]);
    setFailedAttempts((current) => current.filter((failure) => failure.attempt.attemptId !== attempt.attemptId));

    Promise.resolve()
      .then(() => onAttempt(attempt))
      .then(() => {
        pendingAttemptIdsRef.current.delete(attempt.attemptId);
        setPendingAttemptIds([...pendingAttemptIdsRef.current]);
      })
      .catch((error) => {
        pendingAttemptIdsRef.current.delete(attempt.attemptId);
        setPendingAttemptIds([...pendingAttemptIdsRef.current]);
        setFailedAttempts((current) => {
          const next = current.filter((failure) => failure.attempt.attemptId !== attempt.attemptId);
          return [...next, {
            attempt,
            message: error?.message || 'This answer could not be synced.',
          }];
        });
      });
  }

  function retryFailedAttempts() {
    failedAttempts.forEach(({ attempt }) => persistAttempt(attempt));
  }

  const startLesson = (nextRun = runNumber) => {
    settleActiveLesson('lesson_abandoned', 'restarted');
    const nextQuestions = createLearningSession({
      subject,
      difficulty,
      seed: `${sessionSeed}:${subject}:${difficulty}:${nextRun}`,
      count: 10,
    });
    const activeLesson = {
      id: createAttemptId(),
      subject,
      difficulty,
      total: nextQuestions.length,
      answered: 0,
      correct: 0,
      audience: isSignedIn ? 'authenticated' : 'guest',
      settled: false,
    };
    activeLessonRef.current = activeLesson;
    emitLearningAnalytics('lesson_started', activeLessonProperties(activeLesson));
    setQuestions(nextQuestions);
    setQuestionIndex(0);
    setSelectedIndex(null);
    setAttempts([]);
    questionStartedAt.current = Date.now();
    setScreen('lesson');
  };

  const answerQuestion = (answerIndex) => {
    if (selectedIndex !== null) return;
    const question = questions[questionIndex];
    const responseMs = Math.min(120000, Math.max(0, Date.now() - questionStartedAt.current));
    const correct = answerIndex === question.answer;
    const activeLesson = activeLessonRef.current;
    const attempt = {
      attemptId: createAttemptId(),
      questionKey: question.key,
      sessionId: activeLesson?.id || `${sessionSeed}:${subject}:${difficulty}:${runNumber}`,
      subject,
      category: subject,
      difficulty,
      classifiedDifficulty: question.difficulty,
      topic: question.topic,
      prompt: question.q,
      selectedAnswer: question.choices[answerIndex],
      selectedIndex: answerIndex,
      correctAnswer: question.choices[question.answer],
      correct,
      explanation: question.explanation,
      questionNumber: questionIndex + 1,
      responseMs,
      attemptedAt: new Date().toISOString(),
    };
    setSelectedIndex(answerIndex);
    setAttempts((current) => [...current, attempt]);
    if (activeLesson && !activeLesson.settled) {
      activeLesson.answered += 1;
      activeLesson.correct += correct ? 1 : 0;
      emitLearningAnalytics('learning_question_answered', activeLessonProperties(activeLesson, {
        round: questionIndex + 1,
        correct,
        response_ms: responseMs,
      }));
    }
    persistAttempt(attempt);
    if (!isSignedIn) setGuestMastery((current) => addGuestAttempt(current, attempt));
  };

  const nextQuestion = () => {
    if (selectedIndex === null) return;
    if (questionIndex === questions.length - 1) {
      settleActiveLesson('lesson_completed');
      setScreen('results');
      return;
    }
    setQuestionIndex((current) => current + 1);
    setSelectedIndex(null);
    questionStartedAt.current = Date.now();
  };

  const practiceAgain = () => {
    const nextRun = runNumber + 1;
    setRunNumber(nextRun);
    startLesson(nextRun);
  };

  const changeLesson = () => {
    settleActiveLesson('lesson_abandoned', 'changed_focus');
    setScreen('setup');
  };

  const exitLearning = () => {
    settleActiveLesson('lesson_abandoned', 'closed');
    onExit?.();
  };

  return (
    <div className="learning-shell">
      <LearningHeader onExit={onExit ? exitLearning : undefined} />
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      {isSignedIn && failedAttempts.length > 0 && (
        <div className="learning-sync-banner" role="alert">
          <CircleAlert aria-hidden="true" />
          <span><strong>{failedAttempts.length} {failedAttempts.length === 1 ? 'answer was' : 'answers were'} not saved.</strong><small>{failedAttempts[0].message}</small></span>
          <button type="button" onClick={retryFailedAttempts}>Retry now</button>
        </div>
      )}
      {screen === 'setup' && (
        <SetupScreen
          difficulty={difficulty}
          headingRef={headingRef}
          isSignedIn={isSignedIn}
          onDifficulty={setDifficulty}
          onRecommendation={() => {
            setSubject(recommendation.subject);
            if (recommendation.difficulty) setDifficulty(recommendation.difficulty);
          }}
          onStart={() => startLesson()}
          onSubject={setSubject}
          recommendation={recommendation}
          subject={subject}
        />
      )}
      {screen === 'lesson' && questions[questionIndex] && (
        <LessonScreen
          attempts={attempts}
          difficulty={difficulty}
          failedCount={failedAttempts.length}
          headingRef={headingRef}
          isSignedIn={isSignedIn}
          onAnswer={answerQuestion}
          onBack={changeLesson}
          onNext={nextQuestion}
          pendingCount={pendingAttemptIds.length}
          question={questions[questionIndex]}
          questionIndex={questionIndex}
          selectedIndex={selectedIndex}
          subject={subject}
          total={questions.length}
        />
      )}
      {screen === 'results' && (
        <ResultsScreen
          attempts={attempts}
          difficulty={difficulty}
          guestHistory={isSignedIn ? null : getGuestHistory(guestMastery, subject, difficulty)}
          headingRef={headingRef}
          onAnother={practiceAgain}
          onReview={() => setScreen('review')}
          onSetup={() => setScreen('setup')}
          subject={subject}
        />
      )}
      {screen === 'review' && <ReviewScreen attempts={attempts} headingRef={headingRef} onBack={() => setScreen('results')} />}
    </div>
  );
}
