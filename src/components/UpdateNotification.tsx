import { useState, useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { api } from '../lib/api';

export function UpdateNotification() {
  const [update, setUpdate] = useState<{ latestVersion: string; downloadUrl?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.checkUpdate().then((data) => {
      if (data?.updateAvailable && data.latestVersion) {
        setUpdate({ latestVersion: data.latestVersion, downloadUrl: data.downloadUrl });
      }
    }).catch(() => {});
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent/10 border border-accent/20 animate-slide-up">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-accent font-medium">
          Update available: v{update.latestVersion}
        </span>
        {update.downloadUrl && (
          <a
            href={update.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent transition-colors"
          >
            <ExternalLink size={9} />
            Download
          </a>
        )}
      </div>
      <button onClick={() => setDismissed(true)} className="p-1 text-r-400 hover:text-r-200 transition-colors">
        <X size={11} />
      </button>
    </div>
  );
}
