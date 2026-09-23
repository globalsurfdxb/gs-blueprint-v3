import type { Metadata } from "next";
import { Space_Grotesk, Lexend } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

const lexend = Lexend({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GS Blueprint",
  description: "GS Blueprint — internal project, task, and time management system for GS Digital.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // en-GB so dates read DD/MM/YYYY — the agency's convention (Dubai + India). Browsers
      // that honour the document locale for <input type="date"> will render the picker in
      // day/month/year order too.
      lang="en-GB"
      className={`${spaceGrotesk.variable} ${lexend.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body">{children}</body>
    </html>
  );
}
