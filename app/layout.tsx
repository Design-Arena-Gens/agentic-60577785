import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Upscaler - AI-Powered Video Enhancement",
  description: "Upscale your videos using advanced algorithms",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
