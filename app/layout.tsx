import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SEO Listicle Pipeline",
  description: "Automated SEO listicle generation pipeline for Zuddl",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="container mx-auto px-4 py-4 flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
                <span className="text-primary-foreground text-sm font-bold">Z</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold">SEO Listicle Pipeline</h1>
                <p className="text-xs text-muted-foreground">Zuddl Content Engine</p>
              </div>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
