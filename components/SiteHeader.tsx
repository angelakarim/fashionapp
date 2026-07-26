const NAV = [
  "New",
  "Try-On",
  "Swim",
  "Best Sellers",
  "Clothing",
  "Bras",
  "Underwear",
  "Shapewear",
  "Mens",
  "Accessories",
  "Sale",
];

const ACTIVE = "Try-On";

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function IconAccount() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" strokeLinecap="round" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6c0 5.8-8.5 11.3-8.5 11.3z" />
    </svg>
  );
}

function IconBag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
      <path d="M4 7h16l-1.2 13H5.2L4 7z" />
      <path d="M8.5 9.5V6a3.5 3.5 0 1 1 7 0v3.5" />
    </svg>
  );
}

export default function SiteHeader() {
  return (
    <header className="border-b border-hairline">
      <div className="flex items-center gap-8 px-6 py-4">
        <span className="shrink-0 text-2xl font-black italic tracking-tight">
          ATELIER
        </span>

        <nav className="hidden flex-1 md:block">
          <ul className="flex flex-wrap items-center gap-6">
            {NAV.map((item) => (
              <li key={item}>
                <span
                  aria-current={item === ACTIVE ? "page" : undefined}
                  className={
                    item === ACTIVE
                      ? "cursor-default text-[15px] font-bold underline underline-offset-4"
                      : "cursor-default text-[15px] font-medium text-ink"
                  }
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-5 text-ink md:ml-0">
          <IconSearch />
          <IconAccount />
          <IconHeart />
          <IconBag />
        </div>
      </div>
    </header>
  );
}
