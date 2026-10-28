import { useState } from 'react';
import type { FormEvent } from 'react';
import * as api from '../api';

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; itemCount: number }
  | { status: 'error'; message: string };

interface SourceFormProps {
  /** Called after a source is created so the parent can refresh its list. */
  onAdded: () => void;
}

export default function SourceForm({ onAdded }: SourceFormProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<api.SourceKind>('sonarr');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canTest = url.trim() !== '' && apiKey.trim() !== '';
  const canAdd = canTest && name.trim() !== '' && !adding;

  // Any edit invalidates a previous test result.
  function touch() {
    setTest({ status: 'idle' });
    setError(null);
  }

  async function runTest() {
    setTest({ status: 'testing' });
    setError(null);
    try {
      const result = await api.testSource(kind, url.trim(), apiKey.trim());
      setTest({ status: 'ok', itemCount: result.itemCount });
    } catch (err) {
      setTest({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canAdd) return;
    setAdding(true);
    setError(null);
    try {
      await api.createSource({ name: name.trim(), kind, url: url.trim(), apiKey: apiKey.trim() });
      setName('');
      setUrl('');
      setApiKey('');
      setTest({ status: 'idle' });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <form onSubmit={submit} className="source-form">
      <div className="field-row">
        <div className="field">
          <label htmlFor="source-name">Name</label>
          <input
            id="source-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
            placeholder="Home Sonarr"
          />
        </div>
        <div className="field">
          <label htmlFor="source-kind">Type</label>
          <select
            id="source-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as api.SourceKind);
              touch();
            }}
          >
            <option value="sonarr">Sonarr (TV)</option>
            <option value="radarr">Radarr (movies)</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="source-url">URL</label>
        <input
          id="source-url"
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            touch();
          }}
          placeholder={kind === 'sonarr' ? 'http://192.168.1.10:8983' : 'http://192.168.1.10:7878'}
        />
      </div>

      <div className="field">
        <label htmlFor="source-key">API key</label>
        <input
          id="source-key"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            touch();
          }}
          placeholder="Paste the key from Settings → General"
          autoComplete="off"
        />
      </div>

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => void runTest()} disabled={!canTest || test.status === 'testing'}>
          {test.status === 'testing' ? (
            <>
              <span className="spinner" />
              Testing…
            </>
          ) : (
            'Test connection'
          )}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canAdd}>
          {adding ? 'Adding…' : 'Add source'}
        </button>
      </div>

      <p className={`status-line ${test.status === 'ok' ? 'status-ok' : test.status === 'error' || error ? 'status-error' : 'status-muted'}`}>
        {error ??
          (test.status === 'testing'
            ? 'Contacting the instance…'
            : test.status === 'ok'
              ? `Connected — ${test.itemCount} item${test.itemCount === 1 ? '' : 's'} found.`
              : '')}
      </p>
    </form>
  );
}
