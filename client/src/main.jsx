import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { initI18n } from "./i18n";
import { startingLocale } from "./i18n/routing";
import "./wx/tokens.css";
import "./wx/components.css";
import "./index.css";

// The page's language is loaded before the first render, so it never shows in English first.
initI18n(startingLocale()).finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={null}>
            <App />
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
});
