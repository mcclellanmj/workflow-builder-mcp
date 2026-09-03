import type { ComponentChildren, VNode } from "preact";

export interface BaseLayoutProps {
  children?: ComponentChildren;
  title?: string;
  head?: ComponentChildren;
  extraHead?: ComponentChildren;
  scripts?: string[];
  styles?: string[];
  className?: string;
}

/**
 * BaseLayout provides a clean, HTML5 document structure ready for dark-mode
 * with Twind/Tailwind support.
 */
export function BaseLayout({
  children,
  title = "Workflow Builder",
  head,
  extraHead,
  scripts = [],
  styles = [],
  className = "bg-gray-900 text-gray-100 min-h-screen",
}: BaseLayoutProps): VNode {
  return (
    <html lang="en" class="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {styles.map((href) => <link key={href} rel="stylesheet" href={href} />)}
        {head}
        {extraHead}
      </head>
      <body class={className}>
        {children}
        {scripts.map((src) => <script key={src} src={src} defer />)}
      </body>
    </html>
  );
}
