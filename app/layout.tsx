import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kagu Saha",
  description: "Kagu saha servis takip uygulamasi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}

