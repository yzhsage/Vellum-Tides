import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const analyticsEndpoint = String(import.meta.env.VITE_ANALYTICS_ENDPOINT ?? "").trim();
const analyticsWebsiteId = String(import.meta.env.VITE_ANALYTICS_WEBSITE_ID ?? "").trim();

if (analyticsEndpoint && analyticsEndpoint !== "undefined" && analyticsWebsiteId && analyticsWebsiteId !== "undefined") {
  const analyticsScript = document.createElement("script");
  analyticsScript.defer = true;
  analyticsScript.src = `${analyticsEndpoint.replace(/\/$/, "")}/umami`;
  analyticsScript.dataset.websiteId = analyticsWebsiteId;
  document.head.appendChild(analyticsScript);
}

createRoot(document.getElementById("root")!).render(<App />);
