'use client';

import { createContext, useContext } from 'react';

/** True when a screen is shown inside the combined Mission screen, not on its own page. */
export const EmbeddedContext = createContext(false);

export const useEmbedded = () => useContext(EmbeddedContext);
