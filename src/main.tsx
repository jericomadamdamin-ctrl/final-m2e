import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { MiniKitProvider } from "./providers/MiniKitProvider";

createRoot(document.getElementById("root")!).render(
  <MiniKitProvider>
    <App />
  </MiniKitProvider>
);
