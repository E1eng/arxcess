const nextConfig = {
  experimental: {
    typedRoutes: true
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false
    };

    return config;
  }
};

export default nextConfig;
