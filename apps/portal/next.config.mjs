/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  serverExternalPackages: [
    "pdfjs-dist",
    "tesseract.js",
    "@napi-rs/canvas",
  ],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    config.externals = config.externals || [];
    config.externals.push({
      "@napi-rs/canvas": "commonjs @napi-rs/canvas",
      "pdfjs-dist": "commonjs pdfjs-dist",
      "tesseract.js": "commonjs tesseract.js",
    });
    return config;
  },
};

export default nextConfig;
