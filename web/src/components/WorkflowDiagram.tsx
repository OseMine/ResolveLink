const nodes = [
  { label: 'DaVinci Resolve', sub: 'Select & Send', icon: '/assets/resolve-icon.png' },
  { label: 'After Effects', sub: 'Auto Comp', icon: '/assets/ae-icon.svg' },
  { label: 'REAPER', sub: 'Audio Mix', icon: '/assets/reaper-icon.svg' },
];

function Arrow() {
  return (
    <div className="flex items-center justify-center text-[#383838] flex-shrink-0 max-md:rotate-90">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </div>
  );
}

export function WorkflowDiagram() {
  return (
    <div className="mt-16 opacity-0 translate-y-10 animate-fade-up [animation-delay:1s] [animation-fill-mode:forwards]">
      <div className="site-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a]/50 border-b border-[#2a2a2a]">
          <div className="w-[10px] h-[10px] rounded-full bg-[#ff5f57]" />
          <div className="w-[10px] h-[10px] rounded-full bg-[#febc2e]" />
          <div className="w-[10px] h-[10px] rounded-full bg-[#28c840]" />
          <span className="flex-1 text-center text-[0.75rem] text-[#555570] mr-7">
            ResolveLink Workflow
          </span>
        </div>

        <div className="p-8 flex items-center gap-6 max-md:flex-col max-md:gap-4">
          {nodes.map((node, i) => (
            <div key={node.label} className="contents">
              {i > 0 && <Arrow />}
              <div className="flex-1 flex flex-col items-center gap-3 py-6 px-4 bg-white/[0.02] border border-[#2a2a2a] rounded-lg text-center transition-all hover:border-accent/30">
                <img src={node.icon} alt={node.label} className="w-12 h-12 object-contain" />
                <div>
                  <div className="text-[0.8rem] font-semibold text-[#cccccc]">{node.label}</div>
                  <div className="text-[0.7rem] text-[#666666]">{node.sub}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
