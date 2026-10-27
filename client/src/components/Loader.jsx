export default function Loader({ label = 'Loading…', inline = false }) {
  return (
    <div className={`loader${inline ? ' loader--inline' : ''}`} role="status" aria-live="polite">
      <span className="loader__spinner" aria-hidden="true" />
      <span className="loader__label">{label}</span>
    </div>
  );
}
