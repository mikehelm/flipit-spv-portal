export function MakerCreditText({ className = '' }: { className?: string }) {
  return (
    <span
      aria-label="Made by Make with Mike"
      className={`whitespace-nowrap ${className}`}
    >
      <span className="text-silver2">Made by </span>
      <span className="font-semibold text-orange">Make with Mike</span>
    </span>
  )
}
