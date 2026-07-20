import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useScrollReveal } from '@/hooks/useScrollReveal';

const screenshots = [
  { label: 'DaVinci Resolve', src: '/assets/Screenshot-Resolve.png', colour: 'accent' },
  { label: 'After Effects', src: '/assets/Screenshot-AE.png', colour: 'default' },
  { label: 'REAPER', src: '/assets/Screenshot-REAPER.png', colour: 'default' },
] as const;

export function Screenshots() {
  const [active, setActive] = useState(0);
  const { ref, visible } = useScrollReveal();

  return (
    <section id="screenshots" className="py-24 relative z-10">
      <div
        ref={ref}
        className={cn(
          'max-w-[900px] mx-auto px-8 transition-all duration-700',
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10',
        )}
      >
        <div className="text-center mb-10">
          <span className="site-label mb-4 inline-block">Screenshots</span>
          <h2 className="text-[clamp(1.8rem,4vw,2.5rem)] font-bold tracking-tight text-[#e0e0e0]">
            See it in action
          </h2>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-6">
          {screenshots.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setActive(i)}
              className={cn(
                'px-4 py-2 rounded-lg text-[0.8rem] font-medium transition-all border',
                active === i && s.colour === 'accent'
                  ? 'bg-accent/[0.08] text-accent border-accent/20'
                  : active === i
                    ? 'bg-white/[0.06] text-[#e0e0e0] border-white/10'
                    : 'text-[#666666] hover:text-[#888888] hover:bg-white/[0.02] border-transparent',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Image */}
        {(() => { const as = screenshots[active]; return (
        <div className={cn('site-card overflow-hidden', as.colour === 'accent' && 'ring-1 ring-accent/30')}>
          <img
            src={as.src}
            alt={as.label}
            className="w-full object-contain"
          />
        </div>
        )})()}
      </div>
    </section>
  );
}
