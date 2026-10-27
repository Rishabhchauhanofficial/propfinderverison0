import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useChat } from '../../context/ChatContext.jsx';
import ChatPanel from './ChatPanel.jsx';

/** Floating assistant available on every page (hidden on the full-page assistant). */
export default function ChatWidget() {
  const { open, setOpen, contextProperty, pendingMessage, setPendingMessage } = useChat();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (pathname.startsWith('/assistant')) return null;

  return (
    <>
      <div className={`chat-widget${open ? ' is-open' : ''}`} role="dialog" aria-label="PropFinder assistant" aria-hidden={!open}>
        {open && (
          <>
            <header className="chat-widget__head">
              <span className="chat-widget__title">
                <span className="chat-widget__dot" aria-hidden="true" /> PropFinder Assistant
              </span>
              <button type="button" className="chat-widget__close" aria-label="Close assistant" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <ChatPanel contextProperty={contextProperty} initialMessage={pendingMessage} onInitialConsumed={() => setPendingMessage('')} />
          </>
        )}
      </div>
      <button
        type="button"
        className={`chat-fab${open ? ' is-open' : ''}`}
        aria-label={open ? 'Close assistant' : 'Open AI assistant'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '×' : '💬'}
        {!open && <span className="chat-fab__label">Ask AI</span>}
      </button>
    </>
  );
}
