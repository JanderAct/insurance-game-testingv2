import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SessionRouter from './session/SessionRouter.tsx';
import { installFaultHandle } from './session/index.ts';
import './index.css';

// The solo game is still what renders at '/', unchanged — SessionRouter falls
// through to App for every path that is not a session path.
installFaultHandle();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionRouter />
  </StrictMode>
);
