import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';
import type { UsageSnapshot } from '../shared/types.ts';

const snapshot = JSON.parse(document.getElementById('usage-data')!.textContent!) as UsageSnapshot;
createRoot(document.getElementById('root')!).render(<StrictMode><App snapshot={snapshot} /></StrictMode>);
