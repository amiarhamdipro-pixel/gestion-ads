import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// metadataBase requis pour que Next.js résolve les URLs d'icônes/images
// (favicon.ico, icon.tsx, apple-icon.tsx, opengraph-image.tsx,
// twitter-image.tsx) en URLs absolues dans les balises <meta> générées —
// sans ça, les robots de partage (WhatsApp, LinkedIn, Facebook, iMessage...)
// reçoivent une URL relative invalide et n'affichent aucun aperçu.
const SITE_URL = "https://ads.amerys-agency.com";
const APP_NAME = "AMERYS AGENCY – ADS";
const APP_DESCRIPTION = "Suivi des campagnes publicitaires Amerys Agency.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: APP_NAME,
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: SITE_URL,
    siteName: APP_NAME,
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
