import { useState, useEffect, useRef } from 'react';
import TextAnimator from '@/lib/text-animator';
import { cn } from '@/lib/utils';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { Copy, CheckCheck } from 'lucide-react';

type OS = 'windows' | 'macos' | 'linux';

function detectOS(): OS {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  return 'linux';
}

const installCmds: Record<OS, string> = {
  windows: 'iex (iwr -UseBasicParsing "https://raw.githubusercontent.com/OseMine/ResolveLink/main/install.ps1").Content',
  macos: 'curl -fsSL https://raw.githubusercontent.com/OseMine/ResolveLink/main/install.sh | bash',
  linux: 'curl -fsSL https://raw.githubusercontent.com/OseMine/ResolveLink/main/install.sh | bash',
};

const osLabels: Record<OS, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

export function Install() {
  const [os, setOs] = useState<OS>('windows');
  const [copied, setCopied] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const animated = useRef(false);
  const { ref, visible } = useScrollReveal({ threshold: 0.15 });

  useEffect(() => { setOs(detectOS()); }, []);

  useEffect(() => {
    if (!visible || animated.current || !titleRef.current) return;
    animated.current = true;
    const id = 'ta-install';
    titleRef.current.id = id;
    TextAnimator.animate({
      target: '#' + id,
      selector: 'word',
      from: { opacity: 0, y: 24, blur: 4 },
      duration: 700,
      stagger: 70,
      easing: 'ease-out-expo',
    });
  }, [visible]);

  const copy = () => {
    navigator.clipboard.writeText(installCmds[os]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="install" className="py-24 relative z-10">
      <div
        ref={ref}
        className={cn(
          'max-w-[700px] mx-auto px-8 text-center transition-all duration-700',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10',
        )}
      >
        <h2 ref={titleRef} className="text-[clamp(1.8rem,4vw,2.5rem)] font-bold tracking-tight mb-3 text-[#e0e0e0]">
          Get started
        </h2>
        <p className="text-[#888888] mb-10 text-[0.95rem]">
          One command to install &mdash; auto-detects your OS and sets everything up.
        </p>

        <div className="flex justify-center gap-2 mb-6">
          {(Object.keys(installCmds) as OS[]).map((key) => (
            <button
              key={key}
              onClick={() => { setOs(key); setCopied(false); }}
              className={cn(
                'px-4 py-2 rounded-lg text-[0.8rem] font-medium transition-all border',
                os === key
                  ? 'bg-accent/[0.08] text-accent border-accent/20'
                  : 'text-[#666666] border-transparent hover:text-[#888888] hover:bg-white/[0.02]',
              )}
            >
              {osLabels[key]}
            </button>
          ))}
        </div>

        <div className="site-card overflow-hidden text-left">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a]/50">
            <span className="text-[0.75rem] font-medium text-[#888888]">{osLabels[os]}</span>
            <button
              onClick={copy}
              className={cn(
                'flex items-center gap-1 text-[0.7rem] px-2 py-1 rounded border transition-all',
                copied
                  ? 'text-success border-success/30 bg-success/10'
                  : 'text-[#666666] border-[#2a2a2a] hover:text-[#888888] hover:border-[#383838]',
              )}
            >
              {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-4 font-mono text-[0.78rem] leading-6 text-[#cccccc] overflow-x-auto whitespace-pre">
            {installCmds[os]}
          </pre>
        </div>

        <p className="mt-4 text-[0.78rem] text-[#666666]">
          Installs dependencies, builds the project, and starts the server.
        </p>
      </div>
    </section>
  );
}
