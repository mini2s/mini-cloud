import type { Metadata, Viewport } from "next";
import { headers, cookies } from "next/headers";
import { Inter, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { cn } from "@multica/ui/lib/utils";
import { AdminProviders } from "@/app/providers";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@multica/core/i18n";
import { RESOURCES } from "@multica/views/locales";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "sans-serif",
  ],
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#05070b" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Multica Admin",
    template: "%s | Multica Admin",
  },
  description: "Multica Admin — operations console for human + agent teams.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
};

function isSupportedLocale(value: string | null): value is SupportedLocale {
  return (
    value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

const HTML_LANG: Record<SupportedLocale, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const headerLocale = h.get("x-multica-locale");
  const cookieLocale = (await cookies()).get("multica-locale")?.value ?? null;
  const locale: SupportedLocale = isSupportedLocale(headerLocale)
    ? headerLocale
    : isSupportedLocale(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;
  const resources = { [locale]: RESOURCES[locale] };

  return (
    <html
      lang={HTML_LANG[locale]}
      suppressHydrationWarning
      className={cn(
        "antialiased font-sans h-full",
        inter.variable,
        geistMono.variable,
      )}
    >
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <AdminProviders locale={locale} resources={resources}>
            {children}
          </AdminProviders>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
