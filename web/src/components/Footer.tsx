export function Footer() {
  return (
    <footer className="py-6 md:py-8 border-t border-[#2a2a2a] text-center text-[#444444] text-[0.75rem] font-mono tracking-[0.05em] relative z-10">
      <div className="max-w-[1100px] mx-auto px-5 md:px-8">
        <div className="flex justify-center gap-4 sm:gap-8 mb-3 flex-wrap">
          {[
            { label: 'GitHub', href: 'https://github.com/OseMine/ResolveLink' },
            { label: 'Docs', href: 'https://github.com/OseMine/ResolveLink/blob/main/docs/ARCHITECTURE.md' },
            { label: 'MIT License', href: 'https://github.com/OseMine/ResolveLink/blob/main/LICENSE' },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline"
            >
              {link.label}
            </a>
          ))}
        </div>
        <p>ResolveLink v1.0.0</p>
      </div>
    </footer>
  );
}
