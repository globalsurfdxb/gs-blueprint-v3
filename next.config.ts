import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Bug screenshot uploads (PRD 8.2.4) go through a Server Action and can be up to 5MB
      // per image. Next's default body limit is 1MB, which would reject them before our own
      // validation runs — raise it so legitimate images reach the action, where the real
      // ≤5MB / PNG-JPG-WebP / max-3 checks live. Anything larger is still hard-blocked here.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
