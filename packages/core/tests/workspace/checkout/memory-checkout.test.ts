/**
 * Tests for MemoryCheckout implementation
 *
 * Runs conformance tests against the in-memory Checkout implementation.
 */

import type { Checkout } from "../../../src/workspace/checkout/checkout.js";
import { MemoryCheckout } from "../../../src/workspace/checkout/memory-checkout.js";
import { SimpleStaging } from "../../../src/workspace/staging/simple-staging.js";
import { checkoutConformanceTests } from "./checkout.conformance.test.js";

let checkout: MemoryCheckout;
let staging: SimpleStaging;

checkoutConformanceTests(
  "MemoryCheckout",
  async (): Promise<Checkout> => {
    staging = new SimpleStaging();
    checkout = new MemoryCheckout({
      staging,
    });
    return checkout;
  },
  async (): Promise<void> => {
    // No cleanup needed for in-memory implementation
  },
);
