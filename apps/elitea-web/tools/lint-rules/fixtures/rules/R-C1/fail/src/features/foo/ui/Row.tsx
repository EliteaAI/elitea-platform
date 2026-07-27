export function Row({ onSelect }: { onSelect: () => void }) {
  return <div onClick={onSelect} />;
}
