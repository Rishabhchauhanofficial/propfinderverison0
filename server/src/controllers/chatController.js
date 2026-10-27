import crypto from 'node:crypto';
import { Conversation } from '../models/index.js';
import { answer } from '../services/chatService.js';
import { badRequest, cleanText, isId, str, wrap } from '../utils/http.js';

const MAX_TURNS_STORED = 60;

const validSession = (s) => /^[a-zA-Z0-9_-]{8,64}$/.test(String(s || ''));

async function loadConversation(req, sessionId) {
  // Signed-in users own their conversations; anonymous ones are keyed by the session id only.
  const filter = req.userId ? { user: req.userId, sessionId } : { user: null, sessionId };
  return Conversation.findOne(filter);
}

// POST /api/chat  { message, sessionId, propertyId?, compareIds?[] }  → text/event-stream
export async function chat(req, res) {
  const b = req.body || {};
  const message = cleanText(b.message, 1500);
  if (!message) return res.status(400).json({ error: 'Type a message.' });
  const sessionId = validSession(b.sessionId) ? b.sessionId : crypto.randomBytes(12).toString('hex');

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  let closed = false;
  req.on('close', () => {
    closed = true;
  });
  const emit = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let convo = await loadConversation(req, sessionId);
    if (!convo) convo = new Conversation({ user: req.userId || null, sessionId, messages: [] });
    const history = convo.messages.map((m) => ({ role: m.role, content: m.content }));
    const lastCards = [...convo.messages].reverse().find((m) => m.role === 'assistant' && m.cards?.length)?.cards || [];

    const result = await answer(
      {
        message,
        history,
        propertyId: isId(b.propertyId) ? b.propertyId : null,
        compareIds: (Array.isArray(b.compareIds) ? b.compareIds : []).filter(isId).slice(0, 4),
        lastCardIds: lastCards.map((c) => c.id).filter(isId),
        user: req.user ? { id: req.userId, role: req.role, name: req.user.name } : null,
      },
      emit
    );

    convo.contextPropertyId = isId(b.propertyId) ? b.propertyId : convo.contextPropertyId;
    convo.messages.push({ role: 'user', content: message });
    convo.messages.push({ role: 'assistant', content: result.text, cards: result.cards.slice(0, 6), citations: result.citations, source: result.source });
    if (convo.messages.length > MAX_TURNS_STORED) convo.messages = convo.messages.slice(-MAX_TURNS_STORED);
    await convo.save();
    emit('done', { sessionId, source: result.source });
  } catch (err) {
    console.error('[chat] error:', err.message);
    emit('error', { message: 'Sorry, something went wrong while answering. Please try again.' });
  } finally {
    res.end();
  }
}

export const history = wrap(async (req, res) => {
  const sessionId = str(req.query.sessionId);
  if (!validSession(sessionId)) throw badRequest('Invalid session');
  const convo = await loadConversation(req, sessionId);
  res.json({ sessionId, messages: convo?.messages || [] });
});

export const clear = wrap(async (req, res) => {
  const sessionId = str(req.query.sessionId);
  if (!validSession(sessionId)) throw badRequest('Invalid session');
  const filter = req.userId ? { user: req.userId, sessionId } : { user: null, sessionId };
  await Conversation.deleteOne(filter);
  res.json({ ok: true });
});
