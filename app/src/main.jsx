import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Join from './components/Join.jsx';
import './index.css';

// The QR at a gathering points at /join. It is a whole separate surface — no
// navigation, no map, no assistant — because the landing action after a scan has
// to be one screen with one field, and because the phone reading it is on http
// over the wifi, where half the browser APIs this app uses are unavailable.
// Chosen here rather than inside App so App's hooks are never conditional.
const isJoin = window.location.pathname.replace(/\/$/, '') === '/join';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isJoin ? <Join /> : <App />}</React.StrictMode>
);
