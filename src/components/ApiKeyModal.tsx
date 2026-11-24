import { KeyRound, ShieldCheck, X } from 'lucide-react';
import React, { useState } from 'react';
import { translations, type Locale } from '../i18n/translations';

interface ApiKeyModalProps {
  locale: Locale;
  initialKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  locale,
  initialKey,
  onSave,
  onClose,
}) => {
  const t = translations[locale];
  const [value, setValue] = useState(initialKey);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(value.trim());
    onClose();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="api-modal-title">
      <div className="modal-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 id="api-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', margin: 0 }}>
            <KeyRound size={18} />
            {t.modalTitle}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modal" id="btn-close-api-modal">
            <X size={16} />
          </button>
        </div>

        <p>{t.modalDesc}</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="gemini-api-key-input" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
            Google Gemini API Key
          </label>
          <input
            id="gemini-api-key-input"
            type="password"
            className="input-control"
            style={{ width: '100%', marginBottom: '0.75rem' }}
            placeholder="AIzaSy..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.76rem',
              color: 'var(--teal-primary)',
              marginBottom: '1.1rem',
            }}
          >
            <ShieldCheck size={15} />
            <span>
              {locale === 'zh-Hant'
                ? '金鑰僅儲存在您的瀏覽器 localStorage，絕不傳送至任何第三方伺服器。'
                : 'Stored exclusively in your browser localStorage; never sent to any third-party server.'}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} id="btn-cancel-api-key">
              {t.cancelBtn}
            </button>
            <button type="submit" className="btn btn-primary" id="btn-save-api-key">
              {t.saveBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
