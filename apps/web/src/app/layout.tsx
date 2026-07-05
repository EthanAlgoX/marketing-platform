import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "营销发布工作台",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%230f766e'/%3E%3Cpath d='M18 41h28v6H18zm0-12h28v6H18zm0-12h28v6H18z' fill='white'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
