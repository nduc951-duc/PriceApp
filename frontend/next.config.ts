import type { NextConfig } from "next";
import withFlowbiteReact from "flowbite-react/plugin/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.26", "127.0.0.1"],
};

export default withFlowbiteReact(nextConfig);