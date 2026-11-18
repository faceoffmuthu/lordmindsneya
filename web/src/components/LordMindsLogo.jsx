export default function LordMindsLogo({ className = '', title = 'Lord Minds', size = '100%', decorative = false }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 240 240" fill="none" xmlns="http://www.w3.org/2000/svg" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : title} aria-hidden={decorative || undefined}>
      <path d="M25 20H230V37H43L25 20Z" fill="#4F80B8" />
      <path d="M25 38L42 54V220H25V38Z" fill="#4F80B8" />
      <path d="M57 57L77 77V190H177L207 220H57V57Z" fill="#4F80B8" />
      <path d="M94 67L145 116L229 36V211L207 190V88L146 147L116 118V165H94V67Z" fill="#E0B509" />
    </svg>
  );
}
