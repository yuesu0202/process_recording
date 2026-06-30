/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static / fluent-ffmpeg are native/CJS deps that must stay external
  // to the server bundle so their binary paths resolve at runtime.
  experimental: {
    serverComponentsExternalPackages: ["fluent-ffmpeg", "ffmpeg-static", "ffprobe-static"],
  },
};

export default nextConfig;
