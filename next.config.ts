import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { withEve } from "eve/next";

// `vercel env pull` writes `VERCEL="1"` and `VERCEL_URL=""` into `.env.local`.
// - When `process.env.VERCEL` is truthy, `withEve()` assumes it is running inside a
//   Vercel cloud build and skips starting `eve dev` and registering `/eve/v1/*` rewrites.
// - When `process.env.VERCEL_URL` is `""` (`!== undefined`), `@workflow/core` constructs
//   `new URL("https://")` and throws `TypeError: Invalid URL` on workflow runs.
// Clear these when running locally (where `VERCEL_REGION` is not present).
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL_REGION) {
  delete process.env.VERCEL;
  if (!process.env.VERCEL_URL) {
    delete process.env.VERCEL_URL;
  }
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  allowedDevOrigins: ["192.168.178.58"],
  turbopack: {
    root: process.cwd(),
  },
};

export default withSentryConfig(withEve(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "cba-og",

  project: "eve-chat",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
