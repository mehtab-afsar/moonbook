import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { moduleResolution: "node", esModuleInterop: true, paths: { "@/*": ["./*"] } } },
    ],
  },
};

export default config;
