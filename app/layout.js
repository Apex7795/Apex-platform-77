import './globals.css';

export const metadata = {
  title: 'Apex Junk Solutions — Lead Platform',
  description: 'Lead tracking, conversion scoring, and prospect outreach for field service businesses.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
