import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Filter out browser extension errors from console
const originalError = console.error;
console.error = (...args) => {
  const errorMessage = args.join(' ');
  // Filter out common browser extension errors
  if (
    errorMessage.includes('content.js') ||
    errorMessage.includes('FeatureGateClients') ||
    errorMessage.includes('instanceof') && errorMessage.includes('content.js') ||
    errorMessage.includes('Right-hand side of') ||
    errorMessage.includes('Multiple versions of')
  ) {
    // Silently ignore extension errors
    return;
  }
  // Log other errors normally
  originalError.apply(console, args);
};

// Filter out browser extension warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  const warningMessage = args.join(' ');
  // Filter out common browser extension warnings
  if (
    warningMessage.includes('FeatureGateClients') ||
    warningMessage.includes('Multiple versions of')
  ) {
    // Silently ignore extension warnings
    return;
  }
  // Log other warnings normally
  originalWarn.apply(console, args);
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);
