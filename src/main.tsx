import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import type { UsageSnapshot } from '../shared/types.ts';
import './style.css';

const data = document.getElementById('usage-data');
const root = document.getElementById('root');

if (!data?.textContent || !root) {
  throw new Error('Dashboard HTML is missing its root element or usage data.');
}

const snapshot = JSON.parse(data.textContent) as UsageSnapshot;

createRoot(root).render(
  <StrictMode>
    <App snapshot={snapshot} />
  </StrictMode>,
);
