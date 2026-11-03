import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./material3.css";
import "./usability.css";
export const viewport: Viewport = { themeColor: "#006b50" };
export const metadata: Metadata = {
 title: "Arafat Traders",
 description: "মোবাইল ও ল্যাপটপে আপনার ব্যক্তিগত বিক্রি, স্টক ও বকেয়ার হিসাব।",
 icons: {icon: {url:"/brand/arafat-app-icon.png",type:"image/png"}, shortcut:"/brand/arafat-app-icon.png", apple:"/brand/arafat-app-icon.png"},
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="bn"><body>{children}</body></html>;
}
