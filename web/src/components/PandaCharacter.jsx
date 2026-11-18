export default function PandaCharacter({ shape = 'panda' }) {
  const character = shape === 'fox' ? 'fox' : 'red panda';
  return (
    <iframe
      className="panda-character"
      src={`/panda-character.html${character === 'fox' ? '?shape=fox' : ''}`}
      title={`Animated ${character} assistant`}
      aria-label={`Animated ${character} character`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={-1}
    />
  );
}
