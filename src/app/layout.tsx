import type { Metadata } from "next";
import { Bitter, Work_Sans } from "next/font/google";
import "./globals.css";

const bitter = Bitter({
  variable: "--font-bitter",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const work = Work_Sans({
  variable: "--font-work",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Los Menonitas",
  description: "Pedidos, cocina y caja",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${bitter.variable} ${work.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-crema font-sans text-cafe">{children}</body>
    </html>
  );
}
