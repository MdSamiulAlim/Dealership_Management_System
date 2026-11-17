"use client";
import { useEffect } from "react";
import markup from "../lib/interface.html?raw";
export default function Dashboard() {
  useEffect(() => {
    if (document.getElementById("dealership-script") || document.getElementById("workspace-script-0")) return;
    const scripts = ["/i18n-catalog.js?v=blank-entry-2026-v1", "/i18n.js?v=sync-ui-fixes-2026-v1", "/offline-store.js?v=percentage-half-up-2026-v1", "/dealership.js?v=percentage-half-up-2026-v1", "/advanced.js?v=blank-entry-2026-v1", "/record-editor.js?v=record-actions-2026-v1", "/usability.js?v=sync-ui-fixes-2026-v1", "/dues.js?v=percentage-half-up-2026-v1"];
    const load = (index: number) => {
      if (index >= scripts.length) return;
      const script = document.createElement("script");
      script.id = index === 3 ? "dealership-script" : `workspace-script-${index}`;
      script.src = scripts[index];
      script.onload = () => load(index + 1);
      document.body.appendChild(script);
    };
    load(0);
  }, []);
  return <div dangerouslySetInnerHTML={{ __html: markup }} />;
}
