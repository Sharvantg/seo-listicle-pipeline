/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  preset: "ts-jest",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: "./tsconfig.jest.json" },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  setupFiles: ["<rootDir>/jest.setup.ts"],
  testMatch: ["**/tests/**/*.test.ts"],
  testTimeout: 60_000,
  verbose: true,
};

module.exports = config;
