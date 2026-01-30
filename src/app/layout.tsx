import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "La Bombonera - Panel Admin",
  description: "Panel de administración de canchas y reservas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
