import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

import { BRAND_BASE_DARK } from "@/constants/brand";

// Match the native launch canvas before the web JavaScript bundle loads.
export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta name="theme-color" content={BRAND_BASE_DARK} />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `html,body,#root{background-color:${BRAND_BASE_DARK};}body{margin:0;}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
