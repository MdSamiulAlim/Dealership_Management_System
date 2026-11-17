import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from 'node:fs';
const markup=readFileSync(new URL('../lib/interface.html',import.meta.url),'utf8');
writeFileSync(new URL('../public/offline.css',import.meta.url),['globals.css','material3.css','usability.css'].map(file=>readFileSync(new URL('../app/'+file,import.meta.url),'utf8')).join('\n'));
writeFileSync(new URL('../public/offline-shell.txt',import.meta.url),'<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#006b50"><title>Arafat Traders</title><link rel="icon" type="image/png" href="/brand/arafat-app-icon.png"><link rel="apple-touch-icon" href="/brand/arafat-app-icon.png"><link rel="stylesheet" href="/offline.css"><link rel="modulepreload" href="/report-journal.mjs?v=percentage-half-up-2026-v1"><link rel="modulepreload" href="/replica.mjs?v=sync-ui-fixes-2026-v1"></head><body>'+markup+'<script defer src="/i18n-catalog.js?v=blank-entry-2026-v1"></script><script defer src="/i18n.js?v=sync-ui-fixes-2026-v1"></script><script defer src="/offline-store.js?v=percentage-half-up-2026-v1"></script><script defer src="/dealership.js?v=percentage-half-up-2026-v1"></script><script defer src="/advanced.js?v=blank-entry-2026-v1"></script><script defer src="/record-editor.js?v=record-actions-2026-v1"></script><script defer src="/usability.js?v=sync-ui-fixes-2026-v1"></script><script defer src="/dues.js?v=percentage-half-up-2026-v1"></script></body></html>');

const assets=["money-allocation.mjs","replica.mjs","report-journal.mjs","product-list-2026.csv","offline-shell.txt","offline.css","i18n-catalog.js","i18n.js","offline-store.js","dealership.js","advanced.js","record-editor.js","usability.js","dues.js","customer-due.mjs","ui-icons.svg","akij-feed-logo.svg","brand/arafat-app-icon.png","brand/arafat-growth-logo.png","fonts/manrope.ttf","fonts/noto-bengali.ttf"];
const fingerprint=createHash("sha256");
for(const asset of assets)fingerprint.update(readFileSync(new URL("../public/"+asset,import.meta.url)));
const worker=new URL("../public/sw.js",import.meta.url);
const source=readFileSync(worker,"utf8").replace(/const CACHE='[^']+';/,"const CACHE='arafat-shell-"+fingerprint.digest("hex").slice(0,16)+"';");
writeFileSync(worker,source);
