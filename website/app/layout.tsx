import type { Metadata, Viewport } from 'next';
import { Roboto_Condensed } from 'next/font/google';
import './globals.css';
import './themes.css';
const bodyFont = Roboto_Condensed({ subsets: ['latin'], weight: ['300', '400', '700'], display: 'swap' });
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#14171b' },
  ],
};
export const metadata: Metadata = {
  title: 'circular — Better business connections',
  description: 'One business’s output is another’s input. Circular matches companies by what they need and what they provide.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-US"><body className={bodyFont.className}>{children}</body></html>;
}
