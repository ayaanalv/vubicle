import { useState, type ReactNode } from 'react';
import { Dialog } from './ui';

export function PrivacyText() {
  return (
    <>
      <p>Your files are read and stored in this browser. Vubicle has no accounts and keeps no copy on a server.</p>
      <p>
        When you use an AI tool, the passages from your notes that match the request are sent to <strong>Google Gemini</strong>, or to{' '}
        <strong>Groq</strong> when Gemini is busy, to write the answer. These are free tiers, and the providers may use that text to improve
        their services.
      </p>
      <p>
        <strong>Do not upload anything confidential</strong>: personal information, unpublished research, or material you are not allowed to
        share.
      </p>
    </>
  );
}

const KEY = 'vubicle.privacy.v1';

/** Shown once, the first time someone opens the app. */
export function PrivacyGate({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'yes';
    } catch {
      return false;
    }
  });
  const accept = () => {
    try {
      localStorage.setItem(KEY, 'yes');
    } catch {
      /* private mode: ask again next time */
    }
    setSeen(true);
  };
  return (
    <>
      {children}
      <Dialog open={!seen} onClose={accept} label="Before you start">
        <div className="dialog">
          <h2>Before you start</h2>
          <PrivacyText />
          <div className="actions">
            <button className="btn primary" autoFocus onClick={accept}>
              I understand
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
