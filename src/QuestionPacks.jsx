import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Hash,
  ImagePlus,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteQuestionPack,
  fetchQuestionPack,
  fetchQuestionPacks,
  saveQuestionPack,
  uploadQuestionPackImage,
} from './lib/api';

const MAX_IMAGE_BYTES = 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function questionKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function blankQuestion() {
  return {
    clientKey: questionKey(),
    prompt: '',
    choices: ['', '', '', ''],
    answerIndex: 0,
    imageId: null,
    imageUrl: null,
    imageUploading: false,
  };
}

function draftFromPack(pack) {
  return {
    id: pack?.id || null,
    title: pack?.title || '',
    questions: pack?.questions?.length
      ? pack.questions.map((question) => ({ ...question, clientKey: questionKey(), imageUploading: false }))
      : [blankQuestion()],
  };
}

function PackEditor({ initialPack, onBack, onSaved, onHost }) {
  const [draft, setDraft] = useState(() => draftFromPack(initialPack));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputs = useRef({});

  function updateQuestion(index, patch) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => (
        questionIndex === index ? { ...question, ...patch } : question
      )),
    }));
    setNotice('');
  }

  function updateChoice(questionIndex, choiceIndex, value) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) => {
        if (index !== questionIndex) return question;
        const choices = [...question.choices];
        choices[choiceIndex] = value;
        return { ...question, choices };
      }),
    }));
    setNotice('');
  }

  function addQuestion() {
    if (draft.questions.length >= 50) return;
    setDraft((current) => ({ ...current, questions: [...current.questions, blankQuestion()] }));
    setNotice('');
  }

  function removeQuestion(index) {
    if (draft.questions.length === 1) return;
    setDraft((current) => ({
      ...current,
      questions: current.questions.filter((_, questionIndex) => questionIndex !== index),
    }));
    setNotice('');
  }

  async function uploadImage(index, file) {
    setError('');
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      setError('Images must be PNG, JPEG, WebP, or GIF files no larger than 1 MB.');
      return;
    }
    updateQuestion(index, { imageUploading: true });
    try {
      const image = await uploadQuestionPackImage(file);
      updateQuestion(index, { imageId: image.id, imageUrl: image.url, imageUploading: false });
    } catch (uploadError) {
      updateQuestion(index, { imageUploading: false });
      setError(uploadError.message || 'Image upload failed.');
    }
  }

  function validate() {
    if (!draft.title.trim()) return 'Give this pack a title.';
    for (const [index, question] of draft.questions.entries()) {
      if (!question.prompt.trim()) return `Question ${index + 1} needs a prompt.`;
      if (question.choices.some((choice) => !choice.trim())) return `Question ${index + 1} needs all four options.`;
      if (new Set(question.choices.map((choice) => choice.trim().toLowerCase())).size !== 4) {
        return `Question ${index + 1} needs four different options.`;
      }
      if (question.imageUploading) return `Wait for the image on question ${index + 1} to finish uploading.`;
    }
    return '';
  }

  async function save() {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return null;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await saveQuestionPack({
        id: draft.id,
        title: draft.title,
        questions: draft.questions.map(({ prompt, choices, answerIndex, imageId }) => ({
          prompt,
          choices,
          answerIndex,
          imageId,
        })),
      });
      const saved = await fetchQuestionPack(result.id);
      setDraft(draftFromPack(saved));
      setNotice('Pack saved to your account.');
      onSaved?.(saved);
      return saved;
    } catch (saveError) {
      setError(saveError.message || 'Could not save this question pack.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndHost() {
    const saved = await save();
    if (saved) onHost(saved);
  }

  return (
    <main className="pack-shell">
      <header className="pack-topbar">
        <button className="pack-back" onClick={onBack}><ArrowLeft size={17} /> My packs</button>
        <span><BookOpen size={18} /> Question pack editor</span>
        <button className="button button-small" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save pack'}</button>
      </header>
      <div className="pack-editor-layout">
        <aside className="pack-editor-sidebar">
          <p className="eyebrow">PACK DETAILS</p>
          <label>Pack title<input value={draft.title} onChange={(event) => { setDraft((current) => ({ ...current, title: event.target.value })); setNotice(''); }} placeholder="e.g. Algebra review" maxLength={80} /></label>
          <div className="pack-editor-count"><strong>{draft.questions.length}</strong><span>{draft.questions.length === 1 ? 'question' : 'questions'}</span></div>
          <p>Build up to 50 questions. Choose the correct option and optionally add one image per question.</p>
          <button className="button button-secondary" onClick={addQuestion} disabled={draft.questions.length >= 50}><Plus size={16} /> Add question</button>
          <button className="button" onClick={saveAndHost} disabled={saving}><Play size={16} /> Save & host</button>
        </aside>
        <section className="pack-question-list" aria-label="Question editor">
          {(error || notice) && <p className={`pack-editor-message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
          {draft.questions.map((question, questionIndex) => (
            <article className="pack-question-card" key={question.clientKey}>
              <div className="pack-question-head">
                <span>QUESTION {questionIndex + 1}</span>
                <button onClick={() => removeQuestion(questionIndex)} disabled={draft.questions.length === 1} aria-label={`Delete question ${questionIndex + 1}`}><Trash2 size={16} /> Delete</button>
              </div>
              <label>Question prompt<textarea value={question.prompt} onChange={(event) => updateQuestion(questionIndex, { prompt: event.target.value })} placeholder="What do you want players to answer?" maxLength={300} rows={3} /></label>
              <div className="pack-image-row">
                {question.imageUrl ? (
                  <div className="pack-image-preview">
                    <img src={question.imageUrl} alt={`Question ${questionIndex + 1} preview`} />
                    <button onClick={() => updateQuestion(questionIndex, { imageId: null, imageUrl: null })}><X size={15} /> Remove image</button>
                  </div>
                ) : (
                  <button className="pack-image-upload" onClick={() => fileInputs.current[question.clientKey]?.click()} disabled={question.imageUploading}>
                    {question.imageUploading ? <Upload className="upload-spin" /> : <ImagePlus />}
                    <span><strong>{question.imageUploading ? 'Uploading…' : 'Add an image'}</strong><small>PNG, JPEG, WebP, or GIF · 1 MB max</small></span>
                  </button>
                )}
                <input ref={(node) => { fileInputs.current[question.clientKey] = node; }} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => uploadImage(questionIndex, event.target.files?.[0])} hidden />
              </div>
              <fieldset className="pack-options">
                <legend>Answer options <small>Select the correct answer</small></legend>
                {question.choices.map((choice, choiceIndex) => (
                  <label className={question.answerIndex === choiceIndex ? 'pack-option correct' : 'pack-option'} key={`${question.clientKey}-${choiceIndex}`}>
                    <input type="radio" name={`answer-${question.clientKey}`} checked={question.answerIndex === choiceIndex} onChange={() => updateQuestion(questionIndex, { answerIndex: choiceIndex })} />
                    <span>{String.fromCharCode(65 + choiceIndex)}</span>
                    <input aria-label={`Question ${questionIndex + 1} option ${String.fromCharCode(65 + choiceIndex)}`} value={choice} onChange={(event) => updateChoice(questionIndex, choiceIndex, event.target.value)} placeholder={`Option ${String.fromCharCode(65 + choiceIndex)}`} maxLength={160} />
                    {question.answerIndex === choiceIndex && <Check size={17} />}
                  </label>
                ))}
              </fieldset>
            </article>
          ))}
          <button className="pack-add-question" onClick={addQuestion} disabled={draft.questions.length >= 50}><Plus /> Add another question</button>
        </section>
      </div>
    </main>
  );
}

export function QuestionPackStudio({ accountName, onBack, onHost }) {
  const [packs, setPacks] = useState(null);
  const [editorPack, setEditorPack] = useState(undefined);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function loadPacks() {
    setError('');
    try {
      setPacks(await fetchQuestionPacks());
    } catch (loadError) {
      setPacks([]);
      setError(loadError.message || 'Could not load your question packs.');
    }
  }

  useEffect(() => { loadPacks(); }, []);

  async function edit(packId) {
    setBusyId(packId);
    setError('');
    try {
      setEditorPack(await fetchQuestionPack(packId));
    } catch (loadError) {
      setError(loadError.message || 'Could not open this question pack.');
    } finally {
      setBusyId('');
    }
  }

  async function host(packId) {
    setBusyId(packId);
    setError('');
    try {
      onHost(await fetchQuestionPack(packId));
    } catch (loadError) {
      setError(loadError.message || 'Could not host this question pack.');
    } finally {
      setBusyId('');
    }
  }

  async function remove(pack) {
    setBusyId(pack.id);
    setError('');
    try {
      await deleteQuestionPack(pack.id);
      setDeleteTarget(null);
      await loadPacks();
    } catch (deleteError) {
      setError(deleteError.message || 'Could not delete this question pack.');
    } finally {
      setBusyId('');
    }
  }

  if (editorPack !== undefined) {
    return <PackEditor initialPack={editorPack} onBack={() => { setEditorPack(undefined); loadPacks(); }} onSaved={loadPacks} onHost={onHost} />;
  }

  return (
    <main className="pack-shell pack-library-screen">
      <header className="pack-topbar">
        <button className="pack-back" onClick={onBack}><ArrowLeft size={17} /> Home</button>
        <span><BookOpen size={18} /> {accountName}'s question packs</span>
        <button className="button button-small" onClick={() => setEditorPack(null)}><Plus size={15} /> New pack</button>
      </header>
      <section className="pack-library">
        <div className="pack-library-hero">
          <span className="modal-icon"><BookOpen /></span>
          <p className="eyebrow">CREATE. HOST. COMPETE.</p>
          <h1>Your question packs</h1>
          <p>Write your own questions, add images, save them to your account, then invite players with a live game PIN.</p>
          <button className="button button-large" onClick={() => setEditorPack(null)}><Plus /> Create a question pack</button>
        </div>
        {error && <p className="pack-editor-message error" role="alert">{error}</p>}
        {packs === null && <div className="pack-library-empty">Loading your saved packs…</div>}
        {packs?.length === 0 && !error && <div className="pack-library-empty"><BookOpen /><strong>No packs yet</strong><span>Create your first set of questions and host it for friends.</span></div>}
        {packs?.length > 0 && (
          <div className="pack-grid">
            {packs.map((pack) => (
              <article className="pack-tile" key={pack.id}>
                <div className="pack-tile-icon"><BookOpen /></div>
                <small>{pack.questionCount} {pack.questionCount === 1 ? 'QUESTION' : 'QUESTIONS'}</small>
                <h2>{pack.title}</h2>
                <p>Saved {new Date(pack.updatedAt).toLocaleDateString()}</p>
                <div className="pack-tile-actions">
                  <button className="button" onClick={() => host(pack.id)} disabled={busyId === pack.id}><Play size={15} /> Host</button>
                  <button className="button button-secondary" onClick={() => edit(pack.id)} disabled={busyId === pack.id}><Pencil size={15} /> Edit</button>
                  <button className="pack-delete" onClick={() => setDeleteTarget(pack)} disabled={busyId === pack.id} aria-label={`Delete ${pack.title}`}><Trash2 size={16} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}>
          <section className="pack-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-pack-title">
            <span className="modal-icon"><Trash2 /></span>
            <h2 id="delete-pack-title">Delete “{deleteTarget.title}”?</h2>
            <p>This removes the saved pack and its questions from your account. This cannot be undone.</p>
            <div><button className="button button-secondary" onClick={() => setDeleteTarget(null)}>Keep pack</button><button className="button party-leave-button" onClick={() => remove(deleteTarget)} disabled={busyId === deleteTarget.id}>Delete pack</button></div>
          </section>
        </div>
      )}
    </main>
  );
}

export function GamePinJoin({ initialPin = '', onBack, onJoin }) {
  const [pin, setPin] = useState(initialPin);
  const [error, setError] = useState('');

  function submit(event) {
    event.preventDefault();
    const normalized = pin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (normalized.length !== 5) {
      setError('Enter the 5-character game PIN.');
      return;
    }
    onJoin(normalized);
  }

  return (
    <main className="game-shell pin-join-screen">
      <button className="pin-back" onClick={onBack}><ArrowLeft size={17} /> Back home</button>
      <section className="pin-join-card">
        <span className="modal-icon"><Hash /></span>
        <p className="eyebrow">JOIN A CUSTOM GAME</p>
        <h1>Enter the game PIN</h1>
        <p>Use the five characters shown by the host. You can join with an account or as a named guest.</p>
        <form onSubmit={submit}>
          <label>Game PIN<input autoFocus value={pin} onChange={(event) => setPin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} placeholder="ABCDE" maxLength={5} /></label>
          {error && <p className="pack-editor-message error" role="alert">{error}</p>}
          <button className="button button-large" type="submit">Join game <ArrowRight /></button>
        </form>
      </section>
    </main>
  );
}

export function HostedPackRoom({ code, pack, party, playerId, onLeave, onBack, createTeamConfig, createTournamentConfig }) {
  const [copied, setCopied] = useState(false);
  const { players, leaderId, status } = party;
  const isLeader = leaderId === playerId;
  const leader = players.find((member) => member.playerId === leaderId);
  const title = pack?.title || leader?.packTitle || 'Custom question game';
  const questionCount = pack?.questions?.length || Number(leader?.packQuestionCount) || null;
  const inviteLink = `${window.location.origin}${window.location.pathname}?game=${code}`;

  async function copyInvite(value = inviteLink) {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function start(mode) {
    if (!isLeader || players.length < 2 || !pack?.questions?.length || !party.channelRef.current) return;
    const config = mode === 'team'
      ? createTeamConfig(code, players, leaderId, pack)
      : createTournamentConfig(code, players, leaderId, pack);
    party.channelRef.current.send({ type: 'broadcast', event: 'party-start', payload: { config } });
  }

  return (
    <main className="game-shell pack-host-screen">
      <button className="pin-back" onClick={onBack}><ArrowLeft size={17} /> Back</button>
      <section className="pack-host-card">
        <div className="pack-host-title">
          <span className="modal-icon"><BookOpen /></span>
          <div><p className="eyebrow">LIVE QUESTION PACK</p><h1>{title}</h1><p>{questionCount ? `${questionCount} custom questions` : 'The host is preparing the questions.'}</p></div>
        </div>
        <div className="game-pin-panel">
          <small>GAME PIN</small>
          <strong>{code}</strong>
          <button onClick={() => copyInvite(code)}><Copy size={16} /> {copied ? 'Copied' : 'Copy PIN'}</button>
          <span>or share <button onClick={() => copyInvite(inviteLink)}>the invite link</button></span>
        </div>
        {party.error && <p className="pack-editor-message error" role="alert">{party.error}</p>}
        <div className="pack-host-roster">
          <div><strong>{players.length} joined</strong><small>{isLeader ? 'You are the host' : `${leader?.name || 'The host'} chooses the mode`}</small></div>
          <section>
            {players.map((member) => <span key={member.playerId}><i>{member.name?.[0]?.toUpperCase()}</i>{member.name}{member.playerId === leaderId && <small>HOST</small>}</span>)}
          </section>
        </div>
        <div className="party-modes pack-mode-grid">
          <article className="party-mode"><span><Play /></span><h3>Team Battle</h3><p>Players split into two teams and rotate through every question in the pack.</p><button className="button" onClick={() => start('team')} disabled={!isLeader || players.length < 2 || !pack}>Start team battle</button></article>
          <article className="party-mode"><span><Hash /></span><h3>Tournament</h3><p>Players face off in 1v1 bracket duels until one custom-pack champion remains.</p><button className="button" onClick={() => start('tournament')} disabled={!isLeader || players.length < 2 || !pack}>Start tournament</button></article>
        </div>
        {status === 'connecting' && <p className="queue-note">Connecting to game room…</p>}
        {isLeader && players.length < 2 && <p className="queue-note">Waiting for at least one player to join.</p>}
        {!isLeader && <p className="queue-note">You're in. The host will choose a mode and start the game.</p>}
        <button className="pack-leave-room" onClick={onLeave}><X size={16} /> Leave game</button>
      </section>
    </main>
  );
}
