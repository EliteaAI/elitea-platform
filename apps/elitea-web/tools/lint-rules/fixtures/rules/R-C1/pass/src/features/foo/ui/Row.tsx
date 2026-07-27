export function Row({ onSelect, label }: { onSelect: () => void; label: string }) {
  return (
    <button type="button" onClick={onSelect}>
      {label}
    </button>
  );
}
