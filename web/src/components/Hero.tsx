import { useEffect, useRef, useState } from 'react';
import TextAnimator from '@/lib/text-animator';
import { Download, Github } from 'lucide-react';
import { WorkflowDiagram } from './WorkflowDiagram';

const LUA_URL = 'https://github.com/OseMine/ResolveLink/releases/latest/download/install-release.lua';

const installCmds: Record<string, string> = {
  windows: 'iex (iwr -UseBasicParsing "https://raw.githubusercontent.com/OseMine/ResolveLink/main/install.ps1").Content',
  macos: 'curl -fsSL https://raw.githubusercontent.com/OseMine/ResolveLink/main/install.sh | bash',
  linux: 'curl -fsSL https://raw.githubusercontent.com/OseMine/ResolveLink/main/install.sh | bash',
};

export function Hero() {
  const ran = useRef(false);
  const [cmd, setCmd] = useState('');

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) setCmd(installCmds.windows);
    else if (ua.includes('mac')) setCmd(installCmds.macos);
    else setCmd(installCmds.linux);
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    TextAnimator.animate({
      target: '#hero-line-1',
      selector: 'word',
      from: { opacity: 0, y: 30, blur: 6 },
      duration: 800,
      stagger: 100,
      delay: 600,
      easing: 'ease-out-expo',
    });

    TextAnimator.animate({
      target: '#hero-line-2',
      selector: 'word',
      from: { opacity: 0, scale: 0.8, y: 20 },
      duration: 900,
      stagger: 120,
      delay: 900,
      easing: 'spring',
    });

    TextAnimator.animate({
      target: '#hero-desc',
      selector: 'word',
      from: { opacity: 0, y: 20 },
      duration: 700,
      stagger: 40,
      delay: 1400,
      easing: 'ease-out-expo',
    });
  }, []);

  return (
    <section className="min-h-screen flex items-center justify-center text-center px-8 pt-28 pb-20 relative z-10">
      <div className="max-w-[800px]">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full bg-accent/[0.08] border border-accent/20 text-accent text-[0.75rem] font-medium opacity-0 translate-y-5 animate-fade-up [animation-delay:0.2s] [animation-fill-mode:forwards]">
          <span className="w-[7px] h-[7px] rounded-full bg-success animate-pulse-dot" />
          v1.0.0 &mdash; Now Available
        </div>

        <h1 className="font-extrabold leading-[1.05] tracking-tight mb-6 opacity-0 translate-y-7 animate-fade-up [animation-delay:0.4s] [animation-fill-mode:forwards]">
          <span id="hero-line-1" className="block text-[clamp(2.8rem,7vw,5rem)] text-[#e0e0e0]">Dynamic Link for</span>
          <span id="hero-line-2" className="block text-[clamp(2.8rem,7vw,5rem)] text-accent">
            DaVinci Resolve
          </span>
        </h1>

        <p id="hero-desc" className="text-[1.1rem] text-[#888888] max-w-[520px] mx-auto mb-10 opacity-0 translate-y-7 animate-fade-up [animation-delay:0.6s] [animation-fill-mode:forwards]">
          Bridge Resolve with After Effects and REAPER. One click to send, auto round-trip sync back.
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap opacity-0 translate-y-7 animate-fade-up [animation-delay:0.8s] [animation-fill-mode:forwards]">
          <a href={LUA_URL} download className="site-btn-primary">
            <Download size={16} />
            Download
          </a>
          <a
            href="https://github.com/OseMine/ResolveLink"
            target="_blank"
            rel="noopener noreferrer"
            className="site-btn-ghost"
          >
            <Github size={16} className="text-[#888888]" />
            GitHub
          </a>
        </div>

        {cmd && (
          <div className="site-card overflow-hidden text-left mt-10 opacity-0 translate-y-7 animate-fade-up [animation-delay:1s] [animation-fill-mode:forwards]">
            <pre className="p-4 font-mono text-[0.78rem] leading-6 text-[#cccccc] overflow-x-auto whitespace-pre">
              {cmd}
            </pre>
          </div>
        )}

        <WorkflowDiagram />
      </div>
    </section>
  );
}
