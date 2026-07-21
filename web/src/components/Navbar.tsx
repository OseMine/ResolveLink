import { useState } from 'react';
import { Github, Menu, X } from 'lucide-react';

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 px-5 md:px-8 flex items-center justify-between bg-[#141414]/90 backdrop-blur-xl border-b border-[#2a2a2a]/50">
      <a href="#" className="flex items-center gap-2.5 no-underline">
        <div className="w-[9px] h-[9px] rounded-full bg-accent relative">
          <span className="absolute inset-0 rounded-full bg-accent animate-pulse-dot opacity-40" />
        </div>
        <span className="font-bold text-[0.7rem] tracking-[0.15em] uppercase text-[#aaaaaa]">
          ResolveLink
        </span>
      </a>

      {/* Desktop links */}
      <div className="hidden md:flex items-center gap-6">
        <a href="#features" className="text-[0.82rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline">
          Features
        </a>
        <a href="#screenshots" className="text-[0.82rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline">
          Screenshots
        </a>
        <a href="#install" className="text-[0.82rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline">
          Install
        </a>
        <a
          href="https://github.com/OseMine/ResolveLink"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[0.82rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline"
        >
          <Github size={14} />
          GitHub
        </a>
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(!open)}
        className="md:hidden flex items-center justify-center w-8 h-8 text-[#888888] hover:text-[#e0e0e0] transition-colors"
        aria-label="Toggle menu"
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile menu dropdown */}
      {open && (
        <div className="absolute top-14 left-0 right-0 bg-[#141414]/95 backdrop-blur-xl border-b border-[#2a2a2a]/50 md:hidden">
          <div className="flex flex-col px-5 py-3 gap-1">
            <a href="#features" onClick={() => setOpen(false)} className="py-2.5 text-[0.85rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline border-b border-[#2a2a2a]/50">
              Features
            </a>
            <a href="#screenshots" onClick={() => setOpen(false)} className="py-2.5 text-[0.85rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline border-b border-[#2a2a2a]/50">
              Screenshots
            </a>
            <a href="#install" onClick={() => setOpen(false)} className="py-2.5 text-[0.85rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline border-b border-[#2a2a2a]/50">
              Install
            </a>
            <a
              href="https://github.com/OseMine/ResolveLink"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 py-2.5 text-[0.85rem] font-medium text-[#888888] hover:text-[#e0e0e0] transition-colors no-underline"
            >
              <Github size={14} />
              GitHub
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
