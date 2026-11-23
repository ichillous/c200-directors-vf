// The log goes first, so crashes and errors are caught from the very start, before the saved state loads.
import { log, scrub, sendLogs } from './diag';
import { Component, StrictMode, useState, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo-narrow/500.css';
import '@fontsource/archivo-narrow/600.css';
import '@fontsource/archivo-narrow/700.css';
import './styles.css';
import App from './App';

function Fallback() {
  const [note, setNote] = useState('');
  async function onSend() {
    setNote('Packing the logs.');
    const how = await sendLogs();
    setNote(how === 'failed' ? 'The logs did not go out. Try again.' : how === 'cancelled' ? 'Nothing was sent.' : 'Logs sent. Reload to carry on.');
  }
  return (
    <div className="stage">
      <div className="oops">
        <h1>Something went wrong</h1>
        <p>This screen stopped working. Send the logs so it can be fixed, then reload.</p>
        <div className="oops__row">
          <button type="button" className="btn" onClick={() => void onSend()}>Send logs</button>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
        {note && <p role="status">{note}</p>}
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log('E', 'react_render_error', {
      name: error?.name,
      msg: scrub(error?.message),
      stack: error?.stack ? scrub(error.stack, 4096) : undefined,
      componentStack: scrub(info.componentStack ?? '', 2048),
    });
  }

  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
