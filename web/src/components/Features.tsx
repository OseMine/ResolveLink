import { cn } from '@/lib/utils';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { Zap, RefreshCw, PanelLeftOpen, Music, Globe, Gauge } from 'lucide-react';

const features = [
  {
    title: 'One-Click Send',
    desc: 'Select clips in Resolve, click send. Comps are created with correct resolution, framerate, and timecodes.',
    icon: <Zap size={18} />,
  },
  {
    title: 'Auto Round-Trip',
    desc: 'Render in AE or REAPER and the result syncs back to the Resolve timeline automatically.',
    icon: <RefreshCw size={18} />,
  },
  {
    title: 'CEP Extension',
    desc: 'A panel inside After Effects that picks up jobs, runs scripts, and handles rendering.',
    icon: <PanelLeftOpen size={18} />,
  },
  {
    title: 'REAPER Integration',
    desc: 'Send audio to REAPER for mixing with a unified control panel. Auto-import and export back.',
    icon: <Music size={18} />,
  },
  {
    title: 'Cross-Platform',
    desc: 'Windows, macOS, and Linux. Dark UI that matches DaVinci Resolve\'s aesthetic.',
    icon: <Globe size={18} />,
  },
  {
    title: 'Real-Time Status',
    desc: 'Live updates via WebSocket. Desktop UI shows connected apps, job progress, and sync state.',
    icon: <Gauge size={18} />,
  },
];

function FeatureCard({ feature, index }: { feature: (typeof features)[number]; index: number }) {
  const { ref, visible } = useScrollReveal();

  return (
    <div
      ref={ref}
      className={cn(
        'site-card p-4 md:p-5 transition-all duration-500',
        'hover:border-[#383838] hover:-translate-y-0.5',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10',
      )}
      style={{ transitionDelay: `${index * 80}ms` }}
    >
      <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-accent/[0.08] text-accent mb-3">
        {feature.icon}
      </div>
      <h3 className="text-[0.9rem] font-semibold text-[#cccccc] mb-1.5">{feature.title}</h3>
      <p className="text-[0.8rem] text-[#888888] leading-relaxed">{feature.desc}</p>
    </div>
  );
}

export function Features() {
  const { ref: headerRef, visible: headerVisible } = useScrollReveal();

  return (
    <section id="features" className="py-16 md:py-24 relative z-10">
      <div className="max-w-[1100px] mx-auto px-5 md:px-8">
        <div
          ref={headerRef}
          className={cn(
            'text-center mb-10 md:mb-14 transition-all duration-700',
            headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10',
          )}
        >
          <span className="site-label mb-4 inline-block">Features</span>
          <h2 className="text-[clamp(1.5rem,4vw,2.5rem)] font-bold tracking-tight text-[#e0e0e0] mb-3">
            Everything you need for a seamless round-trip
          </h2>
          <p className="text-[#888888] max-w-[440px] mx-auto text-[0.9rem] md:text-[0.95rem]">
            No more manual exports. Select, send, and let ResolveLink handle the rest.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {features.map((feature, i) => (
            <FeatureCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
