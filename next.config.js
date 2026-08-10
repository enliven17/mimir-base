const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin Turbopack's workspace root. A stray ~/package-lock.json makes Next infer
  // the wrong root (C:\Users\enliven) and serve an empty app dir → every route
  // 404s. Anchoring to this file's dir fixes dev and prod builds alike.
  turbopack: {
    root: __dirname,
    resolveAlias: {
      // @base-org/account → @coinbase/cdp-sdk lazily imports the Solana x402
      // scheme. Mimir is EVM-only, so that branch never runs — but Turbopack
      // resolves the dynamic import statically and fails the build. Stub it
      // instead of installing the whole Solana SDK for dead code.
      "@x402/svm/exact/client": { browser: "./lib/x402/svm-stub.ts", default: "./lib/x402/svm-stub.ts" },
    },
  },
};

module.exports = withNextIntl(nextConfig);
