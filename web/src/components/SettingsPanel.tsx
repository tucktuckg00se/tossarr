import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api';
import type { Settings } from '../api';

interface SettingsPanelProps {
  settings: Settings;
  onSaved: (settings: Settings) => void;
}

export default function SettingsPanel({ settings, onSaved }: SettingsPanelProps) {
  const [syncHours, setSyncHours] = useState(String(settings.syncIntervalHours));
  const [reappearDays, setReappearDays] = useState(String(settings.keepReappearDays));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const hours = Number(syncHours);
    const days = Number(reappearDays);
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(days) || days <= 0) {
      setNote({ kind: 'error', text: 'Both values must be numbers greater than zero.' });
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      const saved = await api.saveSettings({ syncIntervalHours: hours, keepReappearDays: days });
      onSaved(saved);
      setNote({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="card">
        <h2>Preferences</h2>
        <p className="card-sub">How often Tossarr checks your instances, and when kept items come back to the deck.</p>
        <form onSubmit={submit}>
          <div className="settings-row">
            <div className="field">
              <label htmlFor="sync-hours">Sync interval (hours)</label>
              <input
                id="sync-hours"
                type="number"
                min="0.1"
                step="0.5"
                value={syncHours}
                onChange={(e) => setSyncHours(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="reappear-days">Kept items reappear after (days)</label>
              <input
                id="reappear-days"
                type="number"
                min="1"
                step="1"
                value={reappearDays}
                onChange={(e) => setReappearDays(e.target.value)}
              />
            </div>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {note && (
              <span className={`status-line ${note.kind === 'ok' ? 'status-ok' : 'status-error'}`}>{note.text}</span>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
