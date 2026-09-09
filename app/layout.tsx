import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '鼓房预约',
  description: '社团鼓房一周预约表',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
