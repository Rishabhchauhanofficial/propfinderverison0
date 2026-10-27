import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { chatHistory, clearChat, errorMessage, requestVisit, streamChat } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useShortlist } from '../../context/ShortlistContext.jsx';
import { formatINR } from '../../utils/format.js';

const SESSION_KEY = 'pf_chat_session';
const STARTERS = [
  'Find a 3 BHK flat in Gurgaon under ₹4 crore',
  'What should I verify before paying a booking amount?',
  '2 BHK for rent in Whitefield under 45k',
  'Help me list my property',
];

function sessionId() {
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s${Date.now().toString(36)}tmp`;
  }
}

/* Minimal, safe markdown: **bold**, _italic_, "- " bullets, line breaks. No HTML is ever injected. */
function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Markdown({ text }) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul-${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const line of lines) {
    const m = line.match(/^\s*[-•*]\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim()) out.push(<p key={`p-${out.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="md">{out}</div>;
}

function PropertyMini({ c }) {
  return (
    <Link to={`/property/${c.slug || c.id}`} className="chat-card">
      {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className="chat-card__ph" />}
      <span className="chat-card__body">
        <strong>{formatINR(c.price, c.listingType)}</strong>
        <span className="chat-card__title">{c.title}</span>
        <span className="tiny muted">
          {c.locality}, {c.city}
          {c.isDemo ? ' · Demo' : ''}
        </span>
      </span>
    </Link>
  );
}

function VisitForm({ propertyId, requiresAuth }) {
  const { user } = useAuth();
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState({ status: 'idle', msg: '' });
  if (requiresAuth && !user) {
    return (
      <div className="chat-action">
        <Link className="btn btn--primary btn--sm" to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>Sign in to request a visit</Link>
      </div>
    );
  }
  if (state.status === 'done') return <p className="chat-action chat-action--ok">{state.msg}</p>;
  const min = new Date(Date.now() + 60 * 60000).toISOString().slice(0, 16);
  return (
    <form
      className="chat-action chat-visit"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!when) return setState({ status: 'error', msg: 'Pick a date and time.' });
        setState({ status: 'busy', msg: '' });
        try {
          const r = await requestVisit({ propertyId, scheduledAt: new Date(when).toISOString(), note });
          setState({ status: 'done', msg: r.message });
        } catch (err) {
          setState({ status: 'error', msg: errorMessage(err) });
        }
      }}
    >
      <label className="small">
        Preferred date & time
        <input className="input" type="datetime-local" min={min} value={when} onChange={(e) => setWhen(e.target.value)} required />
      </label>
      <input className="input" placeholder="Note for the lister (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn--primary btn--sm" type="submit" disabled={state.status === 'busy'}>
        {state.status === 'busy' ? 'Sending…' : 'Request site visit'}
      </button>
      {state.status === 'error' && <span className="field-error">{state.msg}</span>}
    </form>
  );
}

function Message({ m, onSuggest }) {
  if (m.role === 'user') return <div className="msg msg--user">{m.content}</div>;
  return (
    <div className={`msg msg--bot${m.error ? ' msg--error' : ''}`}>
      {m.content ? <Markdown text={m.content} /> : <span className="typing" aria-label="Assistant is typing"><i /><i /><i /></span>}
      {m.cards?.length > 0 && (
        <div className="chat-cards">
          {m.cards.map((c) => (
            <PropertyMini key={c.id} c={c} />
          ))}
        </div>
      )}
      {m.actions?.map((a, i) =>
        a.type === 'link' ? (
          <Link key={i} to={a.href} className="chat-link">{a.label} →</Link>
        ) : a.type === 'site-visit' ? (
          <VisitForm key={i} propertyId={a.propertyId} requiresAuth={a.requiresAuth} />
        ) : null
      )}
      {m.citations?.length > 0 && (
        <details className="chat-sources">
          <summary>Sources ({m.citations.length})</summary>
          <ul>
            {m.citations.map((c, i) => (
              <li key={i}>
                <span className="tiny chat-src-type">{c.type === 'kb' ? 'Guide' : c.type}</span>{' '}
                {c.href ? c.href.startsWith('http') ? <a href={c.href} target="_blank" rel="noopener noreferrer">{c.label}</a> : <Link to={c.href}>{c.label}</Link> : c.label}
              </li>
            ))}
          </ul>
        </details>
      )}
      {m.source && m.source !== 'llm' && m.content && <span className="tiny muted chat-mode">Rule-based answer from PropFinder data</span>}
      {m.suggestions?.length > 0 && m.last && (
        <div className="chat-suggest">
          {m.suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => onSuggest(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Conversational assistant. `contextProperty` = { id, title } scopes questions to a listing.
 */
export default function ChatPanel({ contextProperty, initialMessage, onInitialConsumed, variant = 'widget' }) {
  const { user } = useAuth();
  const { compare } = useShortlist();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedHistory, setLoadedHistory] = useState(false);
  const scroller = useRef(null);
  const abortRef = useRef(null);
  const sid = useRef(sessionId());

  useEffect(() => {
    let cancelled = false;
    chatHistory(sid.current)
      .then((d) => {
        if (cancelled) return;
        setMessages((d.messages || []).slice(-20).map((m) => ({ role: m.role, content: m.content, cards: m.cards, citations: m.citations, source: m.source })));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadedHistory(true));
    return () => {
      cancelled = true;
      abortRef.current?.();
    };
  }, [user]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    (text) => {
      const message = String(text || '').trim();
      if (!message || busy) return;
      setInput('');
      setBusy(true);
      setMessages((prev) => [...prev.map((m) => ({ ...m, last: false })), { role: 'user', content: message }, { role: 'assistant', content: '', last: true }]);
      const patchLast = (fn) =>
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = fn(next[next.length - 1]);
          return next;
        });
      abortRef.current = streamChat(
        { message, sessionId: sid.current, propertyId: contextProperty?.id, compareIds: compare.map((c) => c.id) },
        {
          onMeta: (meta) => patchLast((m) => ({ ...m, cards: meta.cards, actions: meta.actions, citations: meta.citations, suggestions: meta.suggestions })),
          onDelta: (t, { replace } = {}) => patchLast((m) => ({ ...m, content: replace ? t : m.content + t })),
          onDone: (d) => {
            patchLast((m) => ({ ...m, source: d?.source }));
            setBusy(false);
          },
          onError: (err) => {
            patchLast((m) => ({ ...m, error: true, content: m.content || `${err.message} You can still search listings from the Buy and Rent pages.` }));
            setBusy(false);
          },
        }
      );
    },
    [busy, contextProperty, compare]
  );

  useEffect(() => {
    if (initialMessage && loadedHistory) {
      send(initialMessage);
      onInitialConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, loadedHistory]);

  async function reset() {
    abortRef.current?.();
    await clearChat(sid.current).catch(() => {});
    setMessages([]);
    setBusy(false);
  }

  return (
    <div className={`chat chat--${variant}`}>
      {contextProperty && (
        <div className="chat__context small">
          Asking about <strong>{contextProperty.title}</strong>
        </div>
      )}
      <div className="chat__messages" ref={scroller} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat__welcome">
            <p>
              <strong>Hi! I’m the PropFinder assistant.</strong> I search real listings on this site, explain RERA status and nearby facilities for a property, compare homes and help you list yours.
            </p>
            <p className="small muted">I only answer from PropFinder data and say so when something isn’t known. I’m not a lawyer or financial adviser.</p>
            <div className="chat-suggest">
              {(contextProperty
                ? ['Is the RERA registration verified?', 'Are there good schools within 3 km?', 'Is this priced higher than similar listings?', 'Arrange a site visit']
                : STARTERS
              ).map((s) => (
                <button key={s} type="button" className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} m={m} onSuggest={send} />
        ))}
      </div>
      <form
        className="chat__input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label className="sr-only" htmlFor={`chat-input-${variant}`}>Message the assistant</label>
        <input
          id={`chat-input-${variant}`}
          className="input"
          placeholder={contextProperty ? 'Ask about this property…' : 'Ask about properties, RERA, prices…'}
          value={input}
          maxLength={1500}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !input.trim()} aria-label="Send">
          {busy ? '…' : '➤'}
        </button>
      </form>
      <div className="chat__foot tiny muted">
        <button type="button" className="link-btn tiny" onClick={reset}>New conversation</button>
        <span>Answers may be incomplete — verify important details.</span>
      </div>
    </div>
  );
}
