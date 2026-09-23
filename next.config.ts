import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const aiPricerOrigin = configuredAiPricerOrigin();
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "img-src 'self' data: blob: https://i.ytimg.com",
          "media-src 'self' blob:",
          "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
          "connect-src 'self' https://challenges.cloudflare.com https://vercel.com",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "form-action 'self'",
        ].join("; "),
      },
    ];

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/api/owner/ai-pricer/launch",
        headers: securityHeaders.map((header) =>
          header.key === "Content-Security-Policy"
            ? {
                ...header,
                value: [
                  "default-src 'none'",
                  "base-uri 'none'",
                  "object-src 'none'",
                  "frame-ancestors 'none'",
                  `form-action ${aiPricerOrigin}`,
                  "script-src 'unsafe-inline'",
                  "style-src 'unsafe-inline'",
                ].join("; "),
              }
            : header,
        ),
      },
    ];
  },
};

export default nextConfig;

function configuredAiPricerOrigin() {
  try {
    const url = new URL(
      process.env.AI_PRICER_URL ?? "https://whs-pricing-tool-p8kg.vercel.app",
    );
    return url.origin;
  } catch {
    return "https://whs-pricing-tool-p8kg.vercel.app";
  }
}
