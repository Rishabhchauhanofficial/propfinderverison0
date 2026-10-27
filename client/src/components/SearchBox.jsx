import { useEffect, useId, useRef, useState } from 'react';
import { suggest } from '../api/client.js';
import { useDebounced } from '../hooks/useUi.js';

const ICONS = { city: '🏙️', locality: '📍', pin: '🔢', project: '🏗️', developer: '🏢' };

/**
 * Text input with server-side autocomplete (cities, localities, PIN codes,
 * projects, developers). onPick(item) fires for a suggestion; onSubmit(text)
 * for free text.
 */
export default function SearchBox({ value, onChange, onPick, onSubmit, placeholder, className = 'input input--lg', autoFocus = false }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(value, 220);
  const listId = useId();
  const wrap = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!debounced || debounced.trim().length < 2) {
      setItems([]);
      return undefined;
    }
    suggest(debounced.trim())
      .then((d) => {
        if (cancelled) return;
        setItems(d.items || []);
        setActive(-1);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onDown = (e) => wrap.current && !wrap.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function pick(item) {
    setOpen(false);
    onPick?.(item);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        pick(items[active]);
      } else {
        setOpen(false);
        onSubmit?.(value);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showList = open && items.length > 0;

  return (
    <div className="ac" ref={wrap}>
      <input
        className={className}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="ac__list" id={listId} role="listbox">
          {items.map((it, i) => (
            <li
              key={`${it.type}-${it.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`ac__item${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ac__icon" aria-hidden="true">{ICONS[it.type] || '🔎'}</span>
              <span className="ac__text">
                <strong>{it.label}</strong>
                <span className="muted small">{it.sub}</span>
              </span>
              <span className="ac__type">{it.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
