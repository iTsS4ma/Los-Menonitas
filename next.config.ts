import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.0.168",
    "192.168.0.168:3000",
    "localhost:3000"
  ],
};

export default nextConfig;