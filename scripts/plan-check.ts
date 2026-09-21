import assert from "node:assert/strict";
import { interpretPlan } from "../src/lib/plan";

assert.equal(interpretPlan({ membershipType: "pro", subscriptionStatus: "active" }).active, true);
assert.equal(interpretPlan({ membershipType: "ultra", subscriptionStatus: "trialing" }).active, true);
assert.equal(interpretPlan({ membershipType: "team", subscriptionStatus: "canceled" }).active, false);
assert.equal(interpretPlan({ membershipType: "free", subscriptionStatus: "active" }).active, false);
assert.equal(interpretPlan({ membershipType: "hobby" }).active, false);
assert.equal(interpretPlan({ planInfo: { planName: "Pro" } }).active, true);
assert.equal(interpretPlan({ planInfo: { planName: "Cursor Pro" } }).active, true);
assert.equal(interpretPlan({}).active, false);
assert.equal(interpretPlan({ subscriptionStatus: "active" }).active, false);
console.log("plan checks ok");
