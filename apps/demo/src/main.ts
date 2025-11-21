import { buildGreeting } from "@webrun-vcs/core";

const message = buildGreeting({ name: "demo app" });

// For Node / tsx:
console.log(message);

// For Deno users, you can also run this file via:
// deno run -A apps/demo/src/main.ts
