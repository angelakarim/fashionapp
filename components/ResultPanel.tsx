type Props = {
  resultImage: string | null;
  isLoading: boolean;
};

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ animation: "tryon-spin 0.9s linear infinite" }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ResultPanel({ resultImage, isLoading }: Props) {
  return (
    <div className="relative flex min-h-[540px] w-full items-center justify-center border border-hairline bg-well">
      {isLoading && (
        <div className="absolute inset-0 animate-pulse bg-[#e8e8e8]" aria-hidden />
      )}

      {isLoading ? (
        <div className="relative flex flex-col items-center gap-4 text-muted">
          <Spinner className="h-8 w-8" />
          <span className="text-xs font-bold tracking-widest uppercase">
            Generating your look
          </span>
        </div>
      ) : resultImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resultImage}
            alt="Virtual try-on result"
            className="h-full max-h-[720px] w-full object-contain"
          />
          <a
            href={resultImage}
            download="virtual-try-on.png"
            className="absolute right-4 bottom-4 bg-ink px-5 py-2.5 text-xs font-bold tracking-widest text-white uppercase"
          >
            Download
          </a>
        </>
      ) : (
        <span className="px-6 text-center text-xs tracking-widest text-muted uppercase">
          Your result will appear here
        </span>
      )}
    </div>
  );
}
