import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** Lets pages tell the assistant which property the user is looking at. */
const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [contextProperty, setContextProperty] = useState(null); // { id, title }
  const [open, setOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');

  const ask = useCallback((message) => {
    setPendingMessage(message);
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({ contextProperty, setContextProperty, open, setOpen, pendingMessage, setPendingMessage, ask }),
    [contextProperty, open, pendingMessage, ask]
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
